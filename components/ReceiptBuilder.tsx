'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { createReceiptAction, type ActionResult } from '@/app/actions';
import { formatCents, toCents } from '@/lib/money';
import { allocateReceipt, tipFromPercent } from '@/lib/receipts';
import { CATEGORIES, type ExchangeRate, type Member } from '@/lib/types';
import Avatar from './Avatar';
import Modal from './Modal';
import SubmitButton, { ErrorNote } from './SubmitButton';

type DraftItem = { key: number; description: string; amount: string; memberIds: number[] };

const TIP_PRESETS = [0, 1500, 1800, 2000, 2200];

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ReceiptBuilder({
  groupId,
  members,
  currency,
  rates,
}: {
  groupId: number;
  members: Member[];
  currency: string;
  rates: ExchangeRate[];
}) {
  const [open, setOpen] = useState(false);
  const [nextKey, setNextKey] = useState(2);
  const [items, setItems] = useState<DraftItem[]>([
    { key: 0, description: '', amount: '', memberIds: [] },
    { key: 1, description: '', amount: '', memberIds: [] },
  ]);
  const [tax, setTax] = useState('');
  const [tip, setTip] = useState('');
  const [entryCurrency, setEntryCurrency] = useState(currency);

  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    createReceiptAction,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setItems([
        { key: 0, description: '', amount: '', memberIds: [] },
        { key: 1, description: '', amount: '', memberIds: [] },
      ]);
      setNextKey(2);
      setTax('');
      setTip('');
      setEntryCurrency(currency);
    }
  }, [state, currency]);

  const filled = items.filter((i) => (toCents(i.amount) || 0) > 0);
  const subtotal = filled.reduce((sum, i) => sum + (toCents(i.amount) || 0), 0);
  const taxCents = toCents(tax) || 0;
  const tipCents = toCents(tip) || 0;

  const unassigned = filled.filter((i) => i.memberIds.length === 0);

  /** Same allocator the server runs, for a live preview. */
  const preview = useMemo(() => {
    if (filled.length === 0 || unassigned.length > 0) return null;
    try {
      return allocateReceipt({
        items: filled.map((i) => ({
          id: i.key,
          description: i.description,
          amountCents: toCents(i.amount) || 0,
          memberIds: i.memberIds,
        })),
        taxCents,
        tipCents,
      });
    } catch {
      return null;
    }
  }, [filled, unassigned.length, taxCents, tipCents]);

  const update = (key: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const toggleMember = (key: number, memberId: number) =>
    setItems((prev) =>
      prev.map((i) =>
        i.key === key
          ? {
              ...i,
              memberIds: i.memberIds.includes(memberId)
                ? i.memberIds.filter((m) => m !== memberId)
                : [...i.memberIds, memberId],
            }
          : i
      )
    );

  const addItem = () => {
    setItems((prev) => [...prev, { key: nextKey, description: '', amount: '', memberIds: [] }]);
    setNextKey((k) => k + 1);
  };

  const canSubmit = filled.length > 0 && unassigned.length === 0 && preview !== null;
  const byMember = Object.fromEntries((preview?.members ?? []).map((m) => [m.member_id, m]));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost">
        <span aria-hidden>🧾</span> Itemise a bill
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Itemise a bill"
        subtitle="Assign each line to whoever had it. Tax and tip follow in proportion."
      >
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="tax" value={tax} />
          <input type="hidden" name="tip" value={tip} />
          <input type="hidden" name="currency" value={entryCurrency} />
          <input
            type="hidden"
            name="items"
            value={JSON.stringify(
              filled.map((i) => ({
                description: i.description,
                amount: i.amount,
                memberIds: i.memberIds,
              }))
            )}
          />

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="label" htmlFor="rcp-desc">
                Where
              </label>
              <input
                id="rcp-desc"
                name="description"
                required
                autoFocus
                placeholder="Lucia's Trattoria"
                className="input"
              />
            </div>
            <div className="sm:w-32">
              <label className="label" htmlFor="rcp-date">
                Date
              </label>
              <input
                id="rcp-date"
                name="spentAt"
                type="date"
                defaultValue={todayLocal()}
                className="input"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rcp-paidby">
                Paid by
              </label>
              <select id="rcp-paidby" name="paidBy" className="input" defaultValue={members[0]?.id}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rcp-cat">
                Category
              </label>
              <select id="rcp-cat" name="category" className="input" defaultValue="food">
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-end justify-between">
              <span className="label mb-0">Items</span>
              <button
                type="button"
                onClick={addItem}
                className="text-xs font-medium text-brand-400 hover:text-brand-300"
              >
                ＋ Add line
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item) => {
                const cents = toCents(item.amount) || 0;
                const needsPeople = cents > 0 && item.memberIds.length === 0;

                return (
                  <div
                    key={item.key}
                    className={`rounded-xl border p-2.5 transition ${
                      needsPeople
                        ? 'border-amber-500/40 bg-amber-500/[0.06]'
                        : 'border-white/[0.06] bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex gap-2">
                      <input
                        value={item.description}
                        onChange={(e) => update(item.key, { description: e.target.value })}
                        placeholder="Ribeye"
                        aria-label="Item description"
                        className="input flex-1 py-1.5 text-sm"
                      />
                      <input
                        value={item.amount}
                        onChange={(e) => update(item.key, { amount: e.target.value })}
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label="Item amount"
                        className="input w-24 py-1.5 text-right text-sm tabular-nums"
                      />
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                          aria-label="Remove line"
                          className="shrink-0 px-1 text-slate-600 transition hover:text-rose-400"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">had by</span>
                      {members.map((m) => {
                        const on = item.memberIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleMember(item.key, m.id)}
                            aria-pressed={on}
                            className={`chip px-2 py-0.5 text-[11px] transition ${
                              on
                                ? 'border-brand-500/60 bg-brand-500/15 text-brand-300'
                                : 'hover:bg-white/[0.08]'
                            }`}
                          >
                            {m.name}
                          </button>
                        );
                      })}
                      {item.memberIds.length > 1 && cents > 0 && (
                        <span className="ml-auto text-[11px] tabular-nums text-slate-500">
                          {formatCents(Math.floor(cents / item.memberIds.length), entryCurrency)} each
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rcp-tax">
                Tax
              </label>
              <input
                id="rcp-tax"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="input text-right tabular-nums"
              />
            </div>
            <div>
              <label className="label" htmlFor="rcp-tip">
                Tip
              </label>
              <input
                id="rcp-tip"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="input text-right tabular-nums"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {TIP_PRESETS.map((bp) => (
                  <button
                    key={bp}
                    type="button"
                    disabled={subtotal === 0}
                    onClick={() =>
                      setTip(bp === 0 ? '' : (tipFromPercent(subtotal, bp) / 100).toFixed(2))
                    }
                    className="chip px-2 py-0.5 text-[11px] hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    {bp === 0 ? 'none' : `${bp / 100}%`}
                  </button>
                ))}
                <span className="self-center text-[11px] text-slate-600">of pre-tax</span>
              </div>
            </div>
          </div>

          {unassigned.length > 0 && (
            <ErrorNote
              message={`${unassigned.length} item${
                unassigned.length === 1 ? '' : 's'
              } still need someone assigned — a bill can't be saved half-allocated.`}
            />
          )}

          {preview && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <div className="mb-2 flex justify-between text-xs text-slate-500">
                <span>
                  Items {formatCents(preview.subtotal_cents, entryCurrency)} · tax{' '}
                  {formatCents(preview.tax_cents, entryCurrency)} · tip{' '}
                  {formatCents(preview.tip_cents, entryCurrency)}
                </span>
                <span className="font-bold text-white">
                  {formatCents(preview.total_cents, entryCurrency)}
                </span>
              </div>
              <ul className="space-y-1 border-t border-white/[0.05] pt-2">
                {members
                  .filter((m) => byMember[m.id])
                  .map((m) => {
                    const a = byMember[m.id];
                    return (
                      <li key={m.id} className="flex items-center gap-2.5 text-sm">
                        <Avatar name={m.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-slate-300">{m.name}</span>
                        <span className="text-[11px] tabular-nums text-slate-500">
                          {formatCents(a.items_cents, entryCurrency)} +{' '}
                          {formatCents(a.tax_cents + a.tip_cents, entryCurrency)}
                        </span>
                        <span className="w-20 text-right font-semibold tabular-nums text-white">
                          {formatCents(a.total_cents, entryCurrency)}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          {state && !state.ok && <ErrorNote message={state.error} />}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">
              Cancel
            </button>
            <SubmitButton
              className="btn-primary flex-1"
              pendingLabel="Saving…"
              disabled={!canSubmit}
            >
              Save receipt
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
