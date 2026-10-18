import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { currentActorId } from '@/lib/actor';
import { getGroup } from '@/lib/queries';
import { UndoRefused, undoActivity } from '@/lib/undo';

export const dynamic = 'force-dynamic';

/**
 * Undo an activity entry: POST /api/groups/:id/activity/:entryId/undo. Same
 * function as the Undo button. A refusal answers with its own status: 409 when
 * the log has moved on, 400 for an entry of the wrong kind, 404 for one that
 * isn't in this group.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id, entryId: rawEntryId } = await params;
  const groupId = Number(id);
  const entryId = Number(rawEntryId);
  if (!Number.isInteger(groupId) || !getGroup(groupId)) {
    return NextResponse.json({ error: 'Unknown group.' }, { status: 404 });
  }
  if (!Number.isInteger(entryId)) {
    return NextResponse.json({ error: 'Unknown activity entry.' }, { status: 404 });
  }

  let undoId: number;
  try {
    undoId = undoActivity(groupId, entryId, await currentActorId(groupId));
  } catch (err) {
    if (err instanceof UndoRefused) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  revalidatePath(`/groups/${groupId}`);
  return NextResponse.json({ ok: true, entry_id: undoId });
}
