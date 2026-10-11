import { SPLIT_TYPES, type SplitType } from './types';

/**
 * One filter definition shared by the group page and the CSV export, so what
 * you download can never be a different set of rows from what you were looking
 * at. Filters live in the URL, which also makes a filtered view shareable.
 */
export type LedgerFilters = {
  /** Inclusive calendar bounds on the economic date (spent_at / settled_at). */
  from?: string;
  to?: string;
  categories: string[];
  /** Expenses this person paid for. */
  paidBy: number[];
  /** Expenses this person appears on at all — as payer or with a share. */
  involving: number[];
  splitTypes: SplitType[];
  /** Matches the currency the expense was entered in. */
  currencies: string[];
  /** Hide rows the app generated itself (recurrences, plan instalments). */
  manualOnly: boolean;
};

export const EMPTY_FILTERS: LedgerFilters = {
  categories: [],
  paidBy: [],
  involving: [],
  splitTypes: [],
  currencies: [],
  manualOnly: false,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts repeated params (`?category=a&category=b`) and comma-separated. */
function readList(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

function readIds(params: URLSearchParams, key: string): number[] {
  return readList(params, key)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Malformed parameters are reported rather than ignored. Silently dropping a
 * bad `from=` would hand back the whole ledger when the caller asked for one
 * month — the kind of quietly-wrong result that is worse than an error.
 */
export function filterParamErrors(params: URLSearchParams): string[] {
  const errors: string[] = [];

  for (const key of ['from', 'to'] as const) {
    const value = params.get(key);
    if (value !== null && !ISO_DATE.test(value)) {
      errors.push(`${key} must be a date formatted YYYY-MM-DD (got "${value}").`);
    }
  }
  for (const value of readList(params, 'splitType')) {
    if (!(SPLIT_TYPES as string[]).includes(value)) {
      errors.push(`splitType must be one of: ${SPLIT_TYPES.join(', ')} (got "${value}").`);
    }
  }
  for (const key of ['paidBy', 'involving'] as const) {
    for (const value of readList(params, key)) {
      if (!/^\d+$/.test(value)) errors.push(`${key} must be a member id (got "${value}").`);
    }
  }
  const source = params.get('source');
  if (source !== null && source !== 'manual' && source !== 'all') {
    errors.push(`source must be "manual" or "all" (got "${source}").`);
  }

  return errors;
}

export function parseFilters(params: URLSearchParams): LedgerFilters {
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;

  const filters: LedgerFilters = {
    from: from && ISO_DATE.test(from) ? from : undefined,
    to: to && ISO_DATE.test(to) ? to : undefined,
    categories: readList(params, 'category'),
    paidBy: readIds(params, 'paidBy'),
    involving: readIds(params, 'involving'),
    splitTypes: readList(params, 'splitType').filter((v): v is SplitType =>
      (SPLIT_TYPES as string[]).includes(v)
    ),
    currencies: readList(params, 'currency').map((c) => c.toUpperCase()),
    manualOnly: params.get('source') === 'manual',
  };

  // A backwards range selects nothing and reads like a bug; treat it as unset.
  if (filters.from && filters.to && filters.from > filters.to) {
    return { ...filters, from: filters.to, to: filters.from };
  }
  return filters;
}

/** Accepts Next's `searchParams` shape directly. */
export function filtersFromSearchParams(
  input: Record<string, string | string[] | undefined>
): LedgerFilters {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.append(key, value);
  }
  return parseFilters(params);
}

export function toSearchParams(filters: LedgerFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  for (const c of filters.categories) params.append('category', c);
  for (const id of filters.paidBy) params.append('paidBy', String(id));
  for (const id of filters.involving) params.append('involving', String(id));
  for (const t of filters.splitTypes) params.append('splitType', t);
  for (const c of filters.currencies) params.append('currency', c);
  if (filters.manualOnly) params.set('source', 'manual');
  return params;
}

export function activeFilterCount(filters: LedgerFilters): number {
  return (
    (filters.from || filters.to ? 1 : 0) +
    (filters.categories.length ? 1 : 0) +
    (filters.paidBy.length ? 1 : 0) +
    (filters.involving.length ? 1 : 0) +
    (filters.splitTypes.length ? 1 : 0) +
    (filters.currencies.length ? 1 : 0) +
    (filters.manualOnly ? 1 : 0)
  );
}

export function hasFilters(filters: LedgerFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/* --------------------------------------------------------------- SQL ---- */

export type SqlFragment = { clauses: string[]; params: Record<string, unknown> };

/**
 * better-sqlite3 has no array binding, so IN lists are expanded into numbered
 * placeholders. Values still go through binding — never interpolated.
 */
function inClause(
  column: string,
  values: (string | number)[],
  prefix: string,
  params: Record<string, unknown>
): string {
  const names = values.map((value, i) => {
    const name = `${prefix}${i}`;
    params[name] = value;
    return `@${name}`;
  });
  return `${column} IN (${names.join(', ')})`;
}

/**
 * Builds the WHERE fragments for the expenses table.
 *
 * `date(...)` normalises both storage shapes: a date-only `spent_at` from the
 * form, and a full `datetime('now')` timestamp. Comparing the raw strings would
 * drop today's rows, because '2026-10-11 14:03:22' sorts after '2026-10-11'.
 */
export function expenseFilterSql(filters: LedgerFilters): SqlFragment {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.from) {
    clauses.push('date(e.spent_at) >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push('date(e.spent_at) <= @to');
    params.to = filters.to;
  }
  if (filters.categories.length) {
    clauses.push(inClause('e.category', filters.categories, 'cat', params));
  }
  if (filters.paidBy.length) {
    clauses.push(inClause('e.paid_by', filters.paidBy, 'payer', params));
  }
  if (filters.splitTypes.length) {
    clauses.push(inClause('e.split_type', filters.splitTypes, 'stype', params));
  }
  if (filters.currencies.length) {
    clauses.push(inClause('e.original_currency', filters.currencies, 'cur', params));
  }
  if (filters.involving.length) {
    // "Involved" means they appear on the expense at all — either they fronted
    // the money or they carry a share of it.
    const payer = inClause('e.paid_by', filters.involving, 'inv', params);
    const shares = inClause('s.member_id', filters.involving, 'invs', params);
    clauses.push(
      `(${payer} OR EXISTS (SELECT 1 FROM expense_splits s WHERE s.expense_id = e.id AND ${shares}))`
    );
  }
  if (filters.manualOnly) {
    clauses.push(`e.recurring_id IS NULL`);
    clauses.push(
      `e.id NOT IN (SELECT interest_expense_id FROM plan_installments
                     WHERE interest_expense_id IS NOT NULL)`
    );
  }

  return { clauses, params };
}

/**
 * Settlements carry fewer dimensions than expenses. Filters that can't apply
 * (category, split type) deliberately don't exclude payments — a category
 * filter is about what was bought, and paying someone back isn't a purchase.
 */
export function settlementFilterSql(filters: LedgerFilters): SqlFragment {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.from) {
    clauses.push('date(s.settled_at) >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push('date(s.settled_at) <= @to');
    params.to = filters.to;
  }
  if (filters.currencies.length) {
    clauses.push(inClause('s.original_currency', filters.currencies, 'cur', params));
  }
  if (filters.involving.length || filters.paidBy.length) {
    const people = [...new Set([...filters.involving, ...filters.paidBy])];
    const from = inClause('s.from_member_id', people, 'pfrom', params);
    const to = inClause('s.to_member_id', people, 'pto', params);
    clauses.push(`(${from} OR ${to})`);
  }
  if (filters.manualOnly) {
    clauses.push(
      `s.id NOT IN (SELECT settlement_id FROM plan_installments
                     WHERE settlement_id IS NOT NULL)`
    );
  }

  return { clauses, params };
}

export function whereOf(fragment: SqlFragment, base: string): string {
  return [base, ...fragment.clauses].join(' AND ');
}
