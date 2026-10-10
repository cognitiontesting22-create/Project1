import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card grid place-items-center gap-4 px-6 py-24 text-center">
      <span className="text-4xl" aria-hidden>
        🧭
      </span>
      <div>
        <h1 className="text-xl font-bold text-white">We couldn&apos;t find that</h1>
        <p className="mt-1 text-sm text-slate-500">
          The group may have been deleted, or the link is wrong.
        </p>
      </div>
      <Link href="/" className="btn-primary">
        Back to your groups
      </Link>
    </div>
  );
}
