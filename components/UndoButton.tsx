'use client';

import { useActionState } from 'react';
import { undoActivityAction, type ActionResult } from '@/app/actions';
import SubmitButton, { ErrorNote } from './SubmitButton';

/** Undo one log entry. The server decides; a refusal comes back as text here. */
export default function UndoButton({ groupId, entryId }: { groupId: number; entryId: number }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(undoActivityAction, null);

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="entryId" value={entryId} />
      <SubmitButton className="btn-ghost px-3 py-1.5 text-xs" pendingLabel="Undoing…">
        Undo
      </SubmitButton>
      {state && !state.ok && <ErrorNote message={state.error} />}
    </form>
  );
}
