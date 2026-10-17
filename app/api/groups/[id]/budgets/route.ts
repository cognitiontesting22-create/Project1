import { NextResponse } from 'next/server';
import { getBudgetReport } from '@/lib/budget-queries';
import { currentMonth, isMonth } from '@/lib/budgets';
import { getGroup } from '@/lib/queries';
import { postDueItems } from '@/lib/scheduling-queries';

export const dynamic = 'force-dynamic';

/**
 * Budget status for one month: GET /api/groups/:id/budgets?month=YYYY-MM.
 * Amounts are integer minor units of the group's currency; percentages are
 * basis points (10000 = 100%).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) {
    return NextResponse.json({ error: 'Unknown group.' }, { status: 404 });
  }

  const group = getGroup(groupId);
  if (!group) return NextResponse.json({ error: 'Unknown group.' }, { status: 404 });

  const requested = new URL(request.url).searchParams.get('month');
  if (requested !== null && !isMonth(requested)) {
    return NextResponse.json(
      { error: `month must be formatted YYYY-MM (got "${requested}").` },
      { status: 400 }
    );
  }
  const month = requested ?? currentMonth();

  // A side effect on a GET, on purpose: the group page posts recurring
  // expenses that came due before reading, and this must report the same
  // numbers even if nobody has opened the page this month.
  postDueItems(groupId);

  const report = getBudgetReport(groupId, month);

  return NextResponse.json(
    {
      group_id: groupId,
      currency: group.currency,
      month,
      categories: report.lines,
      unbudgeted: report.unbudgeted,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
