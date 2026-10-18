import 'server-only';
import {
  NOT_UNDOABLE,
  alreadyUndoneMessage,
  expenseRestoredSummary,
  expenseRevertedSummary,
  isUndoableKind,
  memberGoneMessage,
  supersededMessage,
  type ExpenseSnapshot,
} from './activity';
import {
  actorName,
  getActivity,
  latestUndoableChange,
  logActivity,
  markUndone,
  snapshotExpense,
  undoableEntryIds,
  type ActivityEntry,
} from './activity-queries';
import { db } from './db';
import { getGroup, listMembers } from './queries';

/**
 * A refusal: the reason is safe to show as is, and `status` is the HTTP answer
 * for it. 409 means the log has moved on (superseded, already undone, someone
 * left); anything else thrown is a bug.
 */
export class UndoRefused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409
  ) {
    super(message);
  }
}

/** The entry doesn't exist in this group. */
export class UnknownEntry extends UndoRefused {
  constructor() {
    super('Unknown activity entry.', 404);
  }
}

/**
 * Why undoing this entry would be refused right now, or null when it would
 * succeed. The undo itself, the Undo buttons and the API's `undoable` all ask
 * this one question, so they can't disagree.
 */
export function undoRefusal(groupId: number, entry: ActivityEntry): UndoRefused | null {
  if (!isUndoableKind(entry.kind) || entry.expense_id === null) return new UndoRefused(NOT_UNDOABLE, 400);
  if (entry.undone_by_id !== null) return new UndoRefused(alreadyUndoneMessage(entry.id));

  const latest = latestUndoableChange(entry.expense_id);
  if (latest && latest.id !== entry.id) return new UndoRefused(supersededMessage(entry.id, latest.id));

  // Both kinds put back the version recorded before the change.
  const target = JSON.parse(entry.before_json!) as ExpenseSnapshot;
  const gone = missingMember(groupId, target);
  if (gone) return new UndoRefused(memberGoneMessage(target.expense.description, gone));

  const exists = snapshotExpense(entry.expense_id) !== undefined;
  if (entry.kind === 'expense_deleted' && exists) {
    return new UndoRefused(`"${target.expense.description}" already exists, so there's nothing to restore.`);
  }
  // An edit is only undoable while it's the latest change, so the expense
  // exists unless something outside the log removed it.
  if (entry.kind === 'expense_edited' && !exists) {
    return new UndoRefused(`"${target.expense.description}" no longer exists.`);
  }
  return null;
}

/** Ids of the group's entries that an undo would succeed on right now. */
export function undoableNow(groupId: number): number[] {
  return undoableEntryIds(groupId).filter((id) => {
    const entry = getActivity(groupId, id);
    return entry !== undefined && undoRefusal(groupId, entry) === null;
  });
}

/**
 * Undoes one activity entry: an expense_deleted entry restores the expense
 * exactly as it was deleted, an expense_edited entry puts back the version from
 * just before that edit. Both are straight restores of the stored snapshot,
 * with nothing recomputed or reconverted.
 *
 * Only the latest edit or deletion of an expense that hasn't itself been undone
 * can be undone. The restore, the mark on the old entry and the new
 * expense_restored / expense_reverted entry commit together or not at all.
 *
 * Returns the new entry's id. Throws UndoRefused, with the message to show,
 * when the undo isn't allowed; nothing is written then.
 */
export function undoActivity(groupId: number, entryId: number, actorId: number | null): number {
  const tx = db.transaction(() => {
    const entry = getActivity(groupId, entryId);
    const group = getGroup(groupId);
    if (!entry || !group) throw new UnknownEntry();
    const refusal = undoRefusal(groupId, entry);
    if (refusal) throw refusal;

    const expenseId = entry.expense_id!;
    const target = JSON.parse(entry.before_json!) as ExpenseSnapshot;
    const actor = actorName(groupId, actorId);

    if (entry.kind === 'expense_deleted') {
      insertExpense(target);
      const restored = snapshotExpense(expenseId)!;
      const undoId = logActivity({
        groupId,
        kind: 'expense_restored',
        actorId,
        actorName: actor,
        summary: expenseRestoredSummary(
          actor,
          restored.expense.description,
          restored.expense.amount_cents,
          group.currency
        ),
        amountBefore: null,
        amountAfter: restored.expense.amount_cents,
        expenseId,
        after: restored,
        undoesId: entry.id,
      });
      markUndone(entry.id, undoId);
      return undoId;
    }

    const current = snapshotExpense(expenseId)!;
    overwriteExpense(target);
    const reverted = snapshotExpense(expenseId)!;
    const undoId = logActivity({
      groupId,
      kind: 'expense_reverted',
      actorId,
      actorName: actor,
      summary: expenseRevertedSummary(actor, reverted.expense.description, entry.id),
      amountBefore: current.expense.amount_cents,
      amountAfter: reverted.expense.amount_cents,
      expenseId,
      before: current,
      after: reverted,
      undoesId: entry.id,
    });
    markUndone(entry.id, undoId);
    return undoId;
  });

  return tx();
}

