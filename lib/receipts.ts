import { splitByWeights, splitEqually } from './money';

/**
 * Itemised bill allocation.
 *
 * Each line item is divided between the people who actually had it. Tax and tip
 * are then spread in proportion to what each person's items came to — the
 * person who ordered the steak carries more of the tax than the person who had
 * soup.
 *
 * Rounding is handled by largest-remainder apportionment at *both* steps, so
 * the per-person totals add up to the bill exactly. Allocating tax by
 * multiplying each subtotal by a rate and rounding independently would leave
 * the shares a cent or two off the real total, and in this app that gap becomes
 * a balance that can never be settled.
 */

export type ReceiptItemInput = {
  /** Caller's identifier, echoed back on the shares. */
  id: number | string;
  description: string;
  amountCents: number;
  /** Everyone who had this item; its cost is divided equally between them. */
  memberIds: number[];
};

export type ReceiptInput = {
  items: ReceiptItemInput[];
  taxCents: number;
  tipCents: number;
};

export type ItemShare = {
  item_id: number | string;
  member_id: number;
  amount_cents: number;
};

export type MemberAllocation = {
  member_id: number;
  items_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
};

export type ReceiptAllocation = {
  itemShares: ItemShare[];
  members: MemberAllocation[];
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
};

function assertWholeNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  if (!Number.isInteger(value)) throw new Error(`${label} must be a whole number of cents.`);
  if (value < 0) throw new Error(`${label} can't be negative.`);
}

export function allocateReceipt(input: ReceiptInput): ReceiptAllocation {
  const { items, taxCents, tipCents } = input;

  if (items.length === 0) throw new Error('A receipt needs at least one item.');
  assertWholeNonNegative(taxCents, 'Tax');
  assertWholeNonNegative(tipCents, 'Tip');

  for (const item of items) {
    assertWholeNonNegative(item.amountCents, `"${item.description || 'Item'}"`);
    if (item.amountCents === 0) {
      throw new Error(`"${item.description || 'Item'}" needs an amount above zero.`);
    }
    if (item.memberIds.length === 0) {
      throw new Error(`Assign "${item.description || 'this item'}" to at least one person.`);
    }
    if (new Set(item.memberIds).size !== item.memberIds.length) {
      throw new Error(`"${item.description || 'This item'}" lists the same person twice.`);
    }
  }

  // Members appear in the order they are first encountered, so allocation is
  // deterministic for a given input rather than dependent on object key order.
  const order: number[] = [];
  for (const item of items) {
    for (const id of item.memberIds) if (!order.includes(id)) order.push(id);
  }

  const itemsByMember = new Map<number, number>(order.map((id) => [id, 0]));
  const itemShares: ItemShare[] = [];

  for (const item of items) {
    const parts = splitEqually(item.amountCents, item.memberIds.length);
    item.memberIds.forEach((memberId, i) => {
      itemShares.push({ item_id: item.id, member_id: memberId, amount_cents: parts[i] });
      itemsByMember.set(memberId, (itemsByMember.get(memberId) ?? 0) + parts[i]);
    });
  }

  const subtotals = order.map((id) => itemsByMember.get(id) ?? 0);
  const subtotalCents = subtotals.reduce((a, b) => a + b, 0);

  // Weighting by subtotal is what "in proportion to each person's items" means.
  const taxShares = splitByWeights(taxCents, subtotals);
  const tipShares = splitByWeights(tipCents, subtotals);

  const members: MemberAllocation[] = order.map((memberId, i) => ({
    member_id: memberId,
    items_cents: subtotals[i],
    tax_cents: taxShares[i],
    tip_cents: tipShares[i],
    total_cents: subtotals[i] + taxShares[i] + tipShares[i],
  }));

  const totalCents = subtotalCents + taxCents + tipCents;

  // The invariant this module exists to guarantee. Every allocation step above
  // is exact by construction; this catches any future change that breaks one.
  const allocated = members.reduce((sum, m) => sum + m.total_cents, 0);
  if (allocated !== totalCents) {
    throw new Error(
      `Receipt does not reconcile: shares total ${allocated} but the bill is ${totalCents}.`
    );
  }

  return {
    itemShares,
    members,
    subtotal_cents: subtotalCents,
    tax_cents: taxCents,
    tip_cents: tipCents,
    total_cents: totalCents,
  };
}

/** Items total plus tax and tip — what the expense's amount must equal. */
export function receiptTotal(input: ReceiptInput): number {
  return (
    input.items.reduce((sum, i) => sum + i.amountCents, 0) + input.taxCents + input.tipCents
  );
}

/** Tip as a percentage of the pre-tax subtotal, the usual convention. */
export function tipFromPercent(subtotalCents: number, percentBp: number): number {
  return Math.round((subtotalCents * percentBp) / 10_000);
}
