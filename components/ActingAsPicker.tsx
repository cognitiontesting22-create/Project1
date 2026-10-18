'use client';

import { setActorAction } from '@/app/actions';
import type { Member } from '@/lib/types';

/**
 * Tally has no logins, so the activity log credits whoever is picked here.
 * Saved per group in a cookie by setActorAction.
 */
export default function ActingAsPicker({
  groupId,
  members,
  actorId,
}: {
  groupId: number;
  members: Member[];
  actorId: number;
}) {
  return (
    <form action={setActorAction} className="flex items-center gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <label htmlFor="acting-as" className="whitespace-nowrap text-xs font-medium text-slate-400">
        Acting as
      </label>
      <select
        id="acting-as"
        name="memberId"
        // Re-key on the saved choice so the select follows the server after a save.
        key={actorId}
        defaultValue={actorId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input w-auto py-2 text-sm"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </form>
  );
}
