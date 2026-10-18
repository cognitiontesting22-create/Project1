import { SYSTEM_ACTOR_NAME, formatActivityTime } from '@/lib/activity';
import type { ActivityEntry } from '@/lib/activity-queries';
import { formatCents } from '@/lib/money';
import type { Member } from '@/lib/types';
import ActivityFilters from './ActivityFilters';
import Avatar from './Avatar';
import UndoButton from './UndoButton';

export default function ActivityList({
  groupId,
  entries,
  members,
  currency,
  undoable,
}: {
  groupId: number;
  entries: ActivityEntry[];
  members: Member[];
  currency: string;
  /** Ids of the entries an undo would act on right now. */
  undoable: number[];
}) {
  return (
    <div>
      <ActivityFilters members={members} />

      {entries.length === 0 ? (
        <div className="card grid place-items-center px-6 py-14 text-center">
          <p className="font-semibold text-white">No activity yet</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((a) => {
            const name = a.actor_name ?? SYSTEM_ACTOR_NAME;
            return (
              <li key={a.id} className="card flex items-start gap-3 p-4">
                <Avatar name={name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-slate-500">
                    <span className="font-semibold text-slate-200">{name}</span>
                    <time dateTime={a.occurred_at}>{formatActivityTime(a.occurred_at)}</time>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-300">{a.summary}</p>
                  {(a.kind === 'expense_edited' || a.kind === 'expense_reverted') &&
                    a.amount_before !== null &&
                    a.amount_after !== null && (
                      <p className="mt-1 text-xs tabular-nums text-slate-400">
                        {formatCents(a.amount_before, currency)} →{' '}
                        {formatCents(a.amount_after, currency)}
                      </p>
                    )}
                  {a.undone_by_id !== null ? (
                    <p className="mt-1 text-xs text-slate-500">Undone by entry #{a.undone_by_id}</p>
                  ) : (
                    undoable.includes(a.id) && <UndoButton groupId={groupId} entryId={a.id} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
