'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { addMemberAction, removeMemberAction, type ActionResult } from '@/app/actions';
import type { Balance, Member } from '@/lib/types';
import Avatar from './Avatar';
import SubmitButton, { ErrorNote } from './SubmitButton';

export default function MembersPanel({
  groupId,
  members,
  balances,
}: {
  groupId: number;
  members: Member[];
  balances: Balance[];
}) {
  const [adding, setAdding] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [addState, addAction] = useActionState<ActionResult | null, FormData>(
    addMemberAction,
    null
  );
  const [removeState, removeAction] = useActionState<ActionResult | null, FormData>(
    removeMemberAction,
    null
  );

  useEffect(() => {
    if (addState?.ok) {
      formRef.current?.reset();
      setAdding(false);
    }
  }, [addState]);

  const settled = (id: number) => (balances.find((b) => b.member_id === id)?.net_cents ?? 0) === 0;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-white">
          People <span className="text-slate-500">({members.length})</span>
        </h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          {adding ? 'Cancel' : '＋ Add'}
        </button>
      </div>

      {adding && (
        <form ref={formRef} action={addAction} className="mb-4 space-y-2">
          <input type="hidden" name="groupId" value={groupId} />
          <input name="name" required autoFocus placeholder="Name" className="input" />
          <input name="email" type="email" placeholder="Email (optional)" className="input" />
          {addState && !addState.ok && <ErrorNote message={addState.error} />}
          <SubmitButton className="btn-primary w-full" pendingLabel="Adding…">
            Add person
          </SubmitButton>
        </form>
      )}

      <ul className="space-y-1">
        {members.map((m) => (
          <li
            key={m.id}
            className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.04]"
          >
            <Avatar name={m.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-200">{m.name}</span>
              {m.email && <span className="block truncate text-xs text-slate-500">{m.email}</span>}
            </span>
            {settled(m.id) && (
              <form action={removeAction}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="memberId" value={m.id} />
                <button
                  type="submit"
                  aria-label={`Remove ${m.name}`}
                  className="opacity-0 transition hover:text-rose-400 focus:opacity-100
                             group-hover:opacity-100 text-slate-500"
                >
                  ✕
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {removeState && !removeState.ok && (
        <div className="mt-3">
          <ErrorNote message={removeState.error} />
        </div>
      )}
    </div>
  );
}
