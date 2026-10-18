import 'server-only';
import {
  SYSTEM_ACTOR_PARAM,
  UNDOABLE_KINDS,
  activityNow,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityKind,
  type ExpenseSnapshot,
  type SettlementSnapshot,
  type SplitSnapshot,
} from './activity';
import { db } from './db';
import type { Expense, Settlement } from './types';

export type { ActivityEntry };

export function snapshotExpense(id: number): ExpenseSnapshot | undefined {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as Expense | undefined;
  if (!expense) return undefined;
  const splits = db
    .prepare(
      'SELECT member_id, amount_cents, weight FROM expense_splits WHERE expense_id = ? ORDER BY member_id'
    )
    .all(id) as SplitSnapshot[];

  const names = db
    .prepare(
      `SELECT id, name FROM members
        WHERE id = ? OR id IN (SELECT member_id FROM expense_splits WHERE expense_id = ?)`
    )
    .all(expense.paid_by, id) as { id: number; name: string }[];
  const installment = db
    .prepare('SELECT id FROM plan_installments WHERE interest_expense_id = ?')
    .get(id) as { id: number } | undefined;

  return {
    expense,
    splits,
    member_names: Object.fromEntries(names.map((m) => [m.id, m.name])),
    plan_installment_id: installment?.id ?? null,
  };
}

export function snapshotSettlement(id: number): SettlementSnapshot | undefined {
  const settlement = db.prepare('SELECT * FROM settlements WHERE id = ?').get(id) as
    | Settlement
    | undefined;
  return settlement ? { settlement } : undefined;
}

/**
 * The actor's name as the log records it, or null for Tally. Someone who isn't
 * in the group can't act for it, so they're recorded as Tally rather than
 * under a stranger's name.
 */
export function actorName(groupId: number, actorId: number | null | undefined): string | null {
  if (actorId === null || actorId === undefined) return null;
  const row = db
    .prepare('SELECT name FROM members WHERE id = ? AND group_id = ?')
    .get(actorId, groupId) as { name: string } | undefined;
  return row?.name ?? null;
}

export function memberName(id: number): string {
  const row = db.prepare('SELECT name FROM members WHERE id = ?').get(id) as
    | { name: string }
    | undefined;
  return row?.name ?? 'Someone';
}

/**
 * Appends one entry. Callers run this inside the transaction that makes the
 * change, so the change and its entry commit or roll back together.
 */
export function logActivity(entry: {
  groupId: number;
  kind: ActivityKind;
  actorId: number | null;
  actorName: string | null;
  summary: string;
  amountBefore: number | null;
  amountAfter: number | null;
  expenseId?: number;
  settlementId?: number;
  before?: ExpenseSnapshot | SettlementSnapshot;
  after?: ExpenseSnapshot | SettlementSnapshot;
  /** For a restore or revert: the entry being undone. */
  undoesId?: number;
}): number {
  const info = db
    .prepare(
      `INSERT INTO activity
         (group_id, kind, occurred_at, actor_id, actor_name, summary, amount_before, amount_after,
          expense_id, settlement_id, before_json, after_json, undoes_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.groupId,
      entry.kind,
      activityNow(),
      entry.actorName === null ? null : entry.actorId,
      entry.actorName,
      entry.summary,
      entry.amountBefore,
      entry.amountAfter,
      entry.expenseId ?? null,
      entry.settlementId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.undoesId ?? null
    );
  return Number(info.lastInsertRowid);
}

export function getActivity(groupId: number, id: number): ActivityEntry | undefined {
  return db.prepare('SELECT * FROM activity WHERE id = ? AND group_id = ?').get(id, groupId) as
    | ActivityEntry
    | undefined;
}

const UNDOABLE_SQL = `kind IN (${UNDOABLE_KINDS.map((k) => `'${k}'`).join(', ')})
                      AND undone_by_id IS NULL`;

/**
 * The latest edit or deletion of an expense that hasn't been undone. Only that
 * entry can be undone; restores and reverts don't count, so undoing a newer
 * edit makes the one before it undoable again.
 */
export function latestUndoableChange(expenseId: number): ActivityEntry | undefined {
  return db
    .prepare(`SELECT * FROM activity WHERE expense_id = ? AND ${UNDOABLE_SQL} ORDER BY id DESC LIMIT 1`)
    .get(expenseId) as ActivityEntry | undefined;
}

/** Every entry in the group that an Undo button would currently act on. */
export function undoableEntryIds(groupId: number): number[] {
  return (
    db
      .prepare(
        `SELECT MAX(id) AS id FROM activity
          WHERE group_id = ? AND ${UNDOABLE_SQL}
          GROUP BY expense_id`
      )
      .all(groupId) as { id: number }[]
  ).map((r) => r.id);
}

export function markUndone(id: number, undoneById: number): void {
  db.prepare('UPDATE activity SET undone_by_id = ? WHERE id = ?').run(undoneById, id);
}

/** Newest first, by id, so two entries in the same second keep their order. */
export function listActivity(groupId: number, filters: ActivityFilters = {}): ActivityEntry[] {
  const where = ['group_id = @groupId'];
  const params: Record<string, unknown> = { groupId };

  if (filters.actor === SYSTEM_ACTOR_PARAM) where.push('actor_id IS NULL');
  else if (filters.actor !== undefined) {
    where.push('actor_id = @actor');
    params.actor = filters.actor;
  }
  if (filters.kind) {
    where.push('kind = @kind');
    params.kind = filters.kind;
  }
  if (filters.since) {
    where.push('occurred_at >= @since');
    params.since = filters.since;
  }

  return db
    .prepare(`SELECT * FROM activity WHERE ${where.join(' AND ')} ORDER BY id DESC`)
    .all(params) as ActivityEntry[];
}
