'use client';

import { useState } from 'react';

/**
 * Server-rendered panels passed as children — switching tabs is purely client
 * state, so there's no round trip and no data refetch.
 */
export default function Tabs({
  tabs,
}: {
  tabs: { id: string; label: string; count?: number; panel: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-1 rounded-xl border border-white/[0.08] bg-ink-900/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2
                        text-sm font-semibold transition ${
                          active === t.id
                            ? 'bg-white/[0.09] text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  active === t.id ? 'bg-brand-500/20 text-brand-300' : 'bg-white/[0.06] text-slate-500'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="animate-fade-up">
        {current?.panel}
      </div>
    </div>
  );
}
