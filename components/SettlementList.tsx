import { deleteSettlementAction } from '@/app/actions';
import { formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import type { SettlementWithNames } from '@/lib/types';
import Avatar from './Avatar';

export default function SettlementList({
  settlements,
  currency,
  groupId,
}: {
  settlements: SettlementWithNames[];
  currency: string;
  groupId: number;
}) {
  if (settlements.length === 0) {
    return (
      <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
        <span className="text-3xl" aria-hidden>
          🤝
        </span>
        <div>
          <p className="font-semibold text-white">No payments recorded</p>
          <p className="mt-1 text-sm text-slate-500">
            When someone pays another person back, log it here to clear their balance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {settlements.map((s) => (
        <div key={s.id} className="card card-hover group flex items-center gap-3 p-4">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl
                       bg-brand-500/10 text-lg"
            aria-hidden
          >
            🤝
          </span>

          <span className="flex shrink-0 items-center gap-1.5">
            <Avatar name={s.from_name} size="sm" />
            <span className="text-slate-600" aria-hidden>
              →
            </span>
            <Avatar name={s.to_name} size="sm" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-slate-200">
              <span className="font-semibold text-white">{s.from_name}</span> paid{' '}
              <span className="font-semibold text-white">{s.to_name}</span>
            </span>
            <span className="block truncate text-xs text-slate-500">
              {formatDate(s.settled_at)}
              {s.note && ` · ${s.note}`}
              {s.original_currency !== currency &&
                ` · ${formatCents(s.original_amount_cents, s.original_currency)}`}
            </span>
          </span>

          <span className="shrink-0 font-bold tabular-nums text-brand-400">
            {formatCents(s.amount_cents, currency)}
          </span>

          <form action={deleteSettlementAction}>
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="settlementId" value={s.id} />
            <button
              type="submit"
              aria-label="Delete payment"
              className="shrink-0 text-slate-600 opacity-0 transition hover:text-rose-400
                         focus:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
