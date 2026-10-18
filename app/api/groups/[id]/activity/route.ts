import { NextResponse } from 'next/server';
import { activityJson, parseActivityParams } from '@/lib/activity';
import { listActivity } from '@/lib/activity-queries';
import { getGroup } from '@/lib/queries';
import { postDueItems } from '@/lib/scheduling-queries';
import { undoableNow } from '@/lib/undo';

export const dynamic = 'force-dynamic';

/**
 * The activity log as JSON: GET /api/groups/:id/activity, newest first, with
 * optional kind, since and actor filters that combine with "and". Amounts are
 * integer minor units of the group's currency. The stored snapshots stay out.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const groupId = Number(id);
  const group = Number.isInteger(groupId) ? getGroup(groupId) : undefined;
  if (!group) return NextResponse.json({ error: 'Unknown group.' }, { status: 404 });

  const parsed = parseActivityParams(new URL(request.url).searchParams);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Like the page and the budgets route: anything that came due is posted, and
  // logged, before the log is read back.
  postDueItems(groupId);

  const undoable = new Set(undoableNow(groupId));
  const entries = listActivity(groupId, parsed.filters).map((a) =>
    activityJson(a, undoable.has(a.id))
  );

  return NextResponse.json(
    { group_id: groupId, currency: group.currency, entries },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
