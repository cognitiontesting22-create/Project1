import 'server-only';
import { buildSchedule, type Installment } from './amortize';
import { convertMinorUnits } from './currency';
import { db } from './db';
import {
  computeSplits,
  createExpense,
  createSettlement,
  getGroup,
  getRateE8,
  listMembers,
} from './queries';
import {
  nextOccurrenceAfter,
  occurrencesThrough,
  occurrenceDate,
  parseISODate,
  today,
} from './schedule';
import type { PaymentPlan, PlanInstallment, RecurringExpense, SplitType } from './types';

/* ------------------------------------------------------- recurring expenses */

export function listRecurring(groupId: number): RecurringExpense[] {
  const rows = db
    .prepare(
      `SELECT r.*, m.name AS paid_by_name,
              (SELECT COUNT(*) FROM expenses e WHERE e.recurring_id = r.id) AS posted_count
         FROM recurring_expenses r
         JOIN members m ON m.id = r.paid_by
        WHERE r.group_id = ?
        ORDER BY r.active DESC, r.id DESC`
    )
    .all(groupId) as RecurringExpense[];

  const partStmt = db.prepare(
    `SELECT p.member_id, p.value, m.name
       FROM recurring_participants p
       JOIN members m ON m.id = p.member_id
      WHERE p.recurring_id = ?
      ORDER BY m.id`
  );

  return rows.map((r) => ({
    ...r,
    active: Number(r.active),
    participants: partStmt.all(r.id) as RecurringExpense['participants'],
    next_due:
      Number(r.active) === 1
        ? (nextOccurrenceAfter({
            startDate: r.start_date,
            anchorDay: r.anchor_day,
            intervalMonths: r.interval_months,
            after: today(),
          })?.date ?? null)
        : null,
  }));
}

export function createRecurring(input: {
  groupId: number;
  description: string;
  amountCents: number;
  currency: string;
  paidBy: number;
  category: string;
  splitType: SplitType;
  anchorDay: number;
  intervalMonths: number;
  startDate: string;
  endDate?: string | null;
  participants: number[];
  values?: Record<number, number>;
}): number {
  const group = getGroup(input.groupId);
  if (!group) throw new Error('That group no longer exists.');

  if (input.participants.length === 0) {
    throw new Error('Select at least one person to split between.');
  }
  if (input.anchorDay < 1 || input.anchorDay > 31) {
    throw new Error('Pick a day of the month between 1 and 31.');
  }
  parseISODate(input.startDate); // throws on a malformed date

  // Validate the split now, against the template, so a recurrence can never be
  // saved in a state that would fail every month when it tries to post.
  createExpenseDryRun(input);

  const tx = db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO recurring_expenses
             (group_id, description, amount_cents, currency, paid_by, category,
              split_type, anchor_day, interval_months, start_date, end_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.groupId,
          input.description.trim(),
          input.amountCents,
          input.currency,
          input.paidBy,
          input.category,
          input.splitType,
          input.anchorDay,
          input.intervalMonths,
          input.startDate,
          input.endDate || null
        ).lastInsertRowid
    );

    const ins = db.prepare(
      'INSERT INTO recurring_participants (recurring_id, member_id, value) VALUES (?, ?, ?)'
    );
    for (const memberId of input.participants) {
      ins.run(id, memberId, input.splitType === 'equal' ? null : (input.values?.[memberId] ?? 0));
    }
    return id;
  });

  return tx();
}

/**
 * Runs the exact same split validation the monthly posting will run, without
 * writing anything — so a recurrence can't be saved in a state that would fail
 * silently every month when it tries to post.
 */
function createExpenseDryRun(input: {
  groupId: number;
  amountCents: number;
  currency: string;
  splitType: SplitType;
  participants: number[];
  values?: Record<number, number>;
}) {
  const group = getGroup(input.groupId)!;
  const target = convertMinorUnits(
    input.amountCents,
    getRateE8(input.currency),
    getRateE8(group.currency)
  );

  computeSplits({
    groupId: input.groupId,
    description: 'validation',
    amountCents: input.amountCents,
    paidBy: input.participants[0],
    splitType: input.splitType,
    participants: input.participants,
    values: input.values,
    currency: input.currency,
    targetCents: target,
  });
}

