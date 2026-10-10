import Link from 'next/link';
import RatesEditor from '@/components/RatesEditor';
import { BASE_CURRENCY } from '@/lib/currency';
import { listRates } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default function RatesPage() {
  const rates = listRates();

  return (
    <div className="animate-fade-up space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="transition hover:text-slate-300">
          Groups
        </Link>
        <span className="px-2" aria-hidden>
          /
        </span>
        <span className="text-slate-300">Currencies</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Currencies</h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-slate-400">
          Every rate is quoted against {BASE_CURRENCY}, so any pair is derived from one table and
          two currencies can never disagree about a cross-rate.
        </p>
      </header>

      <RatesEditor rates={rates} />

      <section className="card space-y-3 p-5 text-sm leading-relaxed text-slate-400">
        <h2 className="font-semibold text-white">How conversion works</h2>
        <p>
          An expense is converted <span className="text-slate-200">once</span>, on its total, at the
          moment you save it — then that converted total is split between people. Converting each
          person&apos;s share separately would round several times over and leave the shares not
          quite adding up, and those stray cents would turn into balances that never settle.
        </p>
        <p>
          The converted amount is stored for good. Changing a rate here affects{' '}
          <span className="text-slate-200">new entries only</span> — past expenses keep the rate
          they were booked at, so nobody&apos;s balance moves overnight because a currency did.
        </p>
      </section>
    </div>
  );
}
