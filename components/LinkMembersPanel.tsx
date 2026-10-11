'use client';

import { useActionState } from 'react';
import { linkMemberAction, type ActionResult } from '@/app/actions';
import type { PersonDirectoryEntry } from '@/lib/types';
import SubmitButton, { ErrorNote } from './SubmitButton';

/**
 * Members that aren't attached to a person yet. Until they are, their money
 * doesn't show up in anyone's cross-group total — so this panel is the one
 * place that gap is visible.
 */
export default function LinkMembersPanel({
  members,
  people,
}: {
  members: { id: number; name: string; group_name: string; emoji: string }[];
  people: PersonDirectoryEntry[];
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(linkMemberAction, null);

  return (
    <section className="card p-5">
      <h2 className="font-semibold text-white">Unlinked members</h2>
      <p className="mt-1 text-xs text-slate-500">
        These group members aren&apos;t attached to a person yet, so they&apos;re missing from
        cross-group totals.
      </p>

      <ul className="mt-4 space-y-2">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-200">{m.name}</span>
              <span className="block text-[11px] text-slate-500">
                {m.emoji} {m.group_name}
              </span>
            </span>
            <form action={action} className="flex items-center gap-2">
              <input type="hidden" name="memberId" value={m.id} />
              <select name="personId" className="input w-44 py-1.5 text-xs" defaultValue="">
                <option value="">Choose a person…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn-ghost px-3 py-1.5 text-xs" pendingLabel="Linking…">
                Link
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>

      {state && !state.ok && (
        <div className="mt-3">
          <ErrorNote message={state.error} />
        </div>
      )}
    </section>
  );
}
