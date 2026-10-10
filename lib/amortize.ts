import { splitEqually } from './money';

/**
 * Turns "I can't cover my share right now" into a concrete schedule.
 *
 * The twist that makes this work between friends rather than between a bank and
 * a customer: a plan can carry **grace periods** — the first N installments are
 * interest-free. Set the grace to cover the whole plan and it's a plain
 * interest-free instalment agreement; set it to zero and it amortises like a
 * normal loan. Most real agreements between friends sit somewhere in between:
 * "pay me back over six months, and I'll only start counting interest if it
 * runs past three."
 *
 * Interest is charged on the *declining balance*, in whole minor units, and the
 * final instalment absorbs whatever rounding is left so the principal lands on
 * exactly zero. The schedule's principal column always sums to the original
 * amount — never a unit more or less.
 */

export type Installment = {
  /** 1-based position in the schedule. */
  number: number;
  /** What the debtor hands over this period. */
  payment_cents: number;
  /** The part that reduces what they owe. */
  principal_cents: number;
  /** The part that is the cost of paying late — zero during grace. */
  interest_cents: number;
  /** Still outstanding after this instalment. */
  balance_cents: number;
  in_grace: boolean;
};

export const MAX_INSTALLMENTS = 60;
export const MAX_APR_BP = 5000; // 50%

/** Monthly interest on a balance, rounded to the nearest minor unit. */
function monthlyInterest(balanceCents: number, aprBp: number): number {
  // balance * (apr/10000) / 12 — all integer-safe at realistic magnitudes.
  return Math.round((balanceCents * aprBp) / 120_000);
}

export function buildSchedule({
  principalCents,
  aprBp,
  installments,
  gracePeriods = 0,
}: {
  principalCents: number;
  aprBp: number;
  installments: number;
  gracePeriods?: number;
}): Installment[] {
  if (!Number.isInteger(principalCents) || principalCents <= 0) {
    throw new Error('A plan needs an amount above zero.');
  }
  if (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS) {
    throw new Error(`Choose between 1 and ${MAX_INSTALLMENTS} instalments.`);
  }
  if (!Number.isInteger(aprBp) || aprBp < 0 || aprBp > MAX_APR_BP) {
    throw new Error(`Interest has to be between 0% and ${MAX_APR_BP / 100}%.`);
  }
  if (!Number.isInteger(gracePeriods) || gracePeriods < 0) {
    throw new Error('Grace periods can’t be negative.');
  }

  const grace = Math.min(gracePeriods, installments);

  // No interest anywhere: a straight even split, exact by construction.
  if (aprBp === 0 || grace >= installments) {
    const parts = splitEqually(principalCents, installments);
    let balance = principalCents;
    return parts.map((part, i) => {
      balance -= part;
      return {
        number: i + 1,
        payment_cents: part,
        principal_cents: part,
        interest_cents: 0,
        balance_cents: balance,
        in_grace: true,
      };
    });
  }

  const interestBearing = installments - grace;
  // apr/10000 gives the annual fraction, /12 the monthly one — the same basis
  // monthlyInterest() uses. Keep these two in step or payments stop being level.
  const monthlyRate = aprBp / 120_000;

  // During grace the debtor pays down principal only. Spread the grace
  // payments as an even slice of the whole plan so instalments stay level-ish.
  const gracePrincipal = grace > 0 ? splitEqually(principalCents, installments).slice(0, grace) : [];
  const graceTotal = gracePrincipal.reduce((a, b) => a + b, 0);
  const financed = principalCents - graceTotal;

  // Standard annuity payment, then corrected period by period with integers.
  const target = Math.round(
    (financed * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -interestBearing))
  );

  if (interestBearing > 1 && target <= monthlyInterest(financed, aprBp)) {
    throw new Error('That rate is too high to clear the balance in that many instalments.');
  }

  const schedule: Installment[] = [];
  let balance = principalCents;

  for (let i = 0; i < grace; i++) {
    const principal = Math.min(gracePrincipal[i], balance);
    balance -= principal;
    schedule.push({
      number: i + 1,
      payment_cents: principal,
      principal_cents: principal,
      interest_cents: 0,
      balance_cents: balance,
      in_grace: true,
    });
  }

  for (let i = 0; i < interestBearing; i++) {
    const interest = monthlyInterest(balance, aprBp);
    const isLast = i === interestBearing - 1;

    // The last instalment clears whatever is left, so rounding can't survive.
    let principal = isLast ? balance : Math.min(target - interest, balance);
    if (principal < 0) principal = 0;

    balance -= principal;
    schedule.push({
      number: grace + i + 1,
      payment_cents: principal + interest,
      principal_cents: principal,
      interest_cents: interest,
      balance_cents: balance,
      in_grace: false,
    });
  }

  // The invariant this whole module exists to guarantee.
  const principalPaid = schedule.reduce((sum, s) => sum + s.principal_cents, 0);
  if (principalPaid !== principalCents || balance !== 0) {
    throw new Error(
      `Schedule does not reconcile: ${principalPaid} of ${principalCents} with ${balance} left over.`
    );
  }

  return schedule;
}

export function scheduleTotals(schedule: Installment[]) {
  return {
    principal_cents: schedule.reduce((s, i) => s + i.principal_cents, 0),
    interest_cents: schedule.reduce((s, i) => s + i.interest_cents, 0),
    total_cents: schedule.reduce((s, i) => s + i.payment_cents, 0),
  };
}
