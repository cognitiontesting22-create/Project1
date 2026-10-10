'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  createRecurringAction,
  deleteRecurringAction,
  toggleRecurringAction,
  type ActionResult,
} from '@/app/actions';
import { formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { occurrenceDate, today } from '@/lib/schedule';
import { CATEGORIES, type ExchangeRate, type Member, type RecurringExpense } from '@/lib/types';
import Avatar from './Avatar';
import Modal from './Modal';
import SubmitButton, { ErrorNote } from './SubmitButton';

const INTERVALS = [
  { months: 1, label: 'Monthly' },
  { months: 2, label: 'Every 2 months' },
  { months: 3, label: 'Quarterly' },
  { months: 6, label: 'Every 6 months' },
  { months: 12, label: 'Yearly' },
];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export default function RecurringPanel({
  groupId,
  members,
  currency,
  rates,
  recurring,
}: {
  groupId: number;
  members: Member[];
  currency: string;
  rates: ExchangeRate[];
  recurring: RecurringExpense[];
}) {
  const [open, setOpen] = useState(false);
  const [anchorDay, setAnchorDay] = useState(1);
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    createRecurringAction,
    null
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  // Show the user exactly where this anchor lands over the next few months —
  // the month-end clamping is the surprising part, so make it visible up front.
  const now = today();
  const [y, m] = now.split('-').map(Number);
  const landings = Array.from({ length: 4 }, (_, i) => {
    const monthsOut = m - 1 + i;
    return occurrenceDate(y + Math.floor(monthsOut / 12), (monthsOut % 12) + 1, anchorDay);
  });

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-white">Recurring</h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          ＋ Add
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Posts itself on schedule — short months fall back to their last day.
      </p>

      {recurring.length === 0 ? (
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center text-xs text-slate-500">
          Nothing recurring yet. Rent, internet, a streaming plan…
        </p>
      ) : (
        <ul className="space-y-2">
          {recurring.map((r) => (
            <li
              key={r.id}
              className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 ${
                r.active ? '' : 'opacity-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {r.description}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {INTERVALS.find((i) => i.months === r.interval_months)?.label ?? 'Monthly'} on
                    the {ordinal(r.anchor_day)} · {r.paid_by_name} pays
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-white">
                    {formatCents(r.amount_cents, r.currency)}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {r.posted_count} posted
                  </span>
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.05] pt-2">
                <span className="text-[11px] text-slate-500">
                  {r.active && r.next_due ? (
                    <>
                      next <span className="text-brand-400">{formatDate(r.next_due)}</span>
                    </>
                  ) : (
                    'paused'
                  )}
                </span>
                <span className="flex gap-2">
                  <form action={toggleRecurringAction}>
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="recurringId" value={r.id} />
                    <input type="hidden" name="active" value={r.active ? '0' : '1'} />
                    <button
                      type="submit"
                      className="text-[11px] font-medium text-slate-400 hover:text-white"
                    >
                      {r.active ? 'Pause' : 'Resume'}
                    </button>
                  </form>
                  <form action={deleteRecurringAction}>
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="recurringId" value={r.id} />
                    <button
                      type="submit"
                      className="text-[11px] font-medium text-slate-500 hover:text-rose-400"
                    >
                      Remove
                    </button>
                  </form>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a recurring expense"
        subtitle="Rent, bills, subscriptions — anything that lands on the same day each month."
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="splitType" value="equal" />
          <input type="hidden" name="startDate" value={today()} />

          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <div>
              <label className="label" htmlFor="rec-desc">
                Description
              </label>
              <input
                id="rec-desc"
                name="description"
                required
                autoFocus
                placeholder="Rent"
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="rec-amount">
                Amount
              </label>
              <div className="flex gap-2">
                <input
                  id="rec-amount"
                  name="amount"
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  className="input flex-1 text-right font-semibold tabular-nums"
                />
                <select
                  name="currency"
                  defaultValue={currency}
                  aria-label="Currency"
                  className="input w-20 shrink-0 px-2 text-sm font-semibold"
                >
                  {rates.map((r) => (
                    <option key={r.currency} value={r.currency}>
                      {r.currency}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rec-paidby">
                Paid by
              </label>
              <select id="rec-paidby" name="paidBy" className="input" defaultValue={members[0]?.id}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rec-category">
                Category
              </label>
              <select id="rec-category" name="category" className="input" defaultValue="rent">
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rec-interval">
                Repeats
              </label>
              <select id="rec-interval" name="intervalMonths" className="input" defaultValue={1}>
                {INTERVALS.map((i) => (
                  <option key={i.months} value={i.months}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rec-anchor">
                On the
              </label>
              <select
                id="rec-anchor"
                name="anchorDay"
                className="input"
                value={anchorDay}
                onChange={(e) => setAnchorDay(Number(e.target.value))}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {ordinal(d)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
            <p className="text-xs text-slate-500">Next four postings</p>
            <p className="mt-1 text-sm tabular-nums text-slate-300">
              {landings.map((d) => formatDate(d)).join(' · ')}
            </p>
            {anchorDay > 28 && (
              <p className="mt-1.5 text-[11px] text-amber-400/80">
                Short months fall back to their last day — the {ordinal(anchorDay)} is kept for
                every month that has one.
              </p>
            )}
          </div>

          <div>
            <span className="label">Split equally between</span>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-white/[0.06] p-1.5">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-white/[0.04]"
                >
                  <input
                    type="checkbox"
                    name="participants"
                    value={m.id}
                    defaultChecked
                    className="h-4 w-4 accent-brand-500"
                  />
                  <Avatar name={m.name} size="sm" />
                  <span className="truncate text-sm text-slate-200">{m.name}</span>
                </label>
              ))}
            </div>
          </div>

          {state && !state.ok && <ErrorNote message={state.error} />}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">
              Cancel
            </button>
            <SubmitButton className="btn-primary flex-1" pendingLabel="Saving…">
              Add recurring
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
