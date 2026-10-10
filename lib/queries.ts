import 'server-only';
import { BASE_CURRENCY, RATE_SCALE, convertMinorUnits, effectiveRateE8 } from './currency';
import { db } from './db';
import {
  FULL_PERCENT_BP,
  formatBasisPoints,
  formatCents,
  splitByWeights,
  splitEqually,
} from './money';
import type {
  Balance,
  ExchangeRate,
  Expense,
  ExpenseWithSplits,
  Group,
  GroupSummary,
  Member,
  SettlementWithNames,
  SplitType,
} from './types';

/** ASCII unit separator — a safe GROUP_CONCAT delimiter, since names never contain it. */
const SEP = '\u001f';

/* --------------------------------------------------------- exchange rates */

export function listRates(): ExchangeRate[] {
  return db
    .prepare('SELECT * FROM exchange_rates ORDER BY currency')
    .all() as ExchangeRate[];
}

export function getRateE8(currency: string): number {
  const row = db
    .prepare('SELECT rate_e8 FROM exchange_rates WHERE currency = ?')
    .get(currency) as { rate_e8: number } | undefined;
  if (!row) throw new Error(`No exchange rate on file for ${currency}.`);
  return row.rate_e8;
}

export function upsertRate(currency: string, rateE8: number): void {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Use a three-letter currency code, like CHF.');
  if (!Number.isInteger(rateE8) || rateE8 <= 0) throw new Error('Enter a rate above zero.');
  if (code === BASE_CURRENCY && rateE8 !== RATE_SCALE) {
    throw new Error(`${BASE_CURRENCY} is the base currency — its rate is always 1.`);
  }
  db.prepare(
    `INSERT INTO exchange_rates (currency, rate_e8) VALUES (?, ?)
     ON CONFLICT(currency) DO UPDATE SET rate_e8 = excluded.rate_e8,
                                         updated_at = datetime('now')`
  ).run(code, rateE8);
}

export function deleteRate(currency: string): void {
  if (currency === BASE_CURRENCY) throw new Error(`${BASE_CURRENCY} is the base currency.`);
  const inUse = db
    .prepare('SELECT COUNT(*) AS n FROM groups WHERE currency = ?')
    .get(currency) as { n: number };
  if (inUse.n > 0) throw new Error(`${currency} is in use by a group.`);
  db.prepare('DELETE FROM exchange_rates WHERE currency = ?').run(currency);
}

/**
 * Books an amount from one currency into another, returning everything needed
 * to store it. Conversion happens once, here, on the total.
 */
function book(amountCents: number, from: string, to: string) {
  const fromRate = getRateE8(from);
  const toRate = getRateE8(to);
  return {
    amount_cents: convertMinorUnits(amountCents, fromRate, toRate),
    original_amount_cents: amountCents,
    original_currency: from,
    rate_e8: effectiveRateE8(fromRate, toRate),
  };
}

/* ------------------------------------------------------------------ groups */

export function listGroups(): GroupSummary[] {
  const rows = db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id)            AS member_count,
              (SELECT GROUP_CONCAT(m.name, CHAR(31)) FROM members m
                WHERE m.group_id = g.id)                                          AS member_names,
              (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id)           AS expense_count,
              COALESCE((SELECT SUM(amount_cents) FROM expenses e
                        WHERE e.group_id = g.id), 0)                              AS total_cents
         FROM groups g
        ORDER BY g.created_at DESC, g.id DESC`
    )
    .all() as (Omit<GroupSummary, 'member_names'> & { member_names: string | null })[];

  // GROUP_CONCAT with a unit-separator keeps names containing commas intact.
  return rows.map((r) => ({
    ...r,
    member_names: r.member_names ? r.member_names.split(SEP) : [],
  }));
}

export function getGroup(id: number): Group | undefined {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Group | undefined;
}

export function createGroup(input: {
  name: string;
  description?: string;
  emoji?: string;
  currency?: string;
  memberNames: string[];
}): number {
  // A group can only use a currency we hold a rate for, otherwise nothing
  // entered in another currency could ever be converted into its balances.
  getRateE8(input.currency ?? 'USD');

  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO groups (name, description, emoji, currency) VALUES (?, ?, ?, ?)')
      .run(
        input.name.trim(),
        input.description?.trim() ?? '',
        input.emoji ?? '💸',
        input.currency ?? 'USD'
      );
    const groupId = Number(info.lastInsertRowid);

    const insertMember = db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)');
    for (const name of input.memberNames) {
      const trimmed = name.trim();
      if (trimmed) insertMember.run(groupId, trimmed);
    }
    return groupId;
  });
  return tx();
}

export function deleteGroup(id: number): void {
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

/* ----------------------------------------------------------------- members */

export function listMembers(groupId: number): Member[] {
  return db
    .prepare('SELECT * FROM members WHERE group_id = ? ORDER BY id')
    .all(groupId) as Member[];
}

export function addMember(groupId: number, name: string, email?: string): number {
  const info = db
    .prepare('INSERT INTO members (group_id, name, email) VALUES (?, ?, ?)')
    .run(groupId, name.trim(), email?.trim() || null);
  return Number(info.lastInsertRowid);
}

export function removeMember(memberId: number): void {
  db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
}

/** A member can only be removed cleanly if they have no financial history. */
export function memberHasActivity(memberId: number): boolean {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM expenses WHERE paid_by = ?)                       +
         (SELECT COUNT(*) FROM expense_splits WHERE member_id = ?)               +
         (SELECT COUNT(*) FROM settlements
           WHERE from_member_id = ? OR to_member_id = ?) AS n`
    )
    .get(memberId, memberId, memberId, memberId) as { n: number };
  return row.n > 0;
}

