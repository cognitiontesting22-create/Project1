/**
 * Drops in a few realistic groups so the UI has something to show, covering
 * every split mode and a couple of foreign-currency expenses.
 * Run with `npm run seed`. Safe to re-run — it clears seeded rows first.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR, runMigrations } from '../lib/migrate.mjs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = process.env.DATABASE_PATH ?? path.join(DATA_DIR, 'splitter.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
runMigrations(db, MIGRATIONS_DIR(process.cwd()));

/** Largest-remainder apportionment, mirroring lib/money.ts. */
function splitByWeights(total, weights) {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / weightSum);
  const result = exact.map((v) => Math.floor(v));
  let remainder = total - result.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; remainder > 0; k++, remainder--) result[order[k % order.length].i] += 1;
  return result;
}

/** Mirrors lib/currency.ts — convert once, on the total. */
const RATE_SCALE = 100_000_000n;
const rateOf = (code) =>
  BigInt(db.prepare('SELECT rate_e8 FROM exchange_rates WHERE currency = ?').get(code).rate_e8);

function convert(amount, from, to) {
  const a = rateOf(from);
  const b = rateOf(to);
  if (a === b) return { amount, rate_e8: Number(RATE_SCALE) };
  const num = BigInt(amount) * b;
  const q = num / a;
  const converted = Number((num % a) * 2n >= a ? q + 1n : q);
  const rateNum = b * RATE_SCALE;
  const rq = rateNum / a;
  return {
    amount: converted,
    rate_e8: Number((rateNum % a) * 2n >= a ? rq + 1n : rq),
  };
}

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86_400_000);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// [description, amount, payerIdx, category, daysAgo, splitType, values?, currency?]
const SEEDS = [
  {
    name: 'Tahoe Ski Trip',
    description: 'Long weekend, Feb 2026',
    emoji: '🎿',
    currency: 'USD',
    members: ['Alex Rivera', 'Sam Chen', 'Jordan Blake', 'Priya Nair'],
    expenses: [
      ['Cabin rental', 128000, 0, 'rent', 7, 'equal'],
      ['Lift tickets', 64800, 1, 'fun', 6, 'equal'],
      // Only three of them ski; Priya sat this one out.
      ['Ski rentals', 36000, 1, 'fun', 6, 'exact', [12000, 12000, 12000, 0]],
      ['Groceries run', 21350, 2, 'food', 5, 'equal'],
      ['Gas + tolls', 8640, 0, 'transport', 4, 'equal'],
      ['Ramen in Truckee', 12720, 3, 'food', 2, 'equal'],
    ],
    settlements: [[1, 0, 20000, 'Venmo', 'USD']],
  },
  {
    name: 'Apartment 4B',
    description: 'Shared household costs',
    emoji: '🏠',
    currency: 'USD',
    members: ['Taylor Ruiz', 'Morgan Lee', 'Casey Okafor'],
    expenses: [
      // Casey has the big room, so rent is weighted rather than even.
      ['February rent', 420000, 0, 'rent', 12, 'percent', [3000, 3000, 4000]],
      ['Internet', 8999, 1, 'rent', 10, 'equal'],
      ['Costco haul', 18744, 2, 'shopping', 8, 'equal'],
      ['Electric bill', 13420, 0, 'rent', 4, 'percent', [3000, 3000, 4000]],
      ['Pizza night', 6850, 1, 'food', 1, 'equal'],
    ],
    settlements: [
      [1, 0, 130000, 'rent share', 'USD'],
      [2, 0, 170000, 'rent share', 'USD'],
    ],
  },
  {
    name: 'Tokyo & Kyoto',
    description: 'Two weeks, mixed currencies',
    emoji: '✈️',
    currency: 'USD',
    members: ['Devin Park', 'Rowan Hale', 'Mina Osei'],
    expenses: [
      // Booked at home in USD…
      ['Flights', 284400, 0, 'travel', 30, 'equal'],
      // …everything else paid on the ground in yen.
      ['Ryokan, 3 nights', 13200000, 1, 'travel', 9, 'equal', null, 'JPY'],
      ['JR Rail passes', 15000000, 0, 'transport', 8, 'equal', null, 'JPY'],
      // Mina doesn't drink, so the izakaya bill is split by shares.
      ['Izakaya night', 2184000, 2, 'food', 6, 'shares', [200, 200, 100], 'JPY'],
      ['Kyoto guesthouse', 7800000, 2, 'travel', 4, 'equal', null, 'JPY'],
      ['Airport espresso', 950, 1, 'food', 1, 'equal', null, 'EUR'],
    ],
    settlements: [[0, 1, 5000000, 'PayPay', 'JPY']],
  },
];

