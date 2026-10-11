/**
 * Cross-group rollup for one person.
 *
 * Deliberately holds no database handle: the SQL is an exported string and the
 * aggregation is a pure function, so both can be exercised against a throwaway
 * database in tests without dragging in the app's singleton connection.
 */

export type PersonPosition = {
  group_id: number;
  group_name: string;
  emoji: string;
  currency: string;
  member_id: number;
  member_name: string;
  net_cents: number;
};

export type CurrencyRollup = {
  currency: string;
  owed_cents: number;
  owes_cents: number;
  net_cents: number;
  group_count: number;
};

export type PersonSummary = {
  positions: PersonPosition[];
  byCurrency: CurrencyRollup[];
  /** True when more than one currency is involved and totals can't simply add. */
  mixedCurrency: boolean;
};

/**
 * One row per group this person belongs to, with their net position in that
 * group's own currency. Same arithmetic as getBalances: what they fronted,
 * minus their share, plus cash handed over, minus cash received.
 */
export const PERSON_POSITIONS_SQL = `
  SELECT g.id            AS group_id,
         g.name          AS group_name,
         g.emoji         AS emoji,
         g.currency      AS currency,
         m.id            AS member_id,
         m.name          AS member_name,
         COALESCE(paid.total, 0) - COALESCE(owed.total, 0)
           + COALESCE(sent.total, 0) - COALESCE(recv.total, 0) AS net_cents
    FROM members m
    JOIN groups g ON g.id = m.group_id
    LEFT JOIN (SELECT paid_by AS mid, SUM(amount_cents) AS total
                 FROM expenses GROUP BY paid_by) paid ON paid.mid = m.id
    LEFT JOIN (SELECT s.member_id AS mid, SUM(s.amount_cents) AS total
                 FROM expense_splits s GROUP BY s.member_id) owed ON owed.mid = m.id
    LEFT JOIN (SELECT from_member_id AS mid, SUM(amount_cents) AS total
                 FROM settlements GROUP BY from_member_id) sent ON sent.mid = m.id
    LEFT JOIN (SELECT to_member_id AS mid, SUM(amount_cents) AS total
                 FROM settlements GROUP BY to_member_id) recv ON recv.mid = m.id
   WHERE m.person_id = @personId
   ORDER BY g.name, g.id
`;

/**
 * Totals per currency, never across them. Groups in different currencies are
 * genuinely different units — adding them silently would be the one place in
 * this app where a displayed figure isn't exact.
 */
export function rollupByCurrency(positions: PersonPosition[]): CurrencyRollup[] {
  const map = new Map<string, CurrencyRollup>();

  for (const p of positions) {
    const entry =
      map.get(p.currency) ??
      { currency: p.currency, owed_cents: 0, owes_cents: 0, net_cents: 0, group_count: 0 };

    if (p.net_cents > 0) entry.owed_cents += p.net_cents;
    if (p.net_cents < 0) entry.owes_cents += -p.net_cents;
    entry.net_cents += p.net_cents;
    entry.group_count += 1;

    map.set(p.currency, entry);
  }

  return [...map.values()].sort(
    (a, b) => b.owed_cents + b.owes_cents - (a.owed_cents + a.owes_cents) ||
      a.currency.localeCompare(b.currency)
  );
}

export function summarise(positions: PersonPosition[]): PersonSummary {
  const byCurrency = rollupByCurrency(positions);
  return { positions, byCurrency, mixedCurrency: byCurrency.length > 1 };
}

/**
 * A single headline figure across currencies, converted at *today's* rates.
 *
 * Every other number in this app is locked to the rate it was booked at; this
 * one can't be, because it spans groups that were never converted to a common
 * unit. Callers must label it as indicative — hence the deliberately awkward
 * name.
 */
export function indicativeTotal(
  positions: PersonPosition[],
  convert: (amountCents: number, fromCurrency: string) => number
): { owed_cents: number; owes_cents: number; net_cents: number } {
  let owed = 0;
  let owes = 0;

  for (const p of positions) {
    const converted = convert(p.net_cents, p.currency);
    if (converted > 0) owed += converted;
    if (converted < 0) owes += -converted;
  }

  return { owed_cents: owed, owes_cents: owes, net_cents: owed - owes };
}

/** Normalised form used when suggesting that two member rows are one person. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
