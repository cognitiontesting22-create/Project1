'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { actorCookieName } from '@/lib/activity';
import { currentActorId } from '@/lib/actor';
import { UndoRefused, undoActivity } from '@/lib/undo';
import * as bq from '@/lib/budget-queries';
import { isBudgetCategory, isEditableMonth, isMonth } from '@/lib/budgets';
import { rateFromInput } from '@/lib/currency';
import { expenseFieldsFromForm, expenseInputFrom } from '@/lib/expense-input';
import { toBasisPoints, toCents } from '@/lib/money';
import * as q from '@/lib/queries';
import * as sq from '@/lib/scheduling-queries';
import { today as todayISO } from '@/lib/schedule';
import { isSplitType } from '@/lib/types';

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/* ------------------------------------------------------------------ groups */

export async function createGroupAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return fail('Give your group a name.');

  const memberNames = String(formData.get('members') ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (memberNames.length < 1) return fail('Add at least one person to the group.');

  let groupId: number;
  try {
    groupId = q.createGroup({
      name,
      description: String(formData.get('description') ?? ''),
      emoji: String(formData.get('emoji') ?? '💸') || '💸',
      currency: String(formData.get('currency') ?? 'USD') || 'USD',
      memberNames,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not create the group.');
  }

  revalidatePath('/');
  redirect(`/groups/${groupId}`);
}

export async function deleteGroupAction(formData: FormData): Promise<void> {
  const id = Number(formData.get('groupId'));
  if (Number.isFinite(id)) q.deleteGroup(id);
  revalidatePath('/');
  redirect('/');
}

/* ----------------------------------------------------------------- members */

export async function addMemberAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const groupId = Number(formData.get('groupId'));
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return fail('Enter a name.');
  if (!Number.isFinite(groupId)) return fail('Unknown group.');

  q.addMember(groupId, name, String(formData.get('email') ?? ''));
  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

export async function removeMemberAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const groupId = Number(formData.get('groupId'));
  const memberId = Number(formData.get('memberId'));
  if (!Number.isFinite(memberId)) return fail('Unknown member.');

  if (q.memberHasActivity(memberId)) {
    return fail('That person already appears in expenses or settlements — settle up first.');
  }

  q.removeMember(memberId);
  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

/* ---------------------------------------------------------------- acting as */

/** Who later changes in this group are credited to. A year-long cookie per group. */
export async function setActorAction(formData: FormData): Promise<void> {
  const groupId = Number(formData.get('groupId'));
  const memberId = Number(formData.get('memberId'));
  if (!Number.isInteger(groupId) || !q.listMembers(groupId).some((m) => m.id === memberId)) return;

  (await cookies()).set(actorCookieName(groupId), String(memberId), {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath(`/groups/${groupId}`);
}

/* ---------------------------------------------------------------- expenses */

/** The expense form, as create and edit both submit it. */
function readExpenseForm(formData: FormData) {
  const groupId = Number(formData.get('groupId'));
  const fields = expenseFieldsFromForm(formData);
  return { groupId, ...expenseInputFrom(groupId, q.getGroup(groupId), fields) };
}

export async function createExpenseAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = readExpenseForm(formData);
  if ('error' in parsed) return fail(parsed.error);

  try {
    q.createExpense({ ...parsed.input, actorId: await currentActorId(parsed.groupId) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save the expense.');
  }

  revalidatePath(`/groups/${parsed.groupId}`);
  return { ok: true };
}

export async function updateExpenseAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const expenseId = Number(formData.get('expenseId'));
  if (!Number.isInteger(expenseId)) return fail('Unknown expense.');
  if (q.expenseSource(expenseId) === 'plan') return fail(q.PLAN_LOCKED_MESSAGE);

  const parsed = readExpenseForm(formData);
  if ('error' in parsed) return fail(parsed.error);

  try {
    q.updateExpense(expenseId, {
      ...parsed.input,
      actorId: await currentActorId(parsed.groupId),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save the expense.');
  }

  revalidatePath(`/groups/${parsed.groupId}`);
  return { ok: true };
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const groupId = Number(formData.get('groupId'));
  const id = Number(formData.get('expenseId'));
  if (Number.isFinite(id)) q.deleteExpense(id, await currentActorId(groupId));
  revalidatePath(`/groups/${groupId}`);
}

/* ------------------------------------------------------------- settlements */

export async function createSettlementAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const groupId = Number(formData.get('groupId'));
  const fromMemberId = Number(formData.get('fromMemberId'));
  const toMemberId = Number(formData.get('toMemberId'));
  const amountCents = toCents(String(formData.get('amount') ?? ''));

  if (!Number.isFinite(fromMemberId) || !Number.isFinite(toMemberId)) {
    return fail('Pick both people.');
  }
  if (fromMemberId === toMemberId) return fail('Those are the same person.');
  if (!Number.isFinite(amountCents) || amountCents <= 0) return fail('Enter an amount above zero.');

  try {
    q.createSettlement({
      groupId,
      fromMemberId,
      toMemberId,
      amountCents,
      currency: String(formData.get('currency') ?? '') || undefined,
      note: String(formData.get('note') ?? ''),
      actorId: await currentActorId(groupId),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not record the payment.');
  }

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

/* ---------------------------------------------------------------- rates */

export async function saveRateAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const currency = String(formData.get('currency') ?? '');
  const rateE8 = rateFromInput(String(formData.get('rate') ?? ''));

  if (!Number.isFinite(rateE8)) return fail('Enter a rate above zero.');

  try {
    q.upsertRate(currency, rateE8);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save that rate.');
  }

  revalidatePath('/rates');
  return { ok: true };
}

export async function deleteRateAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    q.deleteRate(String(formData.get('currency') ?? ''));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not remove that currency.');
  }
  revalidatePath('/rates');
  return { ok: true };
}

export async function deleteSettlementAction(formData: FormData): Promise<void> {
  const groupId = Number(formData.get('groupId'));
  const id = Number(formData.get('settlementId'));
  if (Number.isFinite(id)) q.deleteSettlement(id, await currentActorId(groupId));
  revalidatePath(`/groups/${groupId}`);
}

/* ------------------------------------------------------ recurring expenses */

export async function createRecurringAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const groupId = Number(formData.get('groupId'));
  const description = String(formData.get('description') ?? '').trim();
  const amountCents = toCents(String(formData.get('amount') ?? ''));
  const paidBy = Number(formData.get('paidBy'));
  const rawSplitType = String(formData.get('splitType') ?? 'equal');
  const anchorDay = Number(formData.get('anchorDay'));
  const intervalMonths = Number(formData.get('intervalMonths') ?? 1);

  if (!description) return fail('What is this recurring charge for?');
  if (!Number.isFinite(amountCents) || amountCents <= 0) return fail('Enter an amount above zero.');
  if (!Number.isFinite(paidBy)) return fail('Pick who pays it.');
  if (!isSplitType(rawSplitType)) return fail('Pick how to split it.');
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    return fail('Pick a day of the month between 1 and 31.');
  }

  const group = q.getGroup(groupId);
  if (!group) return fail('That group no longer exists.');

  const splitType = rawSplitType;
  const participants = formData
    .getAll('participants')
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  if (participants.length === 0) return fail('Select at least one person to split between.');

  const values: Record<number, number> = {};
  if (splitType !== 'equal') {
    const parse = splitType === 'exact' ? toCents : toBasisPoints;
    for (const id of participants) values[id] = parse(String(formData.get(`value_${id}`) ?? ''));
  }

  try {
    sq.createRecurring({
      groupId,
      description,
      amountCents,
      currency: String(formData.get('currency') ?? '') || group.currency,
      paidBy,
      category: String(formData.get('category') ?? 'rent'),
      splitType,
      anchorDay,
      intervalMonths: Number.isFinite(intervalMonths) ? intervalMonths : 1,
      startDate: String(formData.get('startDate') ?? '') || todayISO(),
      endDate: String(formData.get('endDate') ?? '') || null,
      participants,
      values,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save that recurring expense.');
  }

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

export async function toggleRecurringAction(formData: FormData): Promise<void> {
  const groupId = Number(formData.get('groupId'));
  const id = Number(formData.get('recurringId'));
  const active = String(formData.get('active')) === '1';
  if (Number.isFinite(id)) sq.setRecurringActive(id, active);
  revalidatePath(`/groups/${groupId}`);
}

export async function deleteRecurringAction(formData: FormData): Promise<void> {
  const groupId = Number(formData.get('groupId'));
  const id = Number(formData.get('recurringId'));
  if (Number.isFinite(id)) sq.deleteRecurring(id);
  revalidatePath(`/groups/${groupId}`);
}

/* ---------------------------------------------------------- payment plans */

export async function createPlanAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const groupId = Number(formData.get('groupId'));
  const debtorId = Number(formData.get('debtorId'));
  const creditorId = Number(formData.get('creditorId'));
  const principalCents = toCents(String(formData.get('principal') ?? ''));
  const aprBp = toBasisPoints(String(formData.get('apr') ?? '0'));
  const installments = Number(formData.get('installments'));
  const gracePeriods = Number(formData.get('gracePeriods') ?? 0);
  const anchorDay = Number(formData.get('anchorDay'));

  if (!Number.isFinite(debtorId) || !Number.isFinite(creditorId)) return fail('Pick both people.');
  if (debtorId === creditorId) return fail('A plan needs two different people.');
  if (!Number.isFinite(principalCents) || principalCents <= 0) {
    return fail('Enter an amount above zero.');
  }
  if (!Number.isFinite(aprBp) || aprBp < 0) return fail('Enter an interest rate of 0 or more.');
  if (!Number.isInteger(installments) || installments < 1) return fail('Choose how many months.');
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    return fail('Pick a day of the month between 1 and 31.');
  }

  try {
    sq.createPlan({
      groupId,
      debtorId,
      creditorId,
      principalCents,
      aprBp,
      installments,
      gracePeriods: Number.isFinite(gracePeriods) ? gracePeriods : 0,
      anchorDay,
      startDate: String(formData.get('startDate') ?? '') || todayISO(),
      note: String(formData.get('note') ?? ''),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not set up that plan.');
  }

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

export async function cancelPlanAction(formData: FormData): Promise<void> {
  const groupId = Number(formData.get('groupId'));
  const id = Number(formData.get('planId'));
  if (Number.isFinite(id)) sq.cancelPlan(id);
  revalidatePath(`/groups/${groupId}`);
}

export async function deletePlanAction(formData: FormData): Promise<void> {
  const groupId = Number(formData.get('groupId'));
  const id = Number(formData.get('planId'));
  try {
    if (Number.isFinite(id)) sq.deletePlan(id);
  } catch {
    // A plan with posted instalments can only be cancelled; ignore and re-render.
  }
  revalidatePath(`/groups/${groupId}`);
}

/* ----------------------------------------------------------------- budgets */

/** The fields both budget actions share, or the reason they're unusable. */
function readBudgetTarget(
  formData: FormData
): { groupId: number; category: string; month: string } | { error: string } {
  const groupId = Number(formData.get('groupId'));
  const category = String(formData.get('category') ?? '');
  const month = String(formData.get('month') ?? '');

  if (!q.getGroup(groupId)) return { error: 'That group no longer exists.' };
  if (!isBudgetCategory(category)) return { error: 'Pick a category.' };
  if (!isMonth(month)) return { error: 'Pick a month.' };
  if (!isEditableMonth(month)) {
    return { error: 'Past months keep the budget they had — pick this month or a later one.' };
  }
  return { groupId, category, month };
}

export async function setBudgetAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const target = readBudgetTarget(formData);
  if ('error' in target) return fail(target.error);

  const amountCents = toCents(String(formData.get('amount') ?? ''));
  if (!Number.isFinite(amountCents) || amountCents < 0) return fail('Enter an amount of zero or more.');

  bq.setBudget(target.groupId, target.category, target.month, amountCents);
  revalidatePath(`/groups/${target.groupId}`);
  return { ok: true };
}

export async function clearBudgetAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const target = readBudgetTarget(formData);
  if ('error' in target) return fail(target.error);

  bq.setBudget(target.groupId, target.category, target.month, null);
  revalidatePath(`/groups/${target.groupId}`);
  return { ok: true };
}

/* ---------------------------------------------------------------- activity */

/**
 * Undo from the Activity tab. Every check runs again here, so a stale page
 * gets the refusal message back instead of a silent no-op.
 */
export async function undoActivityAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const groupId = Number(formData.get('groupId'));
  const entryId = Number(formData.get('entryId'));
  if (!Number.isInteger(groupId) || !Number.isInteger(entryId)) return fail('Unknown activity entry.');

  try {
    undoActivity(groupId, entryId, await currentActorId(groupId));
  } catch (err) {
    if (err instanceof UndoRefused) return fail(err.message);
    throw err;
  }

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}
