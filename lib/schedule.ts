/**
 * The calendar rule shared by recurring expenses and payment-plan installments.
 *
 * A schedule has an *anchor day* — the day of the month it wants to land on.
 * Months that are too short clamp to their last day, but the anchor itself never
 * changes. Rent anchored on the 31st posts Jan 31, Feb 28, Mar 31, Apr 30 —
 * it does not "stick" at the 28th once February has clamped it, which is the
 * bug you get from naively adding months to the previous occurrence.
 */

export const MAX_ANCHOR_DAY = 31;

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `month` is 1-based. Returns YYYY-MM-DD. */
export function occurrenceDate(year: number, month: number, anchorDay: number): string {
  const day = Math.min(Math.max(1, anchorDay), daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Stable identifier for one period of a schedule, e.g. "2026-02". */
export function periodKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export type Occurrence = { period: string; date: string; index: number };

export function parseISODate(value: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) throw new Error(`Not a date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Calendar-only comparison; both sides are YYYY-MM-DD strings. */
export function isOnOrBefore(a: string, b: string): boolean {
  return a.slice(0, 10) <= b.slice(0, 10);
}

/**
 * Every occurrence from `startDate` up to and including `through`.
 *
 * The first occurrence is the start date's own month (using the anchor day),
 * then every `intervalMonths` after that. `limit` caps the total number of
 * occurrences the schedule will ever produce — used for fixed-length plans.
 */
export function occurrencesThrough({
  startDate,
  anchorDay,
  intervalMonths = 1,
  through,
  limit,
}: {
  startDate: string;
  anchorDay: number;
  intervalMonths?: number;
  through: string;
  limit?: number;
}): Occurrence[] {
  if (intervalMonths < 1) throw new Error('A schedule has to advance by at least one month.');

  const start = parseISODate(startDate);
  const out: Occurrence[] = [];

  for (let index = 0; limit === undefined || index < limit; index++) {
    // Count months from the start month so clamping never compounds.
    const monthsFromStart = start.month - 1 + index * intervalMonths;
    const year = start.year + Math.floor(monthsFromStart / 12);
    const month = (monthsFromStart % 12) + 1;

    const date = occurrenceDate(year, month, anchorDay);

    // The first period can fall before the start date if the anchor day has
    // already passed that month — in that case it belongs to the next period.
    if (index === 0 && date < startDate.slice(0, 10)) continue;

    if (!isOnOrBefore(date, through)) break;
    out.push({ period: periodKey(year, month), date, index });

    // Runaway guard: a decade of monthly postings is far more catch-up than any
    // real group needs, and stops a bad start date from looping forever.
    if (out.length > 120) break;
  }

  return out;
}

/** The next occurrence strictly after `after`, for "next due" display. */
export function nextOccurrenceAfter({
  startDate,
  anchorDay,
  intervalMonths = 1,
  after,
  limit,
}: {
  startDate: string;
  anchorDay: number;
  intervalMonths?: number;
  after: string;
  limit?: number;
}): Occurrence | null {
  const start = parseISODate(startDate);

  for (let index = 0; limit === undefined || index < limit; index++) {
    const monthsFromStart = start.month - 1 + index * intervalMonths;
    const year = start.year + Math.floor(monthsFromStart / 12);
    const month = (monthsFromStart % 12) + 1;
    const date = occurrenceDate(year, month, anchorDay);

    if (index === 0 && date < startDate.slice(0, 10)) continue;
    if (date > after.slice(0, 10)) return { period: periodKey(year, month), date, index };
    if (index > 600) break;
  }
  return null;
}

/** Today in the server's local calendar, as YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
