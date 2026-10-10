'use client';

import { RATE_SCALE, convertMinorUnits, describeRate } from '@/lib/currency';
import { formatCents, toCents } from '@/lib/money';
import type { ExchangeRate } from '@/lib/types';

/**
 * Amount field plus a currency picker. When the picked currency differs from
 * the group's, it shows the converted figure that will actually be recorded —
 * the conversion the server will do, mirrored so there are no surprises.
 */
export default function AmountWithCurrency({
  amount,
  onAmountChange,
  currency,
  onCurrencyChange,
  groupCurrency,
  rates,
  label = 'Amount',
  id = 'amount',
  autoFocus,
}: {
  amount: string;
  onAmountChange: (value: string) => void;
  currency: string;
  onCurrencyChange: (value: string) => void;
  groupCurrency: string;
  rates: ExchangeRate[];
  label?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const rateOf = (code: string) =>
    rates.find((r) => r.currency === code)?.rate_e8 ?? RATE_SCALE;

  const foreign = currency !== groupCurrency;
  const cents = toCents(amount);
  const valid = Number.isFinite(cents) && cents > 0;

  const converted = valid ? convertMinorUnits(cents, rateOf(currency), rateOf(groupCurrency)) : 0;

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          name="amount"
          required
          autoFocus={autoFocus}
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
          className="input flex-1 text-right font-semibold tabular-nums"
        />
        <select
          name="currency"
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          aria-label="Currency"
          className="input w-24 shrink-0 px-2 text-sm font-semibold"
        >
          {rates.map((r) => (
            <option key={r.currency} value={r.currency}>
              {r.currency}
            </option>
          ))}
        </select>
      </div>

      {foreign && (
        <p className="mt-1.5 text-xs text-slate-500">
          {valid ? (
            <>
              Recorded as{' '}
              <span className="font-semibold text-brand-400">
                {formatCents(converted, groupCurrency)}
              </span>{' '}
              · {describeRate(currency, rateOf(currency), groupCurrency, rateOf(groupCurrency))}
            </>
          ) : (
            describeRate(currency, rateOf(currency), groupCurrency, rateOf(groupCurrency))
          )}
        </p>
      )}
    </div>
  );
}
