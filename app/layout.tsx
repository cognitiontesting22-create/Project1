import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tally — split expenses with your people',
  description: 'A fast, modern group expense splitter. Track who paid, who owes, and settle up.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 sm:px-8">
          <header className="flex items-center justify-between py-6">
            <Link href="/" className="group flex items-center gap-3">
              <span
                className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br
                           from-brand-400 to-grape-600 text-lg shadow-lg shadow-brand-600/20
                           transition group-hover:scale-105"
              >
                ⚖️
              </span>
              <span>
                <span className="block text-lg font-bold leading-tight tracking-tight text-white">
                  Tally
                </span>
                <span className="block text-xs text-slate-500">split it fairly</span>
              </span>
            </Link>
            <nav className="flex items-center gap-2">
              <Link href="/" className="btn-ghost">
                Groups
              </Link>
              <Link href="/people" className="btn-ghost">
                People
              </Link>
              <Link href="/rates" className="btn-ghost">
                Currencies
              </Link>
            </nav>
          </header>

          <main className="flex-1 pb-20">{children}</main>

          <footer className="border-t border-white/[0.06] py-6 text-center text-xs text-slate-600">
            Tally · Next.js + SQLite · all amounts stored in integer cents
          </footer>
        </div>
      </body>
    </html>
  );
}
