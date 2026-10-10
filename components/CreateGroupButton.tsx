'use client';

import { useActionState, useState } from 'react';
import { createGroupAction, type ActionResult } from '@/app/actions';
import Modal from './Modal';
import SubmitButton, { ErrorNote } from './SubmitButton';

const EMOJI = ['💸', '🏠', '✈️', '🍜', '🏖️', '🎿', '🎉', '🚗', '🎓', '🏕️'];

export default function CreateGroupButton({
  variant = 'primary',
  currencies,
}: {
  variant?: 'primary' | 'ghost';
  /** Whatever is in the rate table — a group can only use a currency we can convert. */
  currencies: string[];
}) {
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    createGroupAction,
    null
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={variant === 'primary' ? 'btn-primary' : 'btn-ghost'}
      >
        <span aria-hidden>＋</span> New group
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Start a new group"
        subtitle="Name it, pick an icon, and list everyone splitting the bills."
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="emoji" value={emoji} />

          <div>
            <span className="label">Icon</span>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  aria-pressed={emoji === e}
                  className={`grid h-10 w-10 place-items-center rounded-xl border text-lg
                              transition ${
                                emoji === e
                                  ? 'border-brand-500/60 bg-brand-500/15 scale-105'
                                  : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08]'
                              }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="group-name">
              Group name
            </label>
            <input
              id="group-name"
              name="name"
              required
              autoFocus
              placeholder="Tahoe trip, Apartment 4B, Roadtrip…"
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="group-desc">
              Description <span className="normal-case text-slate-600">(optional)</span>
            </label>
            <input
              id="group-desc"
              name="description"
              placeholder="Ski weekend, Feb 2026"
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="group-members">
              People
            </label>
            <textarea
              id="group-members"
              name="members"
              required
              rows={3}
              placeholder="Alex, Sam, Jordan"
              className="input resize-none"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Separate names with commas or new lines. You can add more later.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="group-currency">
              Currency
            </label>
            <select
              id="group-currency"
              name="currency"
              className="input"
              defaultValue={currencies.includes('USD') ? 'USD' : currencies[0]}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {state && !state.ok && <ErrorNote message={state.error} />}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">
              Cancel
            </button>
            <SubmitButton className="btn-primary flex-1" pendingLabel="Creating…">
              Create group
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
