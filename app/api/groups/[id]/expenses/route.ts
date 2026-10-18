import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { currentActorId } from '@/lib/actor';
import { expenseInputFromRequest } from '@/lib/expense-input';
import { createExpense, getExpense, getGroup } from '@/lib/queries';

export const dynamic = 'force-dynamic';

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Add an expense: POST /api/groups/:id/expenses with description, amount,
 * paid_by, spent_at, category, currency, split_type, participants and values.
 * Validation is the form's, messages included. Acts as the tally_actor_{groupId}
 * cookie says, like the page does.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const groupId = Number(id);
  const group = Number.isInteger(groupId) ? getGroup(groupId) : undefined;
  if (!group) return bad('Unknown group.', 404);

  const parsed = await expenseInputFromRequest(request, groupId, group);
  if ('error' in parsed) return bad(parsed.error);

  let expenseId: number;
  try {
    expenseId = createExpense({ ...parsed.input, actorId: await currentActorId(groupId) });
  } catch (err) {
    return bad(err instanceof Error ? err.message : 'Could not save the expense.');
  }

  revalidatePath(`/groups/${groupId}`);
  return NextResponse.json(
    { ok: true, expense_id: expenseId, amount_cents: getExpense(groupId, expenseId)!.amount_cents },
    { status: 201 }
  );
}