const seed = db.transaction(() => {
  for (const s of SEEDS) {
    // Re-running should refresh the demo data, not pile up duplicates.
    for (const row of db.prepare('SELECT id FROM groups WHERE name = ?').all(s.name)) {
      db.prepare('DELETE FROM groups WHERE id = ?').run(row.id);
    }

    const groupId = Number(
      db
        .prepare('INSERT INTO groups (name, description, emoji, currency) VALUES (?, ?, ?, ?)')
        .run(s.name, s.description, s.emoji, s.currency).lastInsertRowid
    );

    const memberIds = s.members.map((name) =>
      Number(
        db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)').run(groupId, name)
          .lastInsertRowid
      )
    );

    for (const [desc, amount, payer, category, ago, splitType, values, currency] of s.expenses) {
      const entry = currency ?? s.currency;
      const booked = convert(amount, entry, s.currency);

      const expenseId = Number(
        db
          .prepare(
            `INSERT INTO expenses
               (group_id, description, amount_cents, paid_by, category, split_type, spent_at,
                original_amount_cents, original_currency, rate_e8)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            groupId, desc, booked.amount, memberIds[payer], category, splitType, daysAgo(ago),
            amount, entry, booked.rate_e8
          ).lastInsertRowid
      );

      // Weights come from the typed values; equal is just an all-ones weighting.
      const weights = values ?? memberIds.map(() => 1);
      const amounts = splitByWeights(booked.amount, weights);
      const stored = splitType === 'percent' || splitType === 'shares' ? values : null;

      for (let i = 0; i < memberIds.length; i++) {
        db.prepare(
          'INSERT INTO expense_splits (expense_id, member_id, amount_cents, weight) VALUES (?, ?, ?, ?)'
        ).run(expenseId, memberIds[i], amounts[i], stored ? stored[i] : null);
      }
    }

    for (const [fromIdx, toIdx, amount, note, currency] of s.settlements ?? []) {
      const booked = convert(amount, currency ?? s.currency, s.currency);
      db.prepare(
        `INSERT INTO settlements
           (group_id, from_member_id, to_member_id, amount_cents, note, settled_at,
            original_amount_cents, original_currency, rate_e8)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        groupId, memberIds[fromIdx], memberIds[toIdx], booked.amount, note, daysAgo(1),
        amount, currency ?? s.currency, booked.rate_e8
      );
    }

    console.log(
      `seeded ${s.emoji} ${s.name} — ${s.members.length} people, ${s.expenses.length} expenses`
    );
  }
});

seed();

/* ---------------------------------------------------------------------------
 * A recurring rent charge and a payment plan, both backdated so the app's
 * catch-up posting has real work to do the first time you open the group.
 * ------------------------------------------------------------------------- */
const extras = db.transaction(() => {
  const flat = db.prepare("SELECT id FROM groups WHERE name = 'Apartment 4B'").get();
  if (!flat) return;
  const people = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id').all(flat.id);
  const [taylor, morgan, casey] = people.map((p) => p.id);

  // Rent on the 31st: February will clamp to the 28th without losing the anchor.
  const back = new Date(Date.now() - 100 * 86_400_000);
  const startDate = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, '0')}-01`;

  const recurringId = Number(
    db
      .prepare(
        `INSERT INTO recurring_expenses
           (group_id, description, amount_cents, currency, paid_by, category,
            split_type, anchor_day, interval_months, start_date)
         VALUES (?, 'Rent', 420000, 'USD', ?, 'rent', 'equal', 31, 1, ?)`
      )
      .run(flat.id, taylor, startDate).lastInsertRowid
  );
  for (const id of [taylor, morgan, casey]) {
    db.prepare(
      'INSERT INTO recurring_participants (recurring_id, member_id, value) VALUES (?, ?, NULL)'
    ).run(recurringId, id);
  }

  // Casey covers a deposit over 6 months: two interest-free, then 12% APR.
  const planStart = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, '0')}-15`;
  const planId = Number(
    db
      .prepare(
        `INSERT INTO payment_plans
           (group_id, debtor_id, creditor_id, principal_cents, apr_bp,
            installments, grace_periods, anchor_day, start_date, note)
         VALUES (?, ?, ?, 120000, 1200, 6, 2, 15, ?, 'Half the deposit')`
      )
      .run(flat.id, casey, taylor, planStart).lastInsertRowid
  );

  // Mirror of lib/amortize.ts: declining-balance interest, last instalment
  // absorbs the rounding so principal lands on exactly zero.
  const principal = 120000, aprBp = 1200, n = 6, grace = 2;
  const even = splitByWeights(principal, Array.from({ length: n }, () => 1));
  const graceParts = even.slice(0, grace);
  const financed = principal - graceParts.reduce((a, b) => a + b, 0);
  const monthlyRate = aprBp / 120000;
  const target = Math.round((financed * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -(n - grace))));

  let balance = principal;
  const start = new Date(`${planStart}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    const inGrace = i < grace;
    const interest = inGrace ? 0 : Math.round((balance * aprBp) / 120000);
    const isLast = i === n - 1;
    const principalPart = inGrace
      ? Math.min(graceParts[i], balance)
      : isLast
        ? balance
        : Math.min(target - interest, balance);
    balance -= principalPart;

    const monthsOut = start.getUTCMonth() + i;
    const year = start.getUTCFullYear() + Math.floor(monthsOut / 12);
    const month = (monthsOut % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const due = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(15, lastDay)).padStart(2, '0')}`;

    db.prepare(
      `INSERT INTO plan_installments
         (plan_id, number, due_date, period, payment_cents, principal_cents,
          interest_cents, balance_cents, in_grace)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(planId, i + 1, due, `${year}-${String(month).padStart(2, '0')}`,
      principalPart + interest, principalPart, interest, balance, inGrace ? 1 : 0);
  }
  if (balance !== 0) throw new Error(`seeded plan left ${balance} outstanding`);

  console.log('seeded 🔁 recurring rent + 💳 a 6-month payment plan in Apartment 4B');
  console.log('   (open the group and the overdue months post themselves)');
});
extras();

// The whole point of the integer discipline: every group must net to zero.
for (const g of db.prepare('SELECT id, name, currency FROM groups').all()) {
  const { net } = db
    .prepare(
      `SELECT COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE group_id = @g), 0)
            - COALESCE((SELECT SUM(s.amount_cents) FROM expense_splits s
                        JOIN expenses e ON e.id = s.expense_id
                       WHERE e.group_id = @g), 0) AS net`
    )
    .get({ g: g.id });
  if (net !== 0) throw new Error(`${g.name}: splits are off by ${net} minor units`);
}
console.log('\nverified: every expense reconciles exactly with its splits');

db.close();
console.log('Run `npm run dev` and open http://localhost:3000');
