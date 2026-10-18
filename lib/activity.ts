/**
 * The per-group activity log: who added, edited or deleted what.
 *
 * Holds no database handle: kinds, the clock, actor resolution and summary
 * building are pure, so tests can exercise them without the app's connection.
 * lib/activity-queries.ts does the reads and writes.
 */

import { csvAmount, type CsvValue } from './csv';
import { formatDate } from './dates';
import { formatCents } from './money';
import type { Expense, Settlement } from './types';

export const ACTIVITY_KINDS = [
  'expense_created',
  'expense_edited',
  'expense_deleted',
  'expense_restored',
  'expense_reverted',
  'settlement_created',
  'settlement_deleted',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  expense_created: 'Expense added',
  expense_edited: 'Expense edited',
  expense_deleted: 'Expense deleted',
  settlement_created: 'Payment recorded',
  settlement_deleted: 'Payment deleted',
  expense_restored: 'Expense restored',
  expense_reverted: 'Expense reverted',
};

/** The only kinds an undo can act on. */
export const UNDOABLE_KINDS = ['expense_edited', 'expense_deleted'] as const;

export function isUndoableKind(kind: string): boolean {
  return (UNDOABLE_KINDS as readonly string[]).includes(kind);
}

export function isActivityKind(value: string): value is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(value);
}

/** The name shown for entries Tally wrote by itself (recurring and plan postings). */
export const SYSTEM_ACTOR_NAME = 'Tally';

/** The activity_actor value that selects Tally's own entries. */
export const SYSTEM_ACTOR_PARAM = 'tally';

/** One row of the activity table, as the query layer reads it. */
export type ActivityEntry = {
  id: number;
  group_id: number;
  kind: ActivityKind;
  occurred_at: string;
  actor_id: number | null;
  actor_name: string | null;
  summary: string;
  amount_before: number | null;
  amount_after: number | null;
  expense_id: number | null;
  settlement_id: number | null;
  before_json: string | null;
  after_json: string | null;
  /** On an undone entry: the restore or revert entry that undid it. */
  undone_by_id: number | null;
  /** On a restore or revert entry: the entry it undid. */
  undoes_id: number | null;
};

/* ------------------------------------------------------------------- clock */

/**
 * Now, as an ISO 8601 UTC timestamp to the second. TALLY_NOW pins it, so a test
 * can say exactly when an entry was written. Every activity timestamp comes
 * from here.
 */
