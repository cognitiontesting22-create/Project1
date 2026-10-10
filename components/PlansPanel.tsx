'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { cancelPlanAction, createPlanAction, deletePlanAction, type ActionResult } from '@/app/actions';
import { buildSchedule, scheduleTotals } from '@/lib/amortize';
import { formatDate } from '@/lib/dates';
import { formatBasisPoints, formatCents, toBasisPoints, toCents } from '@/lib/money';
import { today } from '@/lib/schedule';
import type { Debt, Member, PaymentPlan } from '@/lib/types';
import Avatar from './Avatar';
import Modal from './Modal';
import SubmitButton, { ErrorNote } from './SubmitButton';

type PlanPreview =
  | null
  | { ok: false; error: string }
  | { ok: true; schedule: ReturnType<typeof buildSchedule>; totals: ReturnType<typeof scheduleTotals> };

export default function PlansPanel({
  groupId,
  members,
  currency,
  plans,
  debts,
}: {
  groupId: number;
  members: Member[];
  currency: string;
  plans: PaymentPlan[];
  /** Suggested settlements, so a plan can be started straight from a real debt. */
  debts: Debt[];
}) {
  const [open, setOpen] = useState(false);
  const [principal, setPrincipal] = useState('');
  const [apr, setApr] = useState('0');
  const [installments, setInstallments] = useState(6);
  const [grace, setGrace] = useState(0);
  const [debtor, setDebtor] = useState<number | undefined>(members[0]?.id);
  const [creditor, setCreditor] = useState<number | undefined>(members[1]?.id);

  const [state, formAction] = useActionState<ActionResult | null, FormData>(createPlanAction, null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setPrincipal('');
      setApr('0');
      setGrace(0);
      setInstallments(6);
    }
  }, [state]);

  /** Live preview using the same engine the server will use. */
  const preview = useMemo((): PlanPreview => {
    const principalCents = toCents(principal);
    const aprBp = toBasisPoints(apr);
    if (!Number.isFinite(principalCents) || principalCents <= 0) return null;
    if (!Number.isFinite(aprBp)) return null;
    try {
      const schedule = buildSchedule({
        principalCents,
        aprBp,
        installments,
        gracePeriods: grace,
      });
      return { ok: true, schedule, totals: scheduleTotals(schedule) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Those terms don’t work.' };
    }
  }, [principal, apr, installments, grace]);

  const startFromDebt = (d: Debt) => {
    setDebtor(d.from_member_id);
    setCreditor(d.to_member_id);
    setPrincipal(String(d.amount_cents / 100));
    setOpen(true);
  };

  const active = plans.filter((p) => !p.cancelled);

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-white">Payment plans</h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          ＋ New plan
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        For when someone can&apos;t settle in one go — instalments post themselves each month.
      </p>

      {plans.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center">
          <p className="text-xs text-slate-500">No plans yet.</p>
          {debts.length > 0 && (
            <button
              type="button"
              onClick={() => startFromDebt(debts[0])}
              className="mt-2 text-xs font-medium text-brand-400 hover:text-brand-300"
            >
              Spread {debts[0].from_name}&apos;s {formatCents(debts[0].amount_cents, currency)} over
              time
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {plans.map((p) => {
            const pct = p.total_cents > 0 ? (p.paid_cents / p.total_cents) * 100 : 0;
            return (
              <li
                key={p.id}
                className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 ${
                  p.cancelled ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Avatar name={p.debtor_name} size="sm" />
                  <span className="text-slate-600" aria-hidden>
                    →
                  </span>
                  <Avatar name={p.creditor_name} size="sm" />
                  <span className="min-w-0 flex-1 px-1 text-xs text-slate-400">
                    <span className="font-medium text-slate-200">{p.debtor_name}</span> over{' '}
                    {p.installments} months
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold tabular-nums text-white">
                      {formatCents(p.principal_cents, currency)}
                    </span>
                    {p.interest_cents > 0 && (
                      <span className="block text-[11px] text-amber-400/80">
                        +{formatCents(p.interest_cents, currency)} interest
                      </span>
                    )}
                  </span>
                </div>

                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-grape-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {p.paid_count}/{p.installments} paid ·{' '}
                    {formatCents(p.remaining_cents, currency)} left
                    {p.apr_bp > 0 && ` · ${formatBasisPoints(p.apr_bp)} APR`}
                    {p.grace_periods > 0 && ` · ${p.grace_periods} grace`}
                  </span>
                  {!p.cancelled && p.next_due && <span>next {formatDate(p.next_due)}</span>}
                  {p.cancelled === 1 && <span>cancelled</span>}
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-slate-400 hover:text-white">
                    Schedule ▾
                  </summary>
                  <table className="mt-2 w-full text-[11px] tabular-nums">
                    <thead className="text-slate-600">
                      <tr>
                        <th className="pb-1 text-left font-medium">Due</th>
                        <th className="pb-1 text-right font-medium">Pay</th>
                        <th className="pb-1 text-right font-medium">Interest</th>
                        <th className="pb-1 text-right font-medium">Left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.schedule.map((i) => (
                        <tr
                          key={i.id}
                          className={i.posted_at ? 'text-slate-500' : 'text-slate-300'}
                        >
                          <td className="py-0.5 text-left">
                            {i.posted_at ? '✓ ' : ''}
                            {formatDate(i.due_date)}
                          </td>
                          <td className="py-0.5 text-right">
                            {formatCents(i.payment_cents, currency)}
                          </td>
                          <td className="py-0.5 text-right">
                            {i.in_grace ? (
                              <span className="text-brand-400/70">grace</span>
                            ) : (
                              formatCents(i.interest_cents, currency)
                            )}
                          </td>
                          <td className="py-0.5 text-right">
                            {formatCents(i.balance_cents, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-2 flex justify-end gap-2">
                    {!p.cancelled && (
                      <form action={cancelPlanAction}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="planId" value={p.id} />
                        <button
                          type="submit"
                          className="text-[11px] font-medium text-slate-400 hover:text-amber-400"
                        >
                          Cancel plan
                        </button>
                      </form>
                    )}
                    {p.paid_count === 0 && (
                      <form action={deletePlanAction}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="planId" value={p.id} />
                        <button
                          type="submit"
                          className="text-[11px] font-medium text-slate-500 hover:text-rose-400"
                        >
                          Delete
                        </button>
                      </form>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {active.length > 0 && debts.length > 0 && (
        <button
          type="button"
          onClick={() => startFromDebt(debts[0])}
          className="mt-3 w-full text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          Spread another debt over time
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Set up a payment plan"
        subtitle="Agree how a debt gets paid back over time, interest and all."
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="startDate" value={today()} />
          <input type="hidden" name="installments" value={installments} />
          <input type="hidden" name="gracePeriods" value={grace} />

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div>
              <label className="label" htmlFor="plan-debtor">
                Who owes
              </label>
              <select
                id="plan-debtor"
                name="debtorId"
                className="input"
                value={debtor}
                onChange={(e) => setDebtor(Number(e.target.value))}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="pb-3 text-slate-500" aria-hidden>
              →
            </span>
            <div>
              <label className="label" htmlFor="plan-creditor">
                Pays back
              </label>
              <select
                id="plan-creditor"
                name="creditorId"
                className="input"
                value={creditor}
                onChange={(e) => setCreditor(Number(e.target.value))}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="plan-principal">
                Amount ({currency})
              </label>
              <input
                id="plan-principal"
                name="principal"
                required
                inputMode="decimal"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                placeholder="0.00"
                className="input text-right font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="label" htmlFor="plan-anchor">
                Due each month on the
              </label>
              <select id="plan-anchor" name="anchorDay" className="input" defaultValue={1}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label mb-0">Over</span>
              <span className="text-xs font-semibold text-slate-300">
                {installments} month{installments === 1 ? '' : 's'}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={24}
              value={installments}
              onChange={(e) => {
                const n = Number(e.target.value);
                setInstallments(n);
                if (grace > n) setGrace(n);
              }}
              className="w-full accent-brand-500"
              aria-label="Number of instalments"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="plan-apr">
                Interest (APR)
              </label>
              <div className="relative">
                <input
                  id="plan-apr"
                  name="apr"
                  inputMode="decimal"
                  value={apr}
                  onChange={(e) => setApr(e.target.value)}
                  className="input pr-6 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  %
                </span>
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label mb-0">Interest-free months</span>
                <span className="text-xs font-semibold text-slate-300">{grace}</span>
              </div>
              <input
                type="range"
                min={0}
                max={installments}
                value={grace}
                onChange={(e) => setGrace(Number(e.target.value))}
                className="w-full accent-brand-500"
                aria-label="Grace periods"
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Grace months are charged no interest at all — set it to the full term for a plain
            interest-free agreement, or leave a few months of slack before the clock starts.
          </p>

          {preview && !preview.ok && <ErrorNote message={preview.error} />}

          {preview && preview.ok && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-500">
                  {preview.schedule.length} payments of about
                </span>
                <span className="text-lg font-bold tabular-nums text-white">
                  {formatCents(preview.schedule[0].payment_cents, currency)}
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t border-white/[0.05] pt-2 text-xs">
                <span className="text-slate-500">
                  Total {formatCents(preview.totals.total_cents, currency)}
                </span>
                <span
                  className={
                    preview.totals.interest_cents > 0 ? 'text-amber-400/90' : 'text-brand-400'
                  }
                >
                  {preview.totals.interest_cents > 0
                    ? `${formatCents(preview.totals.interest_cents, currency)} interest`
                    : 'interest free'}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor="plan-note">
              Note <span className="normal-case text-slate-600">(optional)</span>
            </label>
            <input
              id="plan-note"
              name="note"
              placeholder="Covering my half of the deposit"
              className="input"
            />
          </div>

          {state && !state.ok && <ErrorNote message={state.error} />}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">
              Cancel
            </button>
            <SubmitButton
              className="btn-primary flex-1"
              pendingLabel="Setting up…"
              disabled={!preview || !preview.ok || debtor === creditor}
            >
              Create plan
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
