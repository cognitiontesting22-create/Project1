const PALETTE = [
  'from-emerald-400 to-teal-600',
  'from-violet-400 to-purple-600',
  'from-amber-400 to-orange-600',
  'from-sky-400 to-blue-600',
  'from-rose-400 to-pink-600',
  'from-lime-400 to-green-600',
  'from-fuchsia-400 to-indigo-600',
  'from-cyan-400 to-sky-600',
];

/** Stable per-name colour so the same person looks the same everywhere. */
function hashOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
};

export default function Avatar({
  name,
  size = 'md',
  className = '',
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const gradient = PALETTE[hashOf(name) % PALETTE.length];
  return (
    <span
      title={name}
      className={`inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br
                  ${gradient} ${SIZES[size]} font-bold text-ink-950
                  ring-2 ring-ink-900 ${className}`}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size="sm" className={i > 0 ? '-ml-2' : ''} />
      ))}
      {extra > 0 && (
        <span
          className="-ml-2 grid h-7 w-7 place-items-center rounded-full bg-ink-700
                     text-[10px] font-bold text-slate-300 ring-2 ring-ink-900"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