export function activityNow(): string {
  const pinned = process.env.TALLY_NOW;
  if (pinned) return pinned;
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** '2026-10-18T14:03:22Z' -> 'Oct 18 · 14:03 UTC'. The log keeps UTC, so it says so. */
export function formatActivityTime(iso: string): string {
  const time = /T(\d{2}:\d{2})/.exec(iso)?.[1];
  return time ? `${formatDate(iso)} · ${time} UTC` : formatDate(iso);
}

/* ------------------------------------------------------------------- actor */

/** Members are per group, so the acting-as choice is too. */
export function actorCookieName(groupId: number): string {
  return `tally_actor_${groupId}`;
}

/**
 * Who is acting: the member the cookie names when they still belong to the
 * group, otherwise the group's first member (lowest id). Undefined only for a
 * group with nobody in it.
 */
export function resolveActor<M extends { id: number }>(
  members: M[],
  cookieValue: string | undefined
): M | undefined {
  const wanted = cookieValue !== undefined && /^\d+$/.test(cookieValue) ? Number(cookieValue) : NaN;
  const chosen = members.find((m) => m.id === wanted);
  if (chosen) return chosen;
  return members.reduce<M | undefined>((low, m) => (low === undefined || m.id < low.id ? m : low), undefined);
}

/* --------------------------------------------------------------- snapshots */

export type SplitSnapshot = { member_id: number; amount_cents: number; weight: number | null };

/** The whole expense row plus its splits, enough to put it back exactly. */
export type ExpenseSnapshot = {
  expense: Expense;
  splits: SplitSnapshot[];
  /**
   * Names of the payer and everyone in the split when the snapshot was taken,
   * so a refused restore can say who has left the group since.
   */
  member_names?: Record<number, string>;
  /** The plan instalment whose interest this expense is, so a restore relinks it. */
  plan_installment_id?: number | null;
};

/** The whole settlement row. */
export type SettlementSnapshot = { settlement: Settlement };

/** The fields an edit summary can name, in the order it names them. */
export const EDIT_FIELDS = [
  'description',
  'amount',
  'payer',
  'date',
  'category',
  'currency',
  'split',
] as const;

export type EditField = (typeof EDIT_FIELDS)[number];

/**
 * The per-person input a split was made from: the cents for an exact split,
 * the basis points or centishares otherwise, nothing for an equal one.
 */
function splitKey(snapshot: ExpenseSnapshot): string {
  const { split_type } = snapshot.expense;
  const people = [...snapshot.splits]
    .sort((a, b) => a.member_id - b.member_id)
    .map((s) => {
      if (split_type === 'equal') return `${s.member_id}`;
      if (split_type === 'exact') return `${s.member_id}:${s.amount_cents}`;
      return `${s.member_id}:${s.weight}`;
    });
  return `${split_type}|${people.join(',')}`;
}

/** What an edit changed, in EDIT_FIELDS order. Empty when nothing did. */
export function changedFields(before: ExpenseSnapshot, after: ExpenseSnapshot): EditField[] {
  const a = before.expense;
  const b = after.expense;
  const changed: Record<EditField, boolean> = {
    description: a.description !== b.description,
    amount: a.amount_cents !== b.amount_cents || a.original_amount_cents !== b.original_amount_cents,
    payer: a.paid_by !== b.paid_by,
    date: a.spent_at.slice(0, 10) !== b.spent_at.slice(0, 10),
    category: a.category !== b.category,
    currency: a.original_currency !== b.original_currency,
    split: splitKey(before) !== splitKey(after),
  };
  return EDIT_FIELDS.filter((f) => changed[f]);
}

/* --------------------------------------------------------------- summaries */

const who = (actorName: string | null) => actorName ?? SYSTEM_ACTOR_NAME;

export function expenseCreatedSummary(
  actorName: string | null,
  description: string,
  amountCents: number,
  currency: string
): string {
  return `${who(actorName)} added "${description}" (${formatCents(amountCents, currency)})`;
}

export function expenseEditedSummary(
  actorName: string | null,
  descriptionAfter: string,
  fields: EditField[],
  detached = false
): string {
  const tail = detached ? ' and detached it from its recurring schedule' : '';
  return `${who(actorName)} edited "${descriptionAfter}" (${fields.join(', ')})${tail}`;
}

export function expenseDeletedSummary(
  actorName: string | null,
  description: string,
  amountCents: number,
  currency: string
): string {
  return `${who(actorName)} deleted "${description}" (${formatCents(amountCents, currency)})`;
}

export function settlementSummary(
  kind: 'settlement_created' | 'settlement_deleted',
  actorName: string | null,
  amountCents: number,
  currency: string,
  fromName: string,
  toName: string
): string {
  const verb = kind === 'settlement_created' ? 'recorded' : 'deleted';
  return `${who(actorName)} ${verb} a payment of ${formatCents(amountCents, currency)} from ${fromName} to ${toName}`;
}

export function expenseRestoredSummary(
  actorName: string | null,
  description: string,
  amountCents: number,
  currency: string
): string {
  return `${who(actorName)} restored "${description}" (${formatCents(amountCents, currency)})`;
}

export function expenseRevertedSummary(
  actorName: string | null,
  description: string,
  undoneEntryId: number
): string {
  return `${who(actorName)} reverted "${description}" to its version before entry #${undoneEntryId}`;
}

/* ---------------------------------------------------------- undo refusals */

export const NOT_UNDOABLE = 'Only edits and deletions of expenses can be undone.';

export function alreadyUndoneMessage(entryId: number): string {
  return `Entry #${entryId} has already been undone.`;
}

export function supersededMessage(entryId: number, laterEntryId: number): string {
  return `Can't undo entry #${entryId}. Entry #${laterEntryId} changed this expense afterwards, undo that one first.`;
}

export function memberGoneMessage(description: string, memberName: string): string {
  return `Can't restore "${description}" because ${memberName} is no longer in this group.`;
}

/* ------------------------------------------------------------------ filters */

export type ActivityFilters = {
  /** A member id, 'tally' for Tally's own entries, or undefined for everyone. */
  actor?: number | typeof SYSTEM_ACTOR_PARAM;
  kind?: ActivityKind;
  /** Entries at or after this instant, as 'YYYY-MM-DDTHH:MM:SSZ'. */
  since?: string;
};

/** Reads activity_actor and activity_kind, ignoring anything malformed. */
export function activityFiltersFrom(input: Record<string, string | string[] | undefined>): ActivityFilters {
  const actor = input.activity_actor;
  const kind = input.activity_kind;
  return {
    actor:
      actor === SYSTEM_ACTOR_PARAM
        ? SYSTEM_ACTOR_PARAM
        : typeof actor === 'string' && /^\d+$/.test(actor)
          ? Number(actor)
          : undefined,
    kind: typeof kind === 'string' && isActivityKind(kind) ? kind : undefined,
  };
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

/**
 * A bare date (the start of that day in UTC) or a full UTC timestamp, as the
 * second-precision string the log stores, so a plain string comparison is
 * exact. A fractional second rounds up: "at or after 14:03:22.5" excludes 14:03:22.
 */
export function parseSince(value: string): string | null {
  const m = UTC_STAMP.exec(value) ?? DATE_ONLY.exec(value);
  if (!m) return null;
  const [y, mo, d, h = '0', mi = '0', sec = '0', frac] = m.slice(1);
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  const back = new Date(ms);
  // Date.UTC rolls 2026-02-30 over into March; a real date survives the round trip.
  if (back.getUTCFullYear() !== +y || back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d) return null;
  if (+h > 23 || +mi > 59 || +sec > 59) return null;
  const rounded = frac && Number(frac) > 0 ? ms + 1000 : ms;
  return new Date(rounded).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The kind, since and actor query parameters the JSON route and the CSV export
 * share. Anything malformed is an error rather than silently a wider result.
 */
export function parseActivityParams(
  params: URLSearchParams
): { filters: ActivityFilters } | { error: string } {
  const filters: ActivityFilters = {};

  const kind = params.get('kind');
  if (kind !== null) {
    if (!isActivityKind(kind)) {
      return { error: `kind must be one of: ${ACTIVITY_KINDS.join(', ')} (got "${kind}").` };
    }
    filters.kind = kind;
  }

  const since = params.get('since');
  if (since !== null) {
    const parsed = parseSince(since);
    if (!parsed) return { error: `since must be an ISO date or UTC timestamp (got "${since}").` };
    filters.since = parsed;
  }

  const actor = params.get('actor');
  if (actor !== null) {
    if (actor === SYSTEM_ACTOR_PARAM) filters.actor = SYSTEM_ACTOR_PARAM;
    else if (/^\d+$/.test(actor)) filters.actor = Number(actor);
    else return { error: `actor must be a member id or tally (got "${actor}").` };
  }

  return { filters };
}

/* ------------------------------------------------------------------ output */

/**
 * One entry as GET /api/groups/:id/activity returns it. The stored snapshots
 * stay out; `undoable` is whether an undo would succeed right now.
 */
export function activityJson(entry: ActivityEntry, undoable: boolean) {
  return {
    id: entry.id,
    kind: entry.kind,
    at: entry.occurred_at,
    actor: entry.actor_id === null ? null : { id: entry.actor_id, name: entry.actor_name },
    summary: entry.summary,
    amount_before: entry.amount_before,
    amount_after: entry.amount_after,
    expense_id: entry.expense_id,
    settlement_id: entry.settlement_id,
    undoable,
    undone_by: entry.undone_by_id,
  };
}

export const ACTIVITY_CSV_HEADERS = [
  'id',
  'at',
  'kind',
  'actor',
  'summary',
  'amount_before',
  'amount_after',
  'currency',
  'expense_id',
  'settlement_id',
  'undone_by',
];

/**
 * The activity dataset of the CSV export, ready for toCsv. Names and
 * descriptions are user input that reach the actor and summary cells, which is
 * why these go through toCsv's formula guard like every other dataset.
 */
export function activityCsvTable(
  entries: ActivityEntry[],
  currency: string
): { headers: string[]; rows: CsvValue[][] } {
  return {
    headers: ACTIVITY_CSV_HEADERS,
    rows: entries.map((a) => [
      a.id,
      a.occurred_at,
      a.kind,
      a.actor_name ?? SYSTEM_ACTOR_NAME,
      a.summary,
      a.amount_before === null ? '' : csvAmount(a.amount_before),
      a.amount_after === null ? '' : csvAmount(a.amount_after),
      currency,
      a.expense_id,
      a.settlement_id,
      a.undone_by_id,
    ]),
  };
}
