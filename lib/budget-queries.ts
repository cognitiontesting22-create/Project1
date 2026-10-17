import 'server-only';
import {
  BUDGETS_IN_EFFECT_SQL,
  SPEND_BY_CATEGORY_SQL,
  buildBudgetReport,
  monthRange,
  type BudgetReport,
  type BudgetRow,
  type SpendRow,
} from './budgets';
import { db } from './db';

export function getBudgetReport(groupId: number, month: string): BudgetReport {
  const budgets = db.prepare(BUDGETS_IN_EFFECT_SQL).all({ groupId, month }) as BudgetRow[];
  const spend = db
    .prepare(SPEND_BY_CATEGORY_SQL)
    .all({ groupId, ...monthRange(month) }) as SpendRow[];
  return buildBudgetReport(month, budgets, spend);
}

/**
 * Set a category's budget from `month` onward. A null amount removes it from
 * that month on. Rows already scheduled for later months are left alone, so
 * they still take over when their month arrives.
 */
export function setBudget(
  groupId: number,
  category: string,
  month: string,
  amountCents: number | null
): void {
  db.prepare(
    `INSERT INTO budgets (group_id, category, amount_cents, effective_from)
     VALUES (@groupId, @category, @amountCents, @month)
     ON CONFLICT (group_id, category, effective_from)
     DO UPDATE SET amount_cents = excluded.amount_cents`
  ).run({ groupId, category, month, amountCents });
}
