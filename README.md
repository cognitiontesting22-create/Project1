# Tally — group expense splitter

A Next.js + SQLite app for splitting shared costs. Log who paid for what, and Tally
works out who owes whom and the fewest payments needed to square up.

## Getting started

```bash
npm install
npm run seed     # optional — loads three demo groups
npm run dev      # http://localhost:3000
```

The SQLite file is created and migrated automatically at `data/splitter.db` on
first run (override with `DATABASE_PATH`). It's gitignored.

## What's here

- **Groups** — name, icon, description, currency, and a roster of people.
- **Expenses** — who paid, how much, category, date, and four split modes:
  - `equal` — everyone selected pays the same share
  - `exact` — type each person's amount; must add up to the total
  - `percent` — type each person's percentage; must add up to exactly 100%
  - `shares` — weighted (e.g. 2 shares for a couple, 1 each for everyone else)
- **Multi-currency** — enter an expense in any currency in the rate table; it's
  converted into the group's currency when you save it.
- **Balances** — each person's net position across all expenses and payments.
- **Settle up** — simplified into the fewest transfers, each recordable in a click.
- **Recurring expenses** — rent and bills that post themselves on the same day
  each month, falling back to the last day in short months.
- **Payment plans** — when someone can't settle in one go, spread a debt over
  months with optional interest and interest-free grace periods.

## Layout

```
app/
  page.tsx              group list + hero
  groups/[id]/page.tsx  group detail
  rates/page.tsx        currency rate table
  actions.ts            all server actions (validation lives at this boundary)
components/             Avatar, Modal, Tabs, forms, lists, panels
lib/
  db.ts                 connection, pragmas, migration runner
  migrate.mjs           applies migrations/*.sql, tracked by `user_version`
  migrations/*.sql      append-only schema history
  queries.ts            SQL reads/writes + computeSplits (server-only)
  scheduling-queries.ts recurring expenses, payment plans, catch-up posting
  money.ts              cents/basis-point parsing, formatting, split math
  currency.ts           exact conversion between currencies
  balances.ts           debt simplification
  amortize.ts           instalment schedules
  schedule.ts           the month-anchor calendar rule
  dates.ts, types.ts
scripts/seed.mjs        demo data
```

## Design notes

**Money is integer minor units, everywhere.** Floats only appear when parsing
input and formatting output. Splits use largest-remainder apportionment, so
leftover units are handed out one at a time and always sum to the exact total —
`$213.50` across four people becomes `53.38 / 53.38 / 53.37 / 53.37`.

**Percentages are integers too**, stored as basis points (`10000` = 100.00%).
Floats cannot answer "do these add up to 100?" — `33.33 + 33.33 + 33.34` is
`100.00000000000001` — but integers can, exactly.

**Nothing that doesn't reconcile is ever written.** `computeSplits` validates
each mode against the amount the user typed and then re-checks the allocated
total before returning. A split that doesn't add up raises an error naming the
exact shortfall; it is never silently rounded, clamped, or absorbed.

**Balances are computed, not stored.** One SQL query derives each person's net
from expenses paid, shares owed, and settlements. Nothing can drift out of sync.

**Conversion happens once, on the total.** An expense in yen is converted to the
group's currency as a single integer, and *that* integer is split. Converting
each person's share separately would round N times and leave the shares not
quite adding up — those stray units would become balances that never settle.
Conversion uses BigInt, because `amount × rate` leaves the 2^53 safe-integer
range at realistic amounts. The converted figure is stored permanently, so
editing a rate affects new entries only and never moves a settled balance.

**Debt simplification** isolates independent zero-sum groups before running
greedy matching inside each. Minimising transfers is NP-hard in general, but
this beats plain greedy whenever balances cancel: `+4, +2, −3, −2, −1` settles
in 3 payments instead of 4. It never exceeds the `n − 1` bound.

**Schedules keep their anchor day.** A recurrence on the 31st posts Jan 31,
Feb 28, Mar 31, Apr 30 — short months clamp, but the anchor doesn't drift, which
is the bug you get from repeatedly adding a month to the previous occurrence.

**Due items are materialised on page load**, not by a cron, so a laptop that was
closed for two months catches up when you open the group. That makes idempotency
essential rather than optional: it's enforced by a unique index on
`(recurring_id, period)` and by claiming each instalment row inside a
transaction, so concurrent requests cannot double-post.

**Payment plans reduce to existing primitives.** Each instalment posts a
settlement for the payment plus, when interest is due, an expense paid by the
creditor and split onto the debtor. The net effect is exactly the principal
portion, so the balance query doesn't need to know plans exist and the zero-sum
invariant holds for free. Interest is charged on the declining balance and the
final instalment absorbs the rounding, so principal lands on exactly zero.
