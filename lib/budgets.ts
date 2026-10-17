/**
 * Monthly category budgets for a group.
 *
 * Holds no database handle: the SQL is exported as strings
 * and the status math is pure, so tests can run both against a throwaway
 * database without the app's singleton connection.
 */

import { daysInMonth, today } from './schedule';
import { CATEGORIES, categoryMeta } from './types';

/** YYYY-MM with a real month number. */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

/** The current month in the server's local calendar, matching today(). */
export function currentMonth(): string {
  return today().slice(0, 7);
}

/** First and last calendar day of a month, as YYYY-MM-DD. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '2026-10' -> 'October 2026' */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Past months are a record of what each month was measured against, so only
 * the current month and later can be changed.
 */
export function isEditableMonth(month: string, now = currentMonth()): boolean {
  return month >= now;
}

export function isBudgetCategory(id: string): boolean {
  return CATEGORIES.some((c) => c.id === id);
}

/* --------------------------------------------------------------------- SQL */

/**
 * The budget in effect for each category in @month: the latest row on or
 * before it. Tombstoned categories drop out here.
 */
export const BUDGETS_IN_EFFECT_SQL = `
  SELECT b.category, b.amount_cents, b.effective_from
    FROM budgets b
   WHERE b.group_id = @groupId
     AND b.effective_from = (SELECT MAX(b2.effective_from) FROM budgets b2
                              WHERE b2.group_id = b.group_id
                                AND b2.category = b.category
                                AND b2.effective_from <= @month)
     AND b.amount_cents IS NOT NULL
`;

/**
 * Spend per category between @start and @end inclusive, in group currency.
 *
 * Recurring postings count — rent is spending. Payment-plan interest does not:
 * it's posted as an expense so balances work, but it's the cost of a loan
 * between members, not something the group bought. Settlements live in their
 * own table and never appear here.
 */
export const SPEND_BY_CATEGORY_SQL = `
  SELECT e.category, SUM(e.amount_cents) AS spent_cents
    FROM expenses e
   WHERE e.group_id = @groupId
     AND date(e.spent_at) BETWEEN @start AND @end
     AND e.id NOT IN (SELECT interest_expense_id FROM plan_installments
                       WHERE interest_expense_id IS NOT NULL)
   GROUP BY e.category
`;

/* ------------------------------------------------------------------ status */

/** At or above this share of the budget a category is "near" its limit. */
export const NEAR_BP = 8_000;

export type BudgetStatus = 'under' | 'near' | 'over';

export type BudgetRow = { category: string; amount_cents: number; effective_from: string };
export type SpendRow = { category: string; spent_cents: number };

export type BudgetLine = {
  category: string;
  label: string;
  emoji: string;
  budget_cents: number;
  effective_from: string;
  spent_cents: number;
  /** Negative once over budget. */
  remaining_cents: number;
  /** Spent as basis points of the budget; null when the budget is zero. */
  percent_bp: number | null;
  status: BudgetStatus;
};

export type UnbudgetedLine = {
  category: string;
  label: string;
  emoji: string;
  spent_cents: number;
};

export type BudgetReport = {
  month: string;
  lines: BudgetLine[];
  unbudgeted: UnbudgetedLine[];
};

/**
 * Integers only, like the rest of the money code. Exactly 100% is still "near";
 * "over" means strictly more than the budget. A zero budget means "spend
 * nothing", so any spend at all is over.
 */
export function budgetStatus(
  budgetCents: number,
  spentCents: number
): { percent_bp: number | null; status: BudgetStatus } {
  if (budgetCents === 0) {
    return { percent_bp: null, status: spentCents > 0 ? 'over' : 'under' };
  }
  const percent_bp = Math.floor((spentCents * 10_000) / budgetCents);
  const status =
    spentCents > budgetCents
      ? 'over'
      : spentCents * 10_000 >= budgetCents * NEAR_BP
        ? 'near'
        : 'under';
  return { percent_bp, status };
}

/**
 * Combine budgets in effect with the month's spend. Spend under a category id
 * the app doesn't know is counted as General — the same place the ledger shows
 * it — so the card never disagrees with what the user sees.
 */
export function buildBudgetReport(
  month: string,
  budgets: BudgetRow[],
  spend: SpendRow[]
): BudgetReport {
  const spent = new Map<string, number>();
  for (const row of spend) {
    const id = categoryMeta(row.category).id;
    spent.set(id, (spent.get(id) ?? 0) + row.spent_cents);
  }

  const byCategory = new Map(budgets.map((b) => [b.category, b]));
  const lines: BudgetLine[] = [];
  const unbudgeted: UnbudgetedLine[] = [];

  for (const c of CATEGORIES) {
    const spentCents = spent.get(c.id) ?? 0;
    const budget = byCategory.get(c.id);

    if (budget) {
      lines.push({
        category: c.id,
        label: c.label,
        emoji: c.emoji,
        budget_cents: budget.amount_cents,
        effective_from: budget.effective_from,
        spent_cents: spentCents,
        remaining_cents: budget.amount_cents - spentCents,
        ...budgetStatus(budget.amount_cents, spentCents),
      });
    } else if (spentCents > 0) {
      unbudgeted.push({ category: c.id, label: c.label, emoji: c.emoji, spent_cents: spentCents });
    }
  }

  unbudgeted.sort((a, b) => b.spent_cents - a.spent_cents);
  return { month, lines, unbudgeted };
}
