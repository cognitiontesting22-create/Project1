import type { Balance, Debt } from './types';

/**
 * Above this many people with a non-zero balance we skip the subset search and
 * go straight to greedy. The search is O(2^n) in the worst case; 16 keeps it at
 * a few tens of thousands of integer ops, which is nothing, and real groups are
 * far smaller.
 */
const SUBSET_SEARCH_LIMIT = 16;

type Position = { id: number; name: string; amount: number };

/**
 * Greedy matching: biggest creditor against biggest debtor, repeatedly.
 * Always clears the set it's given in at most (size - 1) transfers.
 */
function greedy(positions: Position[]): Debt[] {
  const creditors = positions
    .filter((p) => p.amount > 0)
    .map((p) => ({ ...p }))
    .sort((a, b) => b.amount - a.amount || a.id - b.id);

  const debtors = positions
    .filter((p) => p.amount < 0)
    .map((p) => ({ ...p, amount: -p.amount }))
    .sort((a, b) => b.amount - a.amount || a.id - b.id);

  const debts: Debt[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0) {
      debts.push({
        from_member_id: debtor.id,
        from_name: debtor.name,
        to_member_id: creditor.id,
        to_name: creditor.name,
        amount_cents: amount,
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) ci++;
    if (debtor.amount === 0) di++;
  }

  return debts;
}

/**
 * Splits people into groups that each sum to zero, so no money has to cross
 * between groups. Settling a group of k people costs k-1 transfers, so more
 * groups means fewer payments overall.
 *
 * Works by repeatedly peeling off the *smallest* zero-sum subset containing the
 * first remaining person — that subset can't be split further, so taking it is
 * never a loss.
 */
function zeroSumPartitions(positions: Position[]): Position[][] {
  if (positions.length <= 2) return positions.length ? [positions] : [];

  const [head, ...rest] = positions;
  const n = rest.length;

  let best: number | null = null;
  let bestSize = Infinity;

  // Every subset of `rest`, as a bitmask. We want the fewest companions that
  // cancel `head` exactly.
  for (let mask = 1; mask < 1 << n; mask++) {
    let size = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) size++;
    if (size >= bestSize) continue;

    let sum = head.amount;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += rest[i].amount;

    if (sum === 0) {
      best = mask;
      bestSize = size;
      if (size === 1) break; // can't do better than a straight pair
    }
  }

  // The whole set sums to zero, so a cancelling subset always exists.
  if (best === null) return [positions];

  const group = [head];
  const remainder: Position[] = [];
  for (let i = 0; i < n; i++) {
    if (best & (1 << i)) group.push(rest[i]);
    else remainder.push(rest[i]);
  }

  return [group, ...zeroSumPartitions(remainder)];
}

/**
 * Turns net balances into a concrete list of "X pays Y" instructions that
 * leaves every single person at exactly zero.
 *
 * Minimising the number of transfers is NP-hard in general (it's partition),
 * so we do the tractable thing: isolate independent zero-sum groups, then run
 * greedy inside each. That beats plain greedy whenever balances cancel out —
 * e.g. +4, +2, -3, -2, -1 settles in 3 payments instead of 4.
 */
export function simplifyDebts(balances: Balance[]): Debt[] {
  const positions: Position[] = balances
    .filter((b) => b.net_cents !== 0)
    .map((b) => ({ id: b.member_id, name: b.name, amount: b.net_cents }));

  if (positions.length === 0) return [];

  // Balances are derived from splits that each reconcile exactly, so this
  // should always hold. If it somehow doesn't, greedy still clears what it can
  // rather than the partition search failing to find a cancelling subset.
  const net = positions.reduce((sum, p) => sum + p.amount, 0);

  const groups =
    net === 0 && positions.length <= SUBSET_SEARCH_LIMIT
      ? zeroSumPartitions(positions)
      : [positions];

  return groups
    .flatMap((group) => greedy(group))
    .sort((a, b) => b.amount_cents - a.amount_cents || a.from_member_id - b.from_member_id);
}

/** Total money that still needs to change hands in the group. */
export function outstandingCents(balances: Balance[]): number {
  return balances.reduce((sum, b) => sum + Math.max(0, b.net_cents), 0);
}
