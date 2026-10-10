/**
 * All money is stored and computed as integer cents. Floats only ever appear at
 * the parse/format boundary, so splits always reconcile to the exact total.
 */

/** Parse user text into hundredths of a unit — the one rounding boundary. */
function toHundredths(input: string | number): number {
  const n = typeof input === 'number' ? input : Number.parseFloat(input.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function toCents(input: string | number): number {
  return toHundredths(input);
}

/**
 * Percentages get the same integer treatment as money: 100% is 10_000 basis
 * points. Floats can't answer "do these add up to 100?" — 33.33 + 33.33 + 33.34
 * is 100.00000000000001 — but integers can, exactly.
 */
export const FULL_PERCENT_BP = 10_000;

export function toBasisPoints(input: string | number): number {
  return toHundredths(input);
}

/** 2500 -> "25%", 3333 -> "33.33%" */
export function formatBasisPoints(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

/** 150 -> "1.5 shares" */
export function formatShares(centishares: number): string {
  const n = centishares / 100;
  const value = Number.isInteger(n) ? n : Number(n.toFixed(2));
  return `${value} ${value === 1 ? 'share' : 'shares'}`;
}

/** Value for a numeric input, without trailing-zero noise: 3333 -> "33.33" */
export function hundredthsToInput(value: number): string {
  return String(Number((value / 100).toFixed(2)));
}

export function formatCents(cents: number, currency = 'USD'): string {
  try {
    // No forced fraction digits — Intl knows each currency's convention, so JPY
    // renders as ¥1,200 while USD stays $12.00.
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    // Unknown/custom currency code: fall back to a plain number plus the code.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Compact form for dense UI, e.g. 1234567 -> "$12.3k". */
export function formatCompact(cents: number, currency = 'USD'): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) < 10_000) return formatCents(cents, currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(dollars);
}

/**
 * Split `total` cents across `weights`, distributing the leftover cents one at a
 * time to the largest remainders (Hamilton / largest-remainder apportionment).
 * Guarantees `sum(result) === total` for any weighting.
 */
export function splitByWeights(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  // Hand out the remaining cents to whoever was rounded down hardest.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (let k = 0; remainder > 0; k++, remainder--) {
    result[order[k % order.length].i] += 1;
  }
  return result;
}

/** Equal split is just an all-ones weighting. */
export function splitEqually(total: number, n: number): number[] {
  return splitByWeights(total, Array.from({ length: n }, () => 1));
}
