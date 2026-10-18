import { toBasisPoints, toCents } from './money';
import type { ExpenseInput } from './queries';
import { isSplitType, type Group } from './types';

/**
 * The fields an expense is made of, already parsed into the app's integer units
 * but not yet checked. The form and the JSON route both reduce their input to
 * this shape, so creating and editing share one set of checks and messages.
 */
export type ExpenseFields = {
  description: string;
  /** Minor units in `currency`. */
  amountCents: number;
  paidBy: number;
  splitType: string;
  participants: number[];
  /** Cents for exact, basis points for percent, centishares for shares. */
  values: Record<number, number>;
  category?: string;
  spentAt?: string;
  /** Defaults to the group's currency. */
  currency?: string;
};

export function expenseInputFrom(
  groupId: number,
  group: Group | undefined,
  fields: ExpenseFields
): { input: ExpenseInput } | { error: string } {
  const description = fields.description.trim();
  const { amountCents, paidBy, splitType } = fields;

  if (!description) return { error: 'What was this expense for?' };
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { error: 'Enter an amount above zero.' };
  if (!Number.isFinite(paidBy)) return { error: 'Pick who paid.' };
  if (!isSplitType(splitType)) return { error: 'Pick how to split this expense.' };
  if (!group) return { error: 'That group no longer exists.' };
  if (fields.participants.length === 0) {
    return { error: 'Select at least one person to split between.' };
  }

  return {
    input: {
      groupId,
      description,
      amountCents,
      paidBy,
      category: fields.category || 'general',
      splitType,
      spentAt: fields.spentAt || undefined,
      participants: fields.participants,
      // `equal` needs no per-person input at all.
      values: splitType === 'equal' ? {} : fields.values,
      currency: fields.currency || group.currency,
    },
  };
}

/** The Add/Edit expense form's fields, parsed the way the form has always sent them. */
export function expenseFieldsFromForm(formData: FormData): ExpenseFields {
  const splitType = String(formData.get('splitType') ?? 'equal');
  const participants = formData
    .getAll('participants')
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  // Each mode has its own integer unit: cents, basis points, or centishares.
  const values: Record<number, number> = {};
  if (isSplitType(splitType) && splitType !== 'equal') {
    const parse = splitType === 'exact' ? toCents : toBasisPoints;
    for (const id of participants) {
      values[id] = parse(String(formData.get(`value_${id}`) ?? ''));
    }
  }

  return {
    description: String(formData.get('description') ?? ''),
    amountCents: toCents(String(formData.get('amount') ?? '')),
    paidBy: Number(formData.get('paidBy')),
    splitType,
    participants,
    values,
    category: String(formData.get('category') ?? 'general'),
    spentAt: String(formData.get('spentAt') ?? ''),
    currency: String(formData.get('currency') ?? ''),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A whole number, or NaN so the shared checks reject it with their usual message. */
function int(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : NaN;
}

/**
 * The JSON body the expense routes take (POST and PUT alike): description,
 * amount, paid_by, spent_at, category, currency, split_type, participants and
 * values. Numbers are integers in the units the app stores: `amount` in minor
 * units of `currency`, `values` keyed by member id in cents (exact), basis
 * points (percent) or centishares (shares), ignored for equal. Shape problems
 * are reported here; everything else is left to the shared checks.
 */
export function expenseFieldsFromJson(body: unknown): { fields: ExpenseFields } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Send the expense as a JSON object.' };
  }
  const b = body as Record<string, unknown>;

  for (const key of ['description', 'spent_at', 'category', 'currency', 'split_type'] as const) {
    if (b[key] !== undefined && typeof b[key] !== 'string') return { error: `${key} must be a string.` };
  }
  if (typeof b.spent_at === 'string' && !ISO_DATE.test(b.spent_at)) {
    return { error: 'spent_at must be a date formatted YYYY-MM-DD.' };
  }
  if (b.participants !== undefined && !Array.isArray(b.participants)) {
    return { error: 'participants must be an array of member ids.' };
  }
  if (
    b.values !== undefined &&
    (typeof b.values !== 'object' || b.values === null || Array.isArray(b.values))
  ) {
    return { error: 'values must be an object keyed by member id.' };
  }

  const participants = ((b.participants as unknown[] | undefined) ?? []).map(int);
  if (participants.some((p) => Number.isNaN(p))) {
    return { error: 'participants must be an array of member ids.' };
  }
  const rawValues = (b.values as Record<string, unknown> | undefined) ?? {};
  const values: Record<number, number> = {};
  for (const p of participants) values[p] = int(rawValues[String(p)]);

  return {
    fields: {
      description: (b.description as string | undefined) ?? '',
      amountCents: int(b.amount),
      paidBy: int(b.paid_by),
      splitType: (b.split_type as string | undefined) ?? '',
      participants,
      values,
      category: b.category as string | undefined,
      spentAt: b.spent_at as string | undefined,
      currency: b.currency as string | undefined,
    },
  };
}

/** Reads and checks an expense request body against its group. */
export async function expenseInputFromRequest(
  request: Request,
  groupId: number,
  group: Group
): Promise<{ input: ExpenseInput } | { error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: 'Send the expense as a JSON object.' };
  }
  const parsed = expenseFieldsFromJson(body);
  if ('error' in parsed) return parsed;
  return expenseInputFrom(groupId, group, parsed.fields);
}
