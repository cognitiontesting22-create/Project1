import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteGroupAction } from '@/app/actions';
import AddExpenseButton from '@/components/AddExpenseButton';
import { AvatarStack } from '@/components/Avatar';
import { BalancesCard, SettleUpCard } from '@/components/BalancesPanel';
import ExpenseList from '@/components/ExpenseList';
import MembersPanel from '@/components/MembersPanel';
import PlansPanel from '@/components/PlansPanel';
import RecurringPanel from '@/components/RecurringPanel';
import SettlementList from '@/components/SettlementList';
import SettleUpButton from '@/components/SettleUpButton';
import Tabs from '@/components/Tabs';
import { outstandingCents, simplifyDebts } from '@/lib/balances';
import { formatCents } from '@/lib/money';
import {
  getBalances,
  getCategoryTotals,
  getGroup,
  listExpenses,
  listMembers,
  listRates,
  listSettlements,
} from '@/lib/queries';
import { listPlans, listRecurring, postDueItems } from '@/lib/scheduling-queries';
import { categoryMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) notFound();

  const group = getGroup(groupId);
  if (!group) notFound();

  // Materialise anything that came due while nobody was looking — recurring
  // expenses and plan instalments — before reading the ledger back.
  postDueItems(groupId);

  const members = listMembers(groupId);
  const expenses = listExpenses(groupId);
  const settlements = listSettlements(groupId);
  const balances = getBalances(groupId);
  const debts = simplifyDebts(balances);
  const categories = getCategoryTotals(groupId);
  const rates = listRates();
  const recurring = listRecurring(groupId);
  const plans = listPlans(groupId);

  const totalSpent = expenses.reduce((sum, e) => sum + e.amount_cents, 0);
  const outstanding = outstandingCents(balances);
  const topCategory = categories[0];

  return (
    <div className="animate-fade-up space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="transition hover:text-slate-300">
          Groups
        </Link>
        <span className="px-2" aria-hidden>
          /
        </span>
        <span className="text-slate-300">{group.name}</span>
      </nav>

      <header className="card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/[0.05] text-3xl">
              {group.emoji}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {group.name}
              </h1>
              {group.description && (
                <p className="mt-1 text-sm text-slate-400">{group.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <AvatarStack names={members.map((m) => m.name)} max={6} />
                <span className="chip">{group.currency}</span>
                {topCategory && (
                  <span className="chip">
                    {categoryMeta(topCategory.category).emoji} mostly{' '}
                    {categoryMeta(topCategory.category).label.toLowerCase()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {members.length > 0 && (
              <>
                <AddExpenseButton
                  groupId={groupId}
                  members={members}
                  currency={group.currency}
                  rates={rates}
                />
                {members.length > 1 && (
                  <SettleUpButton
                    groupId={groupId}
                    members={members}
                    currency={group.currency}
                    rates={rates}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {members.length === 0 ? (
        <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
          <span className="text-3xl" aria-hidden>
            👥
          </span>
          <div>
            <p className="font-semibold text-white">Add people to get started</p>
            <p className="mt-1 text-sm text-slate-500">
              A group needs at least one person before you can log expenses.
            </p>
          </div>
          <div className="w-full max-w-xs">
            <MembersPanel groupId={groupId} members={members} balances={balances} />
          </div>
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="Total spent" value={formatCents(totalSpent, group.currency)} />
            <Stat
              label="Still owed"
              value={formatCents(outstanding, group.currency)}
              tone={outstanding > 0 ? 'warn' : 'good'}
            />
            <Stat
              label="Expenses"
              value={String(expenses.length)}
              sub={`${settlements.length} payment${settlements.length === 1 ? '' : 's'} logged`}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <section>
              <Tabs
                tabs={[
                  {
                    id: 'expenses',
                    label: 'Expenses',
                    count: expenses.length,
                    panel: (
                      <ExpenseList
                        expenses={expenses}
                        currency={group.currency}
                        groupId={groupId}
                      />
                    ),
                  },
                  {
                    id: 'payments',
                    label: 'Payments',
                    count: settlements.length,
                    panel: (
                      <SettlementList
                        settlements={settlements}
                        currency={group.currency}
                        groupId={groupId}
                      />
                    ),
                  },
                ]}
              />
            </section>

            <aside className="space-y-4">
              <SettleUpCard
                debts={debts}
                groupId={groupId}
                members={members}
                currency={group.currency}
                rates={rates}
              />
              <BalancesCard balances={balances} currency={group.currency} />

              <RecurringPanel
                groupId={groupId}
                members={members}
                currency={group.currency}
                rates={rates}
                recurring={recurring}
              />

              {members.length > 1 && (
                <PlansPanel
                  groupId={groupId}
                  members={members}
                  currency={group.currency}
                  plans={plans}
                  debts={debts}
                />
              )}

              <MembersPanel groupId={groupId} members={members} balances={balances} />

              {categories.length > 0 && (
                <div className="card p-5">
                  <h3 className="mb-4 font-semibold text-white">Where it went</h3>
                  <ul className="space-y-2.5">
                    {categories.map((c) => {
                      const meta = categoryMeta(c.category);
                      const pct = totalSpent > 0 ? (c.total_cents / totalSpent) * 100 : 0;
                      return (
                        <li key={c.category}>
                          <div className="flex items-center gap-2 text-sm">
                            <span aria-hidden>{meta.emoji}</span>
                            <span className="flex-1 truncate text-slate-300">{meta.label}</span>
                            <span className="tabular-nums text-slate-400">
                              {formatCents(c.total_cents, group.currency)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-grape-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <form action={deleteGroupAction} className="pt-2">
                <input type="hidden" name="groupId" value={groupId} />
                <button type="submit" className="btn-danger w-full text-xs">
                  Delete this group
                </button>
              </form>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'warn';
}) {
  const color =
    tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-brand-400' : 'text-white';
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