/* ---------------------------------------------------------------- expenses */

export function listExpenses(groupId: number): ExpenseWithSplits[] {
  const expenses = db
    .prepare(
      `SELECT e.*, m.name AS paid_by_name
         FROM expenses e
         JOIN members m ON m.id = e.paid_by
        WHERE e.group_id = ?
        ORDER BY e.spent_at DESC, e.id DESC`
    )
    .all(groupId) as (Expense & { paid_by_name: string })[];

  if (expenses.length === 0) return [];

  const splitStmt = db.prepare(
    `SELECT s.member_id, s.amount_cents, s.weight, m.name
       FROM expense_splits s
       JOIN members m ON m.id = s.member_id
      WHERE s.expense_id = ?
      ORDER BY m.id`
  );

  return expenses.map((e) => ({
    ...e,
    splits: splitStmt.all(e.id) as ExpenseWithSplits['splits'],
  }));
}

export type ExpenseInput = {
  groupId: number;
  description: string;
  amountCents: number;
  paidBy: number;
  category?: string;
  splitType: SplitType;
  spentAt?: string;
  participants: number[];
  /**
   * Per-participant input, already parsed to integers by the caller:
   * `exact` -> cents, `percent` -> basis points, `shares` -> centishares.
   * Ignored for `equal`.
   */
  values?: Record<number, number>;
  /** The currency the user typed in — used for validation messages. */
  currency?: string;
  /**
   * What to actually allocate, in the group's currency. Defaults to
   * `amountCents` when no conversion is involved. Validation is still done
   * against `amountCents`, so people check their arithmetic in the currency
   * they typed, not in the converted one.
   */
  targetCents?: number;
  /** Set when this expense was materialised from a recurring template. */
  recurringId?: number;
  /** The schedule period this expense covers, e.g. "2026-02". */
  period?: string;
};

export type ComputedSplit = { member_id: number; amount_cents: number; weight: number | null };

/** Every entry must be a whole, non-negative number — no NaN, no negatives. */
function assertCleanValues(raw: number[], label: string, unit: string): void {
  for (const v of raw) {
    if (!Number.isFinite(v)) throw new Error(`Enter ${label} for everyone in the split.`);
    if (v < 0) throw new Error(`${unit} can't be negative.`);
    if (!Number.isInteger(v)) throw new Error(`${unit} can only go to two decimal places.`);
  }
}

/**
 * Turns an expense input into exact per-member cents.
 *
 * Throws — rather than silently rounding, clamping, or absorbing a difference —
 * whenever the input doesn't reconcile. Every return path is checked against the
 * total before it escapes, so a split that doesn't add up can never be written.
 */
