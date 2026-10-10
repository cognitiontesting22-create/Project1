'use client';

import { useActionState, useRef, useState } from 'react';
import { deleteRateAction, saveRateAction, type ActionResult } from '@/app/actions';
import { BASE_CURRENCY, RATE_SCALE, rateToInput } from '@/lib/currency';
import { formatCents } from '@/lib/money';
import type { ExchangeRate } from '@/lib/types';
import SubmitButton, { ErrorNote } from './SubmitButton';

/** One unit of the group's money, for a tangible "what is this worth" column. */
const SAMPLE_CENTS = 10_000; // 100.00 USD

export default function RatesEditor({ rates }: { rates: ExchangeRate[] }) {
  const [saveState, saveAction] = useActionState<ActionResult | null, FormData>(
    saveRateAction,
    null
  );
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(
    deleteRateAction,
    null
  );
  const [adding, setAdding] = useState(false);
  const addFormRef = useRef<HTMLFormElement>(null);

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="font-semibold text-white">Exchange rates</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Units per 1 {BASE_CURRENCY}. Editing a rate only affects new entries.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-xs font-medium text-brand-400 hover:text-brand-300"
          >
            {adding ? 'Cancel' : '＋ Add currency'}
          </button>
        </div>

        {adding && (
          <form
            ref={addFormRef}
            action={saveAction}
            className="flex flex-wrap items-end gap-3 border-b border-white/[0.06] bg-white/[0.02] px-5 py-4"
          >
            <div className="w-28">
              <label className="label" htmlFor="new-currency">
                Code
              </label>
              <input
                id="new-currency"
                name="currency"
                required
                maxLength={3}
                placeholder="NZD"
                className="input uppercase"
              />
            </div>
            <div className="w-40">
              <label className="label" htmlFor="new-rate">
                Per 1 {BASE_CURRENCY}
              </label>
              <input
                id="new-rate"
                name="rate"
                required
                inputMode="decimal"
                placeholder="1.64"
                className="input text-right tabular-nums"
              />
            </div>
            <SubmitButton className="btn-primary" pendingLabel="Adding…">
              Add
            </SubmitButton>
          </form>
        )}

        <ul className="divide-y divide-white/[0.05]">
          {rates.map((r) => {
            const isBase = r.currency === BASE_CURRENCY;
            return (
              <li
                key={r.currency}
                className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-white/[0.02]"
              >
                <span className="w-14 shrink-0 font-bold tabular-nums text-white">
                  {r.currency}
                </span>

                <span className="hidden w-40 shrink-0 text-xs text-slate-500 sm:block">
                  {formatCents(SAMPLE_CENTS, BASE_CURRENCY)} ={' '}
                  <span className="text-slate-300">
                    {formatCents(
                      Math.round((SAMPLE_CENTS * r.rate_e8) / RATE_SCALE),
                      r.currency
                    )}
                  </span>
                </span>

                <form action={saveAction} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="currency" value={r.currency} />
                  <input
                    name="rate"
                    inputMode="decimal"
                    defaultValue={rateToInput(r.rate_e8)}
                    disabled={isBase}
                    aria-label={`${r.currency} per 1 ${BASE_CURRENCY}`}
                    className="input w-32 py-1.5 text-right text-sm tabular-nums disabled:opacity-50"
                  />
                  {!isBase && (
                    <SubmitButton
                      className="btn-ghost px-3 py-1.5 text-xs"
                      pendingLabel="Saving…"
                    >
                      Save
                    </SubmitButton>
                  )}
                </form>

                {isBase ? (
                  <span className="chip shrink-0">base</span>
                ) : (
                  <form action={deleteAction}>
                    <input type="hidden" name="currency" value={r.currency} />
                    <button
                      type="submit"
                      aria-label={`Remove ${r.currency}`}
                      className="shrink-0 px-1 text-slate-600 transition hover:text-rose-400"
                    >
                      ✕
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {saveState && !saveState.ok && <ErrorNote message={saveState.error} />}
      {deleteState && !deleteState.ok && <ErrorNote message={deleteState.error} />}
    </div>
  );
}