/** The name of the first person in the snapshot who has left the group, if anyone has. */
function missingMember(groupId: number, snapshot: ExpenseSnapshot): string | null {
  const here = new Set(listMembers(groupId).map((m) => m.id));
  const needed = [snapshot.expense.paid_by, ...snapshot.splits.map((s) => s.member_id)];
  const gone = needed.find((id) => !here.has(id));
  if (gone === undefined) return null;
  return snapshot.member_names?.[gone] ?? 'a former member';
}

/**
 * The schedule link survives only while that period is still free; once the
 * schedule has posted the period again (or the schedule is gone), the restored
 * expense comes back as a one-off.
 */
function scheduleLink(e: ExpenseSnapshot['expense']): {
  recurring_id: number | null;
  period: string | null;
} {
  if (e.recurring_id === null) return { recurring_id: null, period: e.period };
  const schedule = db.prepare('SELECT 1 FROM recurring_expenses WHERE id = ?').get(e.recurring_id);
  const taken = db
    .prepare('SELECT 1 FROM expenses WHERE recurring_id = ? AND period = ? AND id <> ?')
    .get(e.recurring_id, e.period, e.id);
  return schedule && !taken
    ? { recurring_id: e.recurring_id, period: e.period }
    : { recurring_id: null, period: null };
}

function insertSplits(snapshot: ExpenseSnapshot): void {
  const insert = db.prepare(
    'INSERT INTO expense_splits (expense_id, member_id, amount_cents, weight) VALUES (?, ?, ?, ?)'
  );
  for (const s of snapshot.splits) insert.run(snapshot.expense.id, s.member_id, s.amount_cents, s.weight);
}

/** Puts a deleted expense back under its own id, created_at and all. */
function insertExpense(snapshot: ExpenseSnapshot): void {
  const e = snapshot.expense;
  const link = scheduleLink(e);
  db.prepare(
    `INSERT INTO expenses
       (id, group_id, description, amount_cents, paid_by, category, split_type, spent_at, created_at,
        original_amount_cents, original_currency, rate_e8, recurring_id, period)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.id,
    e.group_id,
    e.description,
    e.amount_cents,
    e.paid_by,
    e.category,
    e.split_type,
    e.spent_at,
    e.created_at,
    e.original_amount_cents,
    e.original_currency,
    e.rate_e8,
    link.recurring_id,
    link.period
  );
  insertSplits(snapshot);

  // Plan interest is told apart from spending by this link, so budgets and the
  // export only match the pre-delete state once it's back.
  if (snapshot.plan_installment_id) {
    db.prepare(
      'UPDATE plan_installments SET interest_expense_id = ? WHERE id = ? AND interest_expense_id IS NULL'
    ).run(e.id, snapshot.plan_installment_id);
  }
}

/**
 * Rewrites an existing expense to a stored version, every field and split. When
 * that version was a recurring posting (the edit being undone detached it), the
 * link comes back and the period it held for the schedule is released again.
 */
function overwriteExpense(snapshot: ExpenseSnapshot): void {
  const e = snapshot.expense;
  const link = scheduleLink(e);
  db.prepare(
    `UPDATE expenses
        SET description = ?, amount_cents = ?, paid_by = ?, category = ?, split_type = ?,
            spent_at = ?, original_amount_cents = ?, original_currency = ?, rate_e8 = ?,
            recurring_id = ?, period = ?
      WHERE id = ?`
  ).run(
    e.description,
    e.amount_cents,
    e.paid_by,
    e.category,
    e.split_type,
    e.spent_at,
    e.original_amount_cents,
    e.original_currency,
    e.rate_e8,
    link.recurring_id,
    link.period,
    e.id
  );
  if (link.recurring_id !== null) {
    db.prepare('DELETE FROM recurring_detached WHERE recurring_id = ? AND period = ?').run(
      link.recurring_id,
      link.period
    );
  }
  db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(e.id);
  insertSplits(snapshot);
}
