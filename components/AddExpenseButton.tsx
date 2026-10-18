'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { createExpenseAction, updateExpenseAction, type ActionResult } from '@/app/actions';
import {
  FULL_PERCENT_BP,
  formatBasisPoints,
  formatCents,
  hundredthsToInput,
  splitByWeights,
  splitEqually,
  toBasisPoints,
  toCents,
} from '@/lib/money';
import {
  CATEGORIES,
  type ExchangeRate,
  type ExpenseWithSplits,
  type Member,
  type SplitType,
} from '@/lib/types';
import AmountWithCurrency from './AmountWithCurrency';
import Avatar from './Avatar';
import Modal from './Modal';
import SubmitButton, { ErrorNote } from './SubmitButton';

const SPLIT_TABS: { id: SplitType; label: string; hint: string }[] = [
  { id: 'equal', label: 'Equally', hint: 'Everyone selected pays the same share.' },
  { id: 'exact', label: 'Amounts', hint: 'Type what each person owes. It has to add up to the total.' },
  { id: 'percent', label: '%', hint: 'Type each share as a percentage. It has to add up to 100%.' },
  { id: 'shares', label: 'Shares', hint: 'Weight it — e.g. 2 shares for the couple, 1 each for everyone else.' },
];

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The form's starting state: blank for a new expense, or an existing one's
 * values as they were typed, so an edit opens exactly where the last save left it.
 */
function initialState(members: Member[], currency: string, expense?: ExpenseWithSplits) {
  if (!expense) {
    return {
      amount: '',
      entryCurrency: currency,
      splitType: 'equal' as SplitType,
      selected: members.map((m) => m.id),
      values: {} as Record<number, string>,
      category: 'general',
    };
  }

  const ids = expense.splits.map((s) => s.member_id);
  // Exact amounts were typed in the entry currency but are stored converted, so
  // spread the typed total back over the stored shares. For a same-currency
  // expense this returns the stored amounts unchanged.
  const typed =
    expense.split_type === 'exact'
      ? splitByWeights(
          expense.original_amount_cents,
          expense.splits.map((s) => s.amount_cents)
        )
      : expense.splits.map((s) => s.weight ?? 0);

  return {
    amount: hundredthsToInput(expense.original_amount_cents),
    entryCurrency: expense.original_currency,
    splitType: expense.split_type,
    selected: ids,
    values:
      expense.split_type === 'equal'
        ? ({} as Record<number, string>)
        : Object.fromEntries(ids.map((id, i) => [id, hundredthsToInput(typed[i])])),
    category: expense.category,
  };
}

/**
 * Adds an expense, or with `expense` given edits that one in place: the same
 * form, prefilled, saving through the same validation.
 */