export function computeSplits(input: ExpenseInput): ComputedSplit[] {
  const { participants, amountCents, splitType, values = {} } = input;
  const currency = input.currency ?? 'USD';
  const targetCents = input.targetCents ?? amountCents;
  const money = (c: number) => formatCents(c, currency);

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Enter a total amount above zero.');
  }
  if (!Number.isInteger(targetCents) || targetCents <= 0) {
    throw new Error('That amount converts to zero in this group’s currency.');
  }
  if (participants.length === 0) {
    throw new Error('Select at least one person to split between.');
  }
  if (new Set(participants).size !== participants.length) {
    throw new Error('Someone is listed twice in this split.');
  }

  // Each mode validates the numbers the user typed, then reduces to a set of
  // non-negative integer weights. One allocator handles all four from there.
  let weights: number[];
  let storedWeights: (number | null)[];

  switch (splitType) {
    case 'equal': {
      weights = participants.map(() => 1);
      storedWeights = participants.map(() => null);
      break;
    }

    case 'exact': {
      const amounts = participants.map((id) => values[id] ?? NaN);
      assertCleanValues(amounts, 'an amount', 'Amounts');

      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum !== amountCents) {
        const diff = Math.abs(sum - amountCents);
        throw new Error(
          sum < amountCents
            ? `${money(diff)} is still unassigned — the amounts have to add up to ${money(amountCents)}.`
            : `The amounts add up to ${money(sum)}, which is ${money(diff)} over the ${money(amountCents)} total.`
        );
      }

      weights = amounts;
      storedWeights = participants.map(() => null); // amount_cents is the input
      break;
    }

    case 'percent': {
      const bp = participants.map((id) => values[id] ?? NaN);
      assertCleanValues(bp, 'a percentage', 'Percentages');

      const sum = bp.reduce((a, b) => a + b, 0);
      if (sum !== FULL_PERCENT_BP) {
        const diff = Math.abs(sum - FULL_PERCENT_BP);
        throw new Error(
          sum < FULL_PERCENT_BP
            ? `The percentages add up to ${formatBasisPoints(sum)} — ${formatBasisPoints(diff)} short of 100%.`
            : `The percentages add up to ${formatBasisPoints(sum)} — ${formatBasisPoints(diff)} over 100%.`
        );
      }

      weights = bp;
      storedWeights = bp;
      break;
    }

    case 'shares': {
      const centishares = participants.map((id) => values[id] ?? NaN);
      assertCleanValues(centishares, 'a share count', 'Shares');

      if (centishares.reduce((a, b) => a + b, 0) === 0) {
        throw new Error('Give at least one person a share above zero.');
      }

      weights = centishares;
      storedWeights = centishares;
      break;
    }

    default:
      throw new Error(`Unknown split type: ${String(splitType)}`);
  }

  // Largest-remainder over the *converted* total. For a same-currency exact
  // split the weights already sum to the total, so this returns them untouched;
  // for everything else it hands out the leftover minor units one at a time.
  const amounts = splitByWeights(targetCents, weights);
  const splits: ComputedSplit[] = participants.map((id, i) => ({
    member_id: id,
    amount_cents: amounts[i],
    weight: storedWeights[i],
  }));

  // Backstop for every mode, including the ones that are exact by construction.
  // If a future change to the split math ever breaks the invariant, the write
  // fails loudly here instead of quietly corrupting the group's balances.
  const assigned = splits.reduce((sum, s) => sum + s.amount_cents, 0);
  if (assigned !== targetCents) {
    throw new Error(
      `This split comes to ${money(assigned)} instead of ${money(targetCents)}. Nothing was saved.`
    );
  }

  return splits;
}

/**
 * Guards against a split referencing someone from another group. Foreign keys
 * only prove the member exists, not that they belong here.
 */
function assertMembersInGroup(groupId: number, memberIds: number[]): void {
  const inGroup = new Set(listMembers(groupId).map((m) => m.id));
  for (const id of memberIds) {
    if (!inGroup.has(id)) throw new Error('Someone in this split is not a member of this group.');
  }
}