export function setRecurringActive(id: number, active: boolean): void {
  db.prepare('UPDATE recurring_expenses SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

export function deleteRecurring(id: number): void {
  db.prepare('DELETE FROM recurring_expenses WHERE id = ?').run(id);
}

/* -------------------------------------------------------------- posting */

/**
 * Materialises everything that has come due for a group: recurring expenses and
 * payment-plan instalments.
 *
 * Called on page load rather than from a cron, so a laptop that was closed for
 * two months catches up the moment you open the group. That makes idempotency
 * the critical property, not a nice-to-have — it is enforced by a unique index
 * on (recurring_id, period) and by claiming each instalment row inside a
 * transaction, so concurrent requests can't double-post.
 */
export function postDueItems(groupId: number): { expenses: number; installments: number } {
  return {
    expenses: postDueRecurrences(groupId),
    installments: postDueInstallments(groupId),
  };
}

function postDueRecurrences(groupId: number): number {
  const now = today();
  const recurrences = db
    .prepare('SELECT * FROM recurring_expenses WHERE group_id = ? AND active = 1')
    .all(groupId) as RecurringExpense[];

  let posted = 0;

  for (const r of recurrences) {
    const through = r.end_date && r.end_date < now ? r.end_date : now;

    const due = occurrencesThrough({
      startDate: r.start_date,
      anchorDay: r.anchor_day,
      intervalMonths: r.interval_months,
      through,
    });
    if (due.length === 0) continue;

    const participants = db
      .prepare('SELECT member_id, value FROM recurring_participants WHERE recurring_id = ?')
      .all(r.id) as { member_id: number; value: number | null }[];
    if (participants.length === 0) continue;

    const values: Record<number, number> = {};
    for (const p of participants) if (p.value !== null) values[p.member_id] = p.value;

    const alreadyPosted = new Set(
      (
        db
          .prepare('SELECT period FROM expenses WHERE recurring_id = ?')
          .all(r.id) as { period: string }[]
      ).map((row) => row.period)
    );

    for (const occurrence of due) {
      if (alreadyPosted.has(occurrence.period)) continue;
      try {
        createExpense({
          groupId,
          description: r.description,
          amountCents: r.amount_cents,
          paidBy: r.paid_by,
          category: r.category,
          splitType: r.split_type,
          spentAt: occurrence.date,
          participants: participants.map((p) => p.member_id),
          values,
          currency: r.currency,
          recurringId: r.id,
          period: occurrence.period,
        });
        posted++;
      } catch (err) {
        // A recurrence whose members left the group (or whose split no longer
        // validates) must not break the whole page — skip it and move on.
        const message = err instanceof Error ? err.message : String(err);
        if (!/UNIQUE constraint/i.test(message)) {
          console.error(`Recurring expense ${r.id} (${occurrence.period}) failed: ${message}`);
        }
      }
    }
  }

  return posted;
}

/**
 * Posts a due instalment as two ordinary ledger rows:
 *
 *   1. a settlement debtor -> creditor for the payment, and
 *   2. when interest is owed, an expense paid by the creditor and split 100%
 *      onto the debtor.
 *
 * Net effect on balances is exactly the principal portion, and because both
 * rows are ordinary primitives the group's balances still sum to zero without
 * the balance query needing to know plans exist at all.
 */
function postDueInstallments(groupId: number): number {
  const now = today();

  const due = db
    .prepare(
      `SELECT i.*, p.debtor_id, p.creditor_id, p.group_id
         FROM plan_installments i
         JOIN payment_plans p ON p.id = i.plan_id
        WHERE p.group_id = ? AND p.cancelled = 0
          AND i.posted_at IS NULL AND i.due_date <= ?
        ORDER BY i.due_date, i.number`
    )
    .all(groupId, now) as (PlanInstallment & {
    debtor_id: number;
    creditor_id: number;
    group_id: number;
  })[];

  let posted = 0;

  for (const inst of due) {
    const tx = db.transaction(() => {
      // Claim the row first. If another request already posted it, the update
      // affects nothing and we bail out without writing ledger rows.
      const claimed = db
        .prepare("UPDATE plan_installments SET posted_at = datetime('now') WHERE id = ? AND posted_at IS NULL")
        .run(inst.id);
      if (claimed.changes === 0) return false;

      let settlementId: number | null = null;
      let interestExpenseId: number | null = null;

      if (inst.payment_cents > 0) {
        settlementId = createSettlement({
          groupId,
          fromMemberId: inst.debtor_id,
          toMemberId: inst.creditor_id,
          amountCents: inst.payment_cents,
          note: `Plan instalment #${inst.number}`,
        });
      }

      if (inst.interest_cents > 0) {
        interestExpenseId = createExpense({
          groupId,
          description: `Interest · instalment #${inst.number}`,
          amountCents: inst.interest_cents,
          paidBy: inst.creditor_id,
          category: 'general',
          splitType: 'exact',
          spentAt: inst.due_date,
          participants: [inst.debtor_id],
          values: { [inst.debtor_id]: inst.interest_cents },
        });
      }

      db.prepare(
        'UPDATE plan_installments SET settlement_id = ?, interest_expense_id = ? WHERE id = ?'
      ).run(settlementId, interestExpenseId, inst.id);

      return true;
    });

    try {
      if (tx()) posted++;
    } catch (err) {
      console.error(
        `Plan instalment ${inst.id} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return posted;
}

/* --------------------------------------------------------- payment plans */

export function listPlans(groupId: number): PaymentPlan[] {
  const plans = db
    .prepare(
      `SELECT p.*, d.name AS debtor_name, c.name AS creditor_name
         FROM payment_plans p
         JOIN members d ON d.id = p.debtor_id
         JOIN members c ON c.id = p.creditor_id
        WHERE p.group_id = ?
        ORDER BY p.cancelled, p.id DESC`
    )
    .all(groupId) as PaymentPlan[];

  const instStmt = db.prepare(
    'SELECT * FROM plan_installments WHERE plan_id = ? ORDER BY number'
  );

  return plans.map((p) => {
    const schedule = instStmt.all(p.id) as PlanInstallment[];
    const paid = schedule.filter((i) => i.posted_at !== null);
    return {
      ...p,
      cancelled: Number(p.cancelled),
      schedule,
      paid_count: paid.length,
      paid_cents: paid.reduce((s, i) => s + i.payment_cents, 0),
      remaining_cents: schedule
        .filter((i) => i.posted_at === null)
        .reduce((s, i) => s + i.payment_cents, 0),
      interest_cents: schedule.reduce((s, i) => s + i.interest_cents, 0),
      total_cents: schedule.reduce((s, i) => s + i.payment_cents, 0),
      next_due: schedule.find((i) => i.posted_at === null)?.due_date ?? null,
    };
  });
}

export function createPlan(input: {
  groupId: number;
  debtorId: number;
  creditorId: number;
  principalCents: number;
  aprBp: number;
  installments: number;
  gracePeriods: number;
  anchorDay: number;
  startDate: string;
  note?: string;
}): number {
  if (input.debtorId === input.creditorId) {
    throw new Error('A plan needs two different people.');
  }
  const memberIds = new Set(listMembers(input.groupId).map((m) => m.id));
  if (!memberIds.has(input.debtorId) || !memberIds.has(input.creditorId)) {
    throw new Error('Both people have to be members of this group.');
  }
  if (input.anchorDay < 1 || input.anchorDay > 31) {
    throw new Error('Pick a day of the month between 1 and 31.');
  }

  // Throws if the terms can't produce a schedule that reconciles.
  const schedule = buildSchedule({
    principalCents: input.principalCents,
    aprBp: input.aprBp,
    installments: input.installments,
    gracePeriods: input.gracePeriods,
  });

  const start = parseISODate(input.startDate);

  const tx = db.transaction(() => {
    const planId = Number(
      db
        .prepare(
          `INSERT INTO payment_plans
             (group_id, debtor_id, creditor_id, principal_cents, apr_bp,
              installments, grace_periods, anchor_day, start_date, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.groupId,
          input.debtorId,
          input.creditorId,
          input.principalCents,
          input.aprBp,
          input.installments,
          input.gracePeriods,
          input.anchorDay,
          input.startDate,
          input.note?.trim() ?? ''
        ).lastInsertRowid
    );

    const ins = db.prepare(
      `INSERT INTO plan_installments
         (plan_id, number, due_date, period, payment_cents, principal_cents,
          interest_cents, balance_cents, in_grace)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    schedule.forEach((inst: Installment, i: number) => {
      // Instalment 1 falls in the start month; the rest step by one month,
      // clamping to each month's last day without losing the anchor.
      const monthsOut = start.month - 1 + i;
      const year = start.year + Math.floor(monthsOut / 12);
      const month = (monthsOut % 12) + 1;
      const dueDate = occurrenceDate(year, month, input.anchorDay);

      ins.run(
        planId,
        inst.number,
        dueDate,
        `${year}-${String(month).padStart(2, '0')}`,
        inst.payment_cents,
        inst.principal_cents,
        inst.interest_cents,
        inst.balance_cents,
        inst.in_grace ? 1 : 0
      );
    });

    return planId;
  });

  return tx();
}

export function cancelPlan(id: number): void {
  // Cancelling stops future instalments; anything already posted stays on the
  // ledger, because that money really did move.
  db.prepare('UPDATE payment_plans SET cancelled = 1 WHERE id = ?').run(id);
}

export function deletePlan(id: number): void {
  const posted = db
    .prepare('SELECT COUNT(*) AS n FROM plan_installments WHERE plan_id = ? AND posted_at IS NOT NULL')
    .get(id) as { n: number };
  if (posted.n > 0) {
    throw new Error('This plan has already posted instalments — cancel it instead.');
  }
  db.prepare('DELETE FROM payment_plans WHERE id = ?').run(id);
}
