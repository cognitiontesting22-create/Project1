'use client';

import { useActionState, useEffect, useState } from 'react';
import { createSettlementAction, type ActionResult } from '@/app/actions';
import { formatCents } from '@/lib/money';
import type { ExchangeRate, Member } from '@/lib/types';
import AmountWithCurrency from './AmountWithCurrency';
import Modal from './Modal';
import SubmitButton, { ErrorNote } from './SubmitButton';

export default function SettleUpButton({
  groupId,
  members,
  currency,
  rates,
  preset,
  label = 'Settle up',
  className = 'btn-ghost',
}: {
  groupId: number;
  members: Member[];
  currency: string;
  rates: ExchangeRate[];
  /** Prefill from a suggested payment so one click records it. */
  preset?: { fromMemberId: number; toMemberId: number; amountCents: number };
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    createSettlementAction,
    null
  );

  const [entryCurrency, setEntryCurrency] = useState(currency);
  const [amount, setAmount] = useState(preset ? String(preset.amountCents / 100) : '');

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setAmount('');
      setEntryCurrency(currency);
    }
  }, [state, currency]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record a payment"
        subtitle="Log cash that already changed hands to clear a balance."
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="groupId" value={groupId} />

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div>
              <label className="label" htmlFor="set-from">
                From
              </label>
              <select
                id="set-from"
                name="fromMemberId"
                className="input"
                defaultValue={preset?.fromMemberId ?? members[0]?.id}
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
              <label className="label" htmlFor="set-to">
                To
              </label>
              <select
                id="set-to"
                name="toMemberId"
                className="input"
                defaultValue={preset?.toMemberId ?? members[1]?.id ?? members[0]?.id}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <AmountWithCurrency
              id="set-amount"
              amount={amount}
              onAmountChange={setAmount}
              currency={entryCurrency}
              onCurrencyChange={setEntryCurrency}
              groupCurrency={currency}
              rates={rates}
            />
            {preset && (
              <p className="mt-1.5 text-xs text-slate-500">
                Suggested: {formatCents(preset.amountCents, currency)}
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="set-note">
              Note <span className="normal-case text-slate-600">(optional)</span>
            </label>
            <input id="set-note" name="note" placeholder="Venmo" className="input" />
          </div>

          {state && !state.ok && <ErrorNote message={state.error} />}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">
              Cancel
            </button>
            <SubmitButton className="btn-primary flex-1" pendingLabel="Recording…">
              Record payment
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
