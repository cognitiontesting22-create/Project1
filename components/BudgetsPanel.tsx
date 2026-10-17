'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { clearBudgetAction, setBudgetAction, type ActionResult } from '@/app/actions';
import {
  formatMonth,
  shiftMonth,
  type BudgetLine,
  type BudgetReport,
  type BudgetStatus,
} from '@/lib/budgets';
import { formatBasisPoints, formatCents, hundredthsToInput } from '@/lib/money';
import { CATEGORIES } from '@/lib/types';
import Modal from './Modal';
import SubmitButton, { ErrorNote } from './SubmitButton';

const BAR: Record<BudgetStatus, string> = {
  under: 'bg-brand-500',
  near: 'bg-amber-400',
  over: 'bg-rose-500',
};

const TEXT: Record<BudgetStatus, string> = {
  under: 'text-slate-400',
  near: 'text-amber-400',
  over: 'text-rose-400',
};

/**
 * The month lives in the URL (?month=YYYY-MM) alongside the ledger filters, so
 * a budget view is shareable and the page can render it on the server.
 */
export default function BudgetsPanel({
  groupId,
  currency,
  report,
  thisMonth,
  editable,
  note,
}: {
  groupId: number;
  currency: string;
  report: BudgetReport;
  /** The server's current month, so the picker and the page agree on "now". */
  thisMonth: string;
  /** False for past months, which keep the budget they were measured against. */
  editable: boolean;
  /** Shown when the page is filtered, so these totals can't be misread. */
  note?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState<{ category: string; amount: string } | null>(null);

  const goTo = (month: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (month === thisMonth) params.delete('month');
    else params.set('month', month);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const unbudgetedCategory =
    CATEGORIES.find((c) => !report.lines.some((l) => l.category === c.id))?.id ?? 'general';

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-white">Budgets</h3>
        {editable && (
          <button
            type="button"
            onClick={() => setEditing({ category: unbudgetedCategory, amount: '' })}
            className="text-xs font-medium text-brand-400 hover:text-brand-300"
          >
            ＋ Set
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-2 text-xs text-slate-500">
        <button
          type="button"
          onClick={() => goTo(shiftMonth(report.month, -1))}
          aria-label="Previous month"
          className="rounded-md px-2 py-1 hover:bg-white/[0.06] hover:text-white"
        >
          ‹
        </button>
        <span className="font-medium text-slate-300">
          {formatMonth(report.month)}
          {report.month !== thisMonth && (
            <button
              type="button"
              onClick={() => goTo(thisMonth)}
              className="ml-2 font-normal text-brand-400 hover:text-brand-300"
            >
              this month
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={() => goTo(shiftMonth(report.month, 1))}
          aria-label="Next month"
          className="rounded-md px-2 py-1 hover:bg-white/[0.06] hover:text-white"
        >
          ›
        </button>
      </div>

      {note && (
        <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-300/90">
          {note}
        </p>
      )}

      {report.lines.length === 0 ? (
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center text-xs text-slate-500">
          {editable
            ? 'No budgets yet. Set a monthly limit for food, rent, fun…'
            : 'No budgets were set for this month.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {report.lines.map((line) => (
            <BudgetRow
              key={line.category}
              line={line}
              currency={currency}
              onEdit={
                editable
                  ? () =>
                      setEditing({
                        category: line.category,
                        amount: hundredthsToInput(line.budget_cents),
                      })
                  : undefined
              }
            />
          ))}
        </ul>
      )}

      {report.unbudgeted.length > 0 && (
        <div className="mt-4 border-t border-white/[0.05] pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">No budget</p>
          <ul className="space-y-1.5">
            {report.unbudgeted.map((u) => (
              <li key={u.category} className="flex items-center gap-2 text-sm">
                <span aria-hidden>{u.emoji}</span>
                <span className="flex-1 truncate text-slate-400">{u.label}</span>
                <span className="tabular-nums text-slate-400">
                  {formatCents(u.spent_cents, currency)}
                </span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => setEditing({ category: u.category, amount: '' })}
                    className="text-[11px] font-medium text-brand-400 hover:text-brand-300"
                  >
                    Set
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        Counts expenses dated in the month, including recurring ones once they post. Payments and
        plan interest don&apos;t count.
      </p>

      {editing && (
        <BudgetModal
          key={editing.category}
          groupId={groupId}
          currency={currency}
          month={report.month}
          initial={editing}
          existing={report.lines.some((l) => l.category === editing.category)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BudgetRow({
  line,
  currency,
  onEdit,
}: {
  line: BudgetLine;
  currency: string;
  onEdit?: () => void;
}) {
  const width = line.percent_bp === null ? (line.spent_cents > 0 ? 100 : 0) : Math.min(100, line.percent_bp / 100);
  const remaining = line.remaining_cents;

  return (
    <li>
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden>{line.emoji}</span>
        <span className="flex-1 truncate text-slate-300">{line.label}</span>
        <span className="tabular-nums text-slate-300">
          {formatCents(line.spent_cents, currency)}
          <span className="text-slate-500"> / {formatCents(line.budget_cents, currency)}</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]"
        role="progressbar"
        aria-label={`${line.label} budget used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
      >
        <div className={`h-full rounded-full ${BAR[line.status]}`} style={{ width: `${width}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className={TEXT[line.status]}>
          {remaining >= 0
            ? `${formatCents(remaining, currency)} left`
            : `${formatCents(-remaining, currency)} over`}
          {line.percent_bp !== null && ` · ${formatBasisPoints(line.percent_bp)}`}
        </span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="font-medium text-slate-500 hover:text-white"
          >
            Edit
          </button>
        )}
      </div>
    </li>
  );
}

function BudgetModal({
  groupId,
  currency,
  month,
  initial,
  existing,
  onClose,
}: {
  groupId: number;
  currency: string;
  month: string;
  initial: { category: string; amount: string };
  existing: boolean;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(initial.category);
  const [saveState, saveAction] = useActionState<ActionResult | null, FormData>(
    setBudgetAction,
    null
  );
  const [clearState, clearAction] = useActionState<ActionResult | null, FormData>(
    clearBudgetAction,
    null
  );

  useEffect(() => {
    if (saveState?.ok || clearState?.ok) onClose();
  }, [saveState, clearState, onClose]);

  const error =
    (saveState && !saveState.ok && saveState.error) ||
    (clearState && !clearState.ok && clearState.error) ||
    undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit budget' : 'Set a budget'}
      subtitle={`Applies from ${formatMonth(month)} onward. Earlier months keep their budget.`}
    >
      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="month" value={month} />

        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <div>
            <label className="label" htmlFor="budget-category">
              Category
            </label>
            <select
              id="budget-category"
              name="category"
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="budget-amount">
              Per month ({currency})
            </label>
            <input
              id="budget-amount"
              name="amount"
              required
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={initial.amount}
              className="input text-right font-semibold tabular-nums"
            />
          </div>
        </div>

        <ErrorNote message={error} />
        <SubmitButton>Save budget</SubmitButton>
      </form>

      {existing && category === initial.category && (
        <form action={clearAction} className="mt-3">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="category" value={category} />
          <SubmitButton className="btn-ghost w-full text-xs" pendingLabel="Removing…">
            Remove from {formatMonth(month)} onward
          </SubmitButton>
        </form>
      )}
    </Modal>
  );
}
