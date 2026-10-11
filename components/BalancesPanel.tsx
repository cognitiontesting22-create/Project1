import { formatCents } from '@/lib/money';
import type { Balance, Debt, ExchangeRate, Member } from '@/lib/types';
import Avatar from './Avatar';
import SettleUpButton from './SettleUpButton';

export function BalancesCard({
  balances,
  currency,
  note,
}: {
  balances: Balance[];
  currency: string;
  /** Shown when the page is filtered, so these totals can't be misread. */
  note?: string;
}) {
  const maxAbs = Math.max(1, ...balances.map((b) => Math.abs(b.net_cents)));

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-semibold text-white">Balances</h3>
      <p className="mb-4 text-xs text-slate-500">
        Positive means the group owes them; negative means they owe the group.
      </p>
      {note && (
        <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-300/90">
          {note}
        </p>
      )}

      <ul className="space-y-3">
        {balances.map((b) => {
          const net = b.net_cents;
          const pct = (Math.abs(net) / maxAbs) * 100;
          const tone =
            net > 0 ? 'text-brand-400' : net < 0 ? 'text-rose-400' : 'text-slate-500';

          return (
            <li key={b.member_id}>
              <div className="flex items-center gap-3">
                <Avatar name={b.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{b.name}</span>
                <span className={`text-sm font-bold tabular-nums ${tone}`}>
                  {net === 0 ? 'settled' : `${net > 0 ? '+' : '−'}${formatCents(Math.abs(net), currency)}`}
                </span>
              </div>
              {/* Centre-anchored bar: credit grows right, debt grows left. */}
              <div className="mt-1.5 ml-10 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                <span className="flex w-1/2 justify-end">
                  {net < 0 && (
                    <span className="block rounded-full bg-rose-500/70" style={{ width: `${pct}%` }} />
                  )}
                </span>
                <span className="flex w-1/2 justify-start">
                  {net > 0 && (
                    <span className="block rounded-full bg-brand-500/70" style={{ width: `${pct}%` }} />
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SettleUpCard({
  debts,
  groupId,
  members,
  currency,
  rates,
}: {
  debts: Debt[];
  groupId: number;
  members: Member[];
  currency: string;
  rates: ExchangeRate[];
}) {
  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-white">Settle up</h3>
        {debts.length > 0 && (
          <span className="chip">
            {debts.length} payment{debts.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-500">
        The fewest transfers that clear every balance.
      </p>

      {debts.length === 0 ? (
        <div className="rounded-xl border border-brand-500/20 bg-brand-500/[0.07] px-4 py-6 text-center">
          <p className="text-2xl" aria-hidden>
            🎉
          </p>
          <p className="mt-1.5 text-sm font-semibold text-brand-300">Everyone&apos;s square</p>
          <p className="mt-0.5 text-xs text-slate-500">No payments needed right now.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {debts.map((d, i) => (
            <li
              key={`${d.from_member_id}-${d.to_member_id}-${i}`}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06]
                         bg-white/[0.02] p-3"
            >
              <Avatar name={d.from_name} size="sm" />
              <span className="text-slate-600" aria-hidden>
                →
              </span>
              <Avatar name={d.to_name} size="sm" />
              <span className="min-w-0 flex-1 px-1 text-xs text-slate-400">
                <span className="font-medium text-slate-200">{d.from_name}</span> pays{' '}
                <span className="font-medium text-slate-200">{d.to_name}</span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-white">
                {formatCents(d.amount_cents, currency)}
              </span>
              <SettleUpButton
                groupId={groupId}
                members={members}
                currency={currency}
                rates={rates}
                preset={{
                  fromMemberId: d.from_member_id,
                  toMemberId: d.to_member_id,
                  amountCents: d.amount_cents,
                }}
                label="Record"
                className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
