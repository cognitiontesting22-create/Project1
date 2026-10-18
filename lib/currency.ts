/**
 * Currency conversion, done so that converted balances still sum to exactly
 * zero.
 *
 * The rule that makes that work: **convert once, on the transaction total, then
 * split the converted integer.** Converting each person's share separately
 * would round N times and leave the shares not quite adding up to the total,
 * and those stray cents would accumulate into balances that never settle.
 *
 * Rates are quoted as "units of this currency per 1 USD", scaled by 1e8, so any
 * pair is derived from one base and cross-rates can't contradict each other.
 */

export const RATE_SCALE = 100_000_000; // 1e8
export const BASE_CURRENCY = 'USD';

/** Divide with half-away-from-zero rounding, in exact integer arithmetic. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const rounded = (a % b) * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Convert a minor-unit amount between two currencies given their USD rates.
 *
 * Uses BigInt because `amount * rate` leaves the 2^53 safe-integer range for
 * ordinary amounts — ¥9,000,000,000 against a 1e10-scaled rate is already ~1e19.
 * Float64 happens to land on the right answer for most inputs at this size, but
 * it isn't guaranteed to, and "probably exact" is not a property you want
 * underneath a ledger. BigInt makes it exact by construction instead.
 */
export function convertMinorUnits(amount: number, fromRateE8: number, toRateE8: number): number {
  if (!Number.isInteger(amount)) throw new Error('Amounts must be whole minor units.');
  if (fromRateE8 <= 0 || toRateE8 <= 0) throw new Error('Exchange rates must be above zero.');
  if (fromRateE8 === toRateE8) return amount; // same currency: never round
  return Number(divideRounded(BigInt(amount) * BigInt(toRateE8), BigInt(fromRateE8)));
}

/**
 * Apply a stored from→to rate (scaled by 1e8) to an amount: the conversion an
 * edit uses so an expense keeps the rate it was booked at, whatever the rate
 * table says today. Same half-away-from-zero BigInt rounding as above.
 */
export function applyRateE8(amount: number, rateE8: number): number {
  if (!Number.isInteger(amount)) throw new Error('Amounts must be whole minor units.');
  if (rateE8 <= 0) throw new Error('Exchange rates must be above zero.');
  if (rateE8 === RATE_SCALE) return amount; // same currency: never round
  return Number(divideRounded(BigInt(amount) * BigInt(rateE8), BigInt(RATE_SCALE)));
}

/** The effective from→to rate, scaled by 1e8, stored for auditability. */
export function effectiveRateE8(fromRateE8: number, toRateE8: number): number {
  if (fromRateE8 === toRateE8) return RATE_SCALE;
  return Number(
    divideRounded(BigInt(toRateE8) * BigInt(RATE_SCALE), BigInt(fromRateE8))
  );
}

/** 92000000 -> "0.92" — for display and for the rates editor input. */
export function rateToInput(rateE8: number): string {
  return String(Number((rateE8 / RATE_SCALE).toFixed(8)));
}

export function rateFromInput(input: string): number {
  const n = Number.parseFloat(input.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n * RATE_SCALE);
}

/** "1 EUR = 1.087 USD", the direction people actually read. */
export function describeRate(from: string, fromRateE8: number, to: string, toRateE8: number): string {
  const value = effectiveRateE8(fromRateE8, toRateE8) / RATE_SCALE;
  return `1 ${from} = ${Number(value.toFixed(6))} ${to}`;
}
