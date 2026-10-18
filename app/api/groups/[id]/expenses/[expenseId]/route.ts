import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { currentActorId } from '@/lib/actor';
import { expenseInputFromRequest } from '@/lib/expense-input';
import {
  ExpenseLocked,
  PLAN_LOCKED_MESSAGE,
  deleteExpense,
  expenseSource,
  getExpense,
  getGroup,
  updateExpense,
  type UpdateResult,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; expenseId: string }> };

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** The group and expense from the URL, or the 404 to answer with. */
async function target({ params }: Params) {
  const { id, expenseId: rawExpenseId } = await params;
  const groupId = Number(id);
  const expenseId = Number(rawExpenseId);

  const group = Number.isInteger(groupId) ? getGroup(groupId) : undefined;
  if (!group) return { response: bad('Unknown group.', 404) };
  if (!Number.isInteger(expenseId) || !getExpense(groupId, expenseId)) {
    return { response: bad('Unknown expense.', 404) };
  }
  return { groupId, expenseId, group };
}

/**
 * Edit an expense: PUT /api/groups/:id/expenses/:expenseId with the same JSON
 * body as POST /api/groups/:id/expenses. Acts as the tally_actor_{groupId}
 * cookie says, like the page does.
 */
export async function PUT(request: Request, context: Params) {
  const t = await target(context);
  if ('response' in t) return t.response;
  // Refused for what the expense is, before anything about the body matters.
  if (expenseSource(t.expenseId) === 'plan') return bad(PLAN_LOCKED_MESSAGE, 409);

  const parsed = await expenseInputFromRequest(request, t.groupId, t.group);
  if ('error' in parsed) return bad(parsed.error);

  let result: UpdateResult;
  try {
    result = updateExpense(t.expenseId, {
      ...parsed.input,
      actorId: await currentActorId(t.groupId),
    });
  } catch (err) {
    if (err instanceof ExpenseLocked) return bad(err.message, 409);
    return bad(err instanceof Error ? err.message : 'Could not save the expense.');
  }

  revalidatePath(`/groups/${t.groupId}`);
  return NextResponse.json({
    ok: true,
    expense_id: t.expenseId,
    amount_cents: result.amountCents,
    // True when this edit turned a recurring posting into a one-off.
    detached: result.detached,
  });
}

/** Delete an expense, logged as the acting-as member like the Delete button. */
export async function DELETE(_request: Request, context: Params) {
  const t = await target(context);
  if ('response' in t) return t.response;

  deleteExpense(t.expenseId, await currentActorId(t.groupId));
  revalidatePath(`/groups/${t.groupId}`);
  return NextResponse.json({ ok: true });
}
