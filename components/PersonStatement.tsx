import { formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { categoryMeta, type SplitType } from '@/lib/types';

export type StatementRow = {
  id: number;
  description: string;
  spent_at: string;
  category: string;
  split_type: SplitType;
  expense_total: number;
  amount_cents: number;
  items_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  currency: string;
  group_name: string;
  group_id: number;
  paid_by_name: string;
  paid_it: number;
  items: { description: string; amount_cents: number }[];
};

/**
 * An itemised statement: every expense this person carries a share of, and for
 * receipts, the actual lines they ordered plus their slice of tax and tip.
 */
export default function PersonStatement({ rows }: { rows: StatementRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
        <span className="text-3xl" aria-hidden>
          🧾
        </span>
        <p className="font-semibold text-white">Nothing charged yet</p>
        <p className="text-sm text-slate-500">
          Expenses this person has a share of will be itemised here.
        </p>
      </div>
    );
  }

  const total = rows.reduce((sum, r) => sum + r.amount_cents, 0);
  const currencies = [...new Set(rows.map((r) => r.currency))];

  return (
    <section>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">Itemised receipt</h2>
          <p className="text-sm text-slate-500">
            {rows.length} charge{rows.length === 1 ? '' : 's'} across all groups
          </p>
        </div>
        {currencies.length === 1 && (
          <span className="text-right">
            <span className="block text-lg font-bold tabular-nums text-white">
              {formatCents(total, currencies[0])}
            </span>
            <span className="block text-[11px] text-slate-500">total share</span>
          </span>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r) => {
          const cat = categoryMeta(r.category);
          const isReceipt = r.split_type === 'items' && r.items.length > 0;
          const extras = (r.tax_cents ?? 0) + (r.tip_cents ?? 0);

          return (
            <details key={`${r.group_id}-${r.id}`} className="card card-hover group overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3.5 p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-lg">
                  {isReceipt ? '🧾' : cat.emoji}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-white">{r.description}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {r.group_name} · {formatDate(r.spent_at)} ·{' '}
                    {r.paid_it ? 'they paid' : `${r.paid_by_name} paid`}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums text-white">
                    {formatCents(r.amount_cents, r.currency)}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    of {formatCents(r.expense_total, r.currency)}
                  </span>
                </span>

                <span aria-hidden className="shrink-0 text-slate-600 transition group-open:rotate-180">
                  ▾
                </span>
              </summary>

              <div className="border-t border-white/[0.06] bg-ink-950/40 px-4 py-3 text-sm">
                {isReceipt ? (
                  <ul className="space-y-1.5">
                    {r.items.map((item, i) => (
                      <li key={i} className="flex items-center gap-2 text-slate-300">
                        <span className="min-w-0 flex-1 truncate">{item.description}</span>
                        <span className="tabular-nums text-slate-400">
                          {formatCents(item.amount_cents, r.currency)}
                        </span>
                      </li>
                    ))}

                    <li className="flex items-center gap-2 border-t border-white/[0.06] pt-1.5 text-slate-400">
                      <span className="min-w-0 flex-1">Their items</span>
                      <span className="tabular-nums">
                        {formatCents(r.items_cents ?? 0, r.currency)}
                      </span>
                    </li>
                    {extras > 0 && (
                      <li className="flex items-center gap-2 text-slate-400">
                        <span className="min-w-0 flex-1">
                          Tax &amp; tip
                          <span className="ml-1 text-[11px] text-slate-600">
                            (in proportion to their items)
                          </span>
                        </span>
                        <span className="tabular-nums">{formatCents(extras, r.currency)}</span>
                      </li>
                    )}
                    <li className="flex items-center gap-2 border-t border-white/[0.06] pt-1.5 font-semibold text-white">
                      <span className="min-w-0 flex-1">Their share</span>
                      <span className="tabular-nums">
                        {formatCents(r.amount_cents, r.currency)}
                      </span>
                    </li>
                  </ul>
                ) : (
                  <p className="text-slate-400">
                    Split {r.split_type === 'equal' ? 'equally' : `by ${r.split_type}`} —{' '}
                    {formatCents(r.amount_cents, r.currency)} of{' '}
                    {formatCents(r.expense_total, r.currency)}.
                  </p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