export function createExpense(input: ExpenseInput): number {
  assertMembersInGroup(input.groupId, [input.paidBy, ...input.participants]);

  const group = getGroup(input.groupId);
  if (!group) throw new Error('That group no longer exists.');

  const entryCurrency = input.currency ?? group.currency;
  const booked = book(input.amountCents, entryCurrency, group.currency);

  // Validate against what the user typed; allocate the converted total.
  const splits = computeSplits({
    ...input,
    currency: entryCurrency,
    targetCents: booked.amount_cents,
  });

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO expenses
           (group_id, description, amount_cents, paid_by, category, split_type, spent_at,
            original_amount_cents, original_currency, rate_e8, recurring_id, period)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?)`
      )
      .run(
        input.groupId,
        input.description.trim(),
        booked.amount_cents,
        input.paidBy,
        input.category ?? 'general',
        input.splitType,
        input.spentAt ?? null,
        booked.original_amount_cents,
        booked.original_currency,
        booked.rate_e8,
        input.recurringId ?? null,
        input.period ?? null
      );
    const expenseId = Number(info.lastInsertRowid);

    const insertSplit = db.prepare(
      'INSERT INTO expense_splits (expense_id, member_id, amount_cents, weight) VALUES (?, ?, ?, ?)'
    );
    for (const s of splits) insertSplit.run(expenseId, s.member_id, s.amount_cents, s.weight);
    return expenseId;
  });

  return tx();
}

export function deleteExpense(id: number): void {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
}

/* ------------------------------------------------------------- settlements */

export function listSettlements(groupId: number): SettlementWithNames[] {
  return db
    .prepare(
      `SELECT s.*, f.name AS from_name, t.name AS to_name
         FROM settlements s
         JOIN members f ON f.id = s.from_member_id
         JOIN members t ON t.id = s.to_member_id
        WHERE s.group_id = ?
        ORDER BY s.settled_at DESC, s.id DESC`
    )
    .all(groupId) as SettlementWithNames[];
}

export function createSettlement(input: {
  groupId: number;
  fromMemberId: number;
  toMemberId: number;
  amountCents: number;
  currency?: string;
  note?: string;
}): number {
  if (input.fromMemberId === input.toMemberId) {
    throw new Error('A settlement needs two different people.');
  }
  assertMembersInGroup(input.groupId, [input.fromMemberId, input.toMemberId]);

  const group = getGroup(input.groupId);
  if (!group) throw new Error('That group no longer exists.');

  const booked = book(input.amountCents, input.currency ?? group.currency, group.currency);
  if (booked.amount_cents <= 0) {
    throw new Error('That amount converts to zero in this group’s currency.');
  }

  const info = db
    .prepare(
      `INSERT INTO settlements
         (group_id, from_member_id, to_member_id, amount_cents, note,
          original_amount_cents, original_currency, rate_e8)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.groupId,
      input.fromMemberId,
      input.toMemberId,
      booked.amount_cents,
      input.note?.trim() ?? '',
      booked.original_amount_cents,
      booked.original_currency,
      booked.rate_e8
    );
  return Number(info.lastInsertRowid);
}

export function deleteSettlement(id: number): void {
  db.prepare('DELETE FROM settlements WHERE id = ?').run(id);
}

/* ---------------------------------------------------------------- balances */

/**
 * net = (what they fronted) - (their share of everything)
 *     + (cash they handed over)  - (cash they received)
 */
export function getBalances(groupId: number): Balance[] {
  return db
    .prepare(
      `SELECT m.id AS member_id,
              m.name,
              COALESCE(paid.total, 0)                        AS paid_cents,
              COALESCE(owed.total, 0)                        AS owed_cents,
              COALESCE(paid.total, 0) - COALESCE(owed.total, 0)
                + COALESCE(sent.total, 0) - COALESCE(recv.total, 0) AS net_cents
         FROM members m
         LEFT JOIN (SELECT paid_by AS mid, SUM(amount_cents) AS total
                      FROM expenses WHERE group_id = @gid GROUP BY paid_by) paid
                ON paid.mid = m.id
         LEFT JOIN (SELECT s.member_id AS mid, SUM(s.amount_cents) AS total
                      FROM expense_splits s
                      JOIN expenses e ON e.id = s.expense_id
                     WHERE e.group_id = @gid GROUP BY s.member_id) owed
                ON owed.mid = m.id
         LEFT JOIN (SELECT from_member_id AS mid, SUM(amount_cents) AS total
                      FROM settlements WHERE group_id = @gid GROUP BY from_member_id) sent
                ON sent.mid = m.id
         LEFT JOIN (SELECT to_member_id AS mid, SUM(amount_cents) AS total
                      FROM settlements WHERE group_id = @gid GROUP BY to_member_id) recv
                ON recv.mid = m.id
        WHERE m.group_id = @gid
        ORDER BY net_cents DESC, m.id`
    )
    .all({ gid: groupId }) as Balance[];
}

export function getCategoryTotals(groupId: number): { category: string; total_cents: number }[] {
  return db
    .prepare(
      `SELECT category, SUM(amount_cents) AS total_cents
         FROM expenses WHERE group_id = ?
        GROUP BY category ORDER BY total_cents DESC`
    )
    .all(groupId) as { category: string; total_cents: number }[];
}
