/**
 * SQLite stores timestamps as 'YYYY-MM-DD' (from a date input) or
 * 'YYYY-MM-DD HH:MM:SS' (from datetime('now'), which is UTC). We only ever
 * display the calendar date, so parse the parts directly instead of letting
 * `new Date(string)` shift it across a timezone boundary.
 */
function parts(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(value: string): string {
  const p = parts(value);
  if (!p) return value;
  const thisYear = new Date().getFullYear();
  const suffix = p.y === thisYear ? '' : ` ${p.y}`;
  return `${MONTHS[p.m - 1]} ${p.d}${suffix}`;
}

/** Groups a sorted list into "Today" / "Yesterday" / month buckets. */
export function dateBucket(value: string): string {
  const p = parts(value);
  if (!p) return 'Earlier';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const then = new Date(p.y, p.m - 1, p.d);
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return `${MONTHS[p.m - 1]} ${p.y}`;
}
