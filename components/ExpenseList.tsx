import { deleteExpenseAction } from '@/app/actions';
import { dateBucket, formatDate } from '@/lib/dates';
import { RATE_SCALE } from '@/lib/currency';
import { formatBasisPoints, formatCents, formatShares } from '@/lib/money';
import { categoryMeta, SPLIT_LABELS, type ExpenseWithSplits } from '@/lib/types';
import Avatar from './Avatar';

export default function ExpenseList({
  expenses,
  currency,
  groupId,
}: {
  expenses: ExpenseWithSplits[];
  currency: string;
  groupId: number;
}) {
  if (expenses.length === 0) {
    return (
      <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
        <span className="text-3xl" aria-hidden>
          🧾
        </span>
        <div>
          <p className="font-semibold text-white">No expenses yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Add the first one and Tally will keep the balances straight.
          </p>
        </div>
      </div>
    );
  }

  // Already sorted newest-first by the query; just insert bucket headings.
  let lastBucket = '';

  return (
    <div className="space-y-2">
      {expenses.map((e) => {
        const bucket = dateBucket(e.spent_at);
        const showHeading = bucket !== lastBucket;
        lastBucket = bucket;
        const cat = categoryMeta(e.category);

        return (
          <div key={e.id}>
            {showHeading && (
              <p className="px-1 pb-1.5 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {bucket}
              </p>
            )}

            <details className="card card-hover group overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3.5 p-4">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl
                             bg-white/[0.05] text-lg"
                  title={cat.label}
                >
                  {cat.emoji}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-white">{e.description}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {e.paid_by_name} paid · {formatDate(e.spent_at)} · split{' '}
                    {SPLIT_LABELS[e.split_type] ?? 'equally'}
                  </span>
                  {e.original_currency !== currency && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <span aria-hidden>🌐</span>
                      paid {formatCents(e.original_amount_cents, e.original_currency)} at{' '}
                      {Number((e.rate_e8 / RATE_SCALE).toFixed(6))} {currency}/
                      {e.original_currency}
                    </span>
                  )}
                </span>

                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums text-white">
                    {formatCents(e.amount_cents, currency)}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {e.splits.length} {e.splits.length === 1 ? 'person' : 'people'}
                  </span>
                </span>

                <span
                  aria-hidden
                  className="shrink-0 text-slate-600 transition group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>

              <div className="border-t border-white/[0.06] bg-ink-950/40 px-4 py-3">
                <ul className="space-y-1.5">
                  {e.splits.map((s) => (
                    <li key={s.member_id} className="flex items-center gap-2.5 text-sm">
                      <Avatar name={s.name} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-slate-300">{s.name}</span>
                      {/* Show what was typed, not just what it resolved to. */}
                      {s.weight !== null && (
                        <span className="chip px-2 py-0.5 text-[10px] tabular-nums">
                          {e.split_type === 'percent'
                            ? formatBasisPoints(s.weight)
                            : formatShares(s.weight)}
                        </span>
                      )}
                      <span className="w-20 text-right tabular-nums text-slate-400">
                        {formatCents(s.amount_cents, currency)}
                      </span>
                    </li>
                  ))}
                </ul>

                <form action={deleteExpenseAction} className="mt-3 flex justify-end">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="expenseId" value={e.id} />
                  <button type="submit" className="btn-danger px-3 py-1.5 text-xs">
                    Delete expense
                  </button>
                </form>
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}