export default function AddExpenseButton({
  groupId,
  members,
  currency,
  rates,
  expense,
}: {
  groupId: number;
  members: Member[];
  /** The group's currency — what balances are kept in. */
  currency: string;
  rates: ExchangeRate[];
  /** The expense to edit. Omitted for a new one. */
  expense?: ExpenseWithSplits;
}) {
  const editing = expense !== undefined;
  const [initial] = useState(() => initialState(members, currency, expense));
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(initial.amount);
  // The modal works entirely in the currency being typed; the conversion to the
  // group's currency is shown once, under the amount field.
  const [entryCurrency, setEntryCurrency] = useState(initial.entryCurrency);
  const [splitType, setSplitType] = useState<SplitType>(initial.splitType);
  const [selected, setSelected] = useState<number[]>(initial.selected);
  const [values, setValues] = useState<Record<number, string>>(initial.values);
  const [category, setCategory] = useState(initial.category);
  // Until someone edits a field by hand, the inputs track an even split so the
  // form is never sitting in a state the server would reject. An edit starts
  // from what was saved, so it counts as already touched.
  const [touched, setTouched] = useState(editing);

  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    editing ? updateExpenseAction : createExpenseAction,
    null
  );

  const totalCents = toCents(amount) || 0;

  /** An even distribution in the active mode's unit, exact by construction. */
  const evenValues = useMemo(() => {
    const n = selected.length;
    if (n === 0) return {} as Record<number, string>;

    if (splitType === 'shares') {
      return Object.fromEntries(selected.map((id) => [id, '1']));
    }
    const parts =
      splitType === 'percent'
        ? splitEqually(FULL_PERCENT_BP, n)
        : splitEqually(Math.max(0, totalCents), n);

    return Object.fromEntries(selected.map((id, i) => [id, hundredthsToInput(parts[i])]));
  }, [selected, splitType, totalCents]);

  useEffect(() => {
    if (!touched && splitType !== 'equal') setValues(evenValues);
  }, [evenValues, touched, splitType]);

  const reset = () => {
    const next = initialState(members, currency, expense);
    setAmount(next.amount);
    setValues(next.values);
    setSplitType(next.splitType);
    setCategory(next.category);
    setEntryCurrency(next.entryCurrency);
    setTouched(editing);
    setSelected(next.selected);
  };

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** Each row's input parsed into this mode's integer unit. */
  const units = useMemo(() => {
    const parse = splitType === 'exact' ? toCents : toBasisPoints;
    return selected.map((id) => parse(values[id] ?? ''));
  }, [selected, values, splitType]);

  const unitSum = units.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const hasBadInput = units.some((u) => !Number.isFinite(u) || u < 0);

  /** Mirrors lib/queries.ts computeSplits — the server still has final say. */
  const preview = useMemo(() => {
    if (selected.length === 0 || totalCents <= 0) return {} as Record<number, number>;

    if (splitType === 'exact') {
      return Object.fromEntries(
        selected.map((id, i) => [id, Number.isFinite(units[i]) ? units[i] : 0])
      );
    }
    if (splitType === 'equal') {
      const parts = splitEqually(totalCents, selected.length);
      return Object.fromEntries(selected.map((id, i) => [id, parts[i]]));
    }
    const weights = units.map((u) => (Number.isFinite(u) && u > 0 ? u : 0));
    if (weights.reduce((a, b) => a + b, 0) === 0) {
      return Object.fromEntries(selected.map((id) => [id, 0]));
    }
    const parts = splitByWeights(totalCents, weights);
    return Object.fromEntries(selected.map((id, i) => [id, parts[i]]));
  }, [selected, totalCents, splitType, units]);

  const assigned = selected.reduce((sum, id) => sum + (preview[id] ?? 0), 0);

  /** The one place that decides whether this split is allowed to be submitted. */
  const problem = useMemo((): string | null => {
    if (selected.length === 0) return 'Select at least one person to split between.';
    if (totalCents <= 0) return null; // the amount field shows its own prompt
    if (splitType === 'equal') return null;
    if (hasBadInput) return 'Every person in the split needs a number that isn’t negative.';

    if (splitType === 'exact') {
      if (unitSum === totalCents) return null;
      const diff = Math.abs(unitSum - totalCents);
      return unitSum < totalCents
        ? `${formatCents(diff, entryCurrency)} still to assign`
        : `${formatCents(diff, entryCurrency)} over the total`;
    }
    if (splitType === 'percent') {
      if (unitSum === FULL_PERCENT_BP) return null;
      const diff = Math.abs(unitSum - FULL_PERCENT_BP);
      return unitSum < FULL_PERCENT_BP
        ? `${formatBasisPoints(diff)} short of 100%`
        : `${formatBasisPoints(diff)} over 100%`;
    }
    if (unitSum === 0) return 'Give at least one person a share above zero.';
    return null;
  }, [selected, totalCents, splitType, unitSum, hasBadInput, entryCurrency]);

  const canSubmit = problem === null && totalCents > 0 && selected.length > 0;

  const setValue = (id: number, raw: string) => {
    setTouched(true);
    setValues((v) => ({ ...v, [id]: raw }));
  };

  const switchMode = (next: SplitType) => {
    setSplitType(next);
    setTouched(false); // re-prefill in the new mode's unit
  };

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allSelected = selected.length === members.length;

  return (
    <>
      {editing ? (
        <button
          type="button"
          onClick={() => {
            // Always open on the expense as currently saved.
            reset();
            setOpen(true);
          }}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          Edit expense
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-primary">
          <span aria-hidden>＋</span> Add expense
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit expense' : 'Add an expense'}
        subtitle="Who paid, how much, and how should it be split?"
      >
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="groupId" value={groupId} />
          {editing && <input type="hidden" name="expenseId" value={expense.id} />}
          <input type="hidden" name="splitType" value={splitType} />
          <input type="hidden" name="category" value={category} />

          <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
            <div>
              <label className="label" htmlFor="exp-desc">
                Description
              </label>
              <input
                id="exp-desc"
                name="description"
                required
                autoFocus
                defaultValue={expense?.description}
                placeholder="Dinner at Ichiran"
                className="input"
              />
            </div>
            <AmountWithCurrency
              id="exp-amount"
              amount={amount}
              onAmountChange={setAmount}
              currency={entryCurrency}
              onCurrencyChange={setEntryCurrency}
              groupCurrency={currency}
              rates={rates}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="exp-paidby">
                Paid by
              </label>
              <select
                id="exp-paidby"
                name="paidBy"
                className="input"
                defaultValue={expense?.paid_by ?? members[0]?.id}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="exp-date">
                Date
              </label>
              <input
                id="exp-date"
                name="spentAt"
                type="date"
                defaultValue={expense ? expense.spent_at.slice(0, 10) : todayLocal()}
                className="input"
              />
            </div>
          </div>

          <div>
            <span className="label">Category</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  aria-pressed={category === c.id}
                  className={`chip transition ${
                    category === c.id
                      ? 'border-brand-500/60 bg-brand-500/15 text-brand-300'
                      : 'hover:bg-white/[0.08]'
                  }`}
                >
                  <span aria-hidden>{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-end justify-between">
              <span className="label mb-0">Split</span>
              <div className="flex gap-3">
                {splitType !== 'equal' && (
                  <button
                    type="button"
                    onClick={() => {
                      setValues(evenValues);
                      setTouched(false);
                    }}
                    className="text-xs font-medium text-brand-400 hover:text-brand-300"
                  >
                    Even out
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelected(allSelected ? [] : members.map((m) => m.id))}
                  className="text-xs font-medium text-brand-400 hover:text-brand-300"
                >
                  {allSelected ? 'Clear all' : 'Select everyone'}
                </button>
              </div>
            </div>

            <div
              role="tablist"
              className="mb-3 flex gap-1 rounded-xl border border-white/[0.08] bg-ink-950/50 p-1"
            >
              {SPLIT_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={splitType === t.id}
                  onClick={() => switchMode(t.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    splitType === t.id
                      ? 'bg-white/[0.09] text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {SPLIT_TABS.find((t) => t.id === splitType)!.hint}
            </p>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/[0.06] p-1.5">
              {members.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <div
                    key={m.id}
                    className={`flex items-center gap-3 rounded-lg px-2.5 py-2 transition ${
                      on ? 'bg-white/[0.05]' : 'opacity-50'
                    }`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(m.id)}
                        className="h-4 w-4 shrink-0 accent-brand-500"
                      />
                      {on && <input type="hidden" name="participants" value={m.id} />}
                      <Avatar name={m.name} size="sm" />
                      <span className="truncate text-sm text-slate-200">{m.name}</span>
                    </label>

                    {on && splitType !== 'equal' && (
                      <span className="relative shrink-0">
                        <input
                          name={`value_${m.id}`}
                          inputMode="decimal"
                          value={values[m.id] ?? ''}
                          onChange={(e) => setValue(m.id, e.target.value)}
                          aria-label={`${
                            splitType === 'percent'
                              ? 'Percentage'
                              : splitType === 'shares'
                                ? 'Shares'
                                : 'Amount'
                          } for ${m.name}`}
                          className={`input w-24 py-1.5 text-right text-sm tabular-nums ${
                            splitType === 'percent' ? 'pr-6' : ''
                          }`}
                        />
                        {splitType === 'percent' && (
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                            %
                          </span>
                        )}
                      </span>
                    )}

                    <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-300">
                      {on && totalCents > 0 ? formatCents(preview[m.id] ?? 0, entryCurrency) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>

            {totalCents > 0 && selected.length > 0 && (
              <div
                className={`mt-2 flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm ${
                  problem ? 'bg-amber-500/10 text-amber-300' : 'bg-white/[0.04] text-slate-400'
                }`}
              >
                <span>
                  {problem ?? `Split ${selected.length} way${selected.length === 1 ? '' : 's'}`}
                </span>
                <span className="font-semibold tabular-nums text-white">
                  {splitType === 'percent' && !Number.isNaN(unitSum)
                    ? `${formatBasisPoints(unitSum)} / 100%`
                    : `${formatCents(assigned, entryCurrency)} / ${formatCents(totalCents, entryCurrency)}`}
                </span>
              </div>
            )}
          </div>

          {expense?.source === 'recurring' && (
            <p className="rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300">
              This expense was posted by a recurring schedule. Saving changes detaches it from the
              schedule.
            </p>
          )}

          {state && !state.ok && <ErrorNote message={state.error} />}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">
              Cancel
            </button>
            <SubmitButton
              className="btn-primary flex-1"
              pendingLabel={editing ? 'Saving…' : 'Adding…'}
              disabled={!canSubmit}
            >
              {editing ? 'Save changes' : 'Add expense'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
