import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '@/shared/ui';

/** KPI tile: a number with a label; the whole tile opens the filtered list behind it. */
export function Kpi({ to, label, value, tone = 'slate', hint }: { to: string; label: string; value: ReactNode; tone?: 'slate' | 'red' | 'amber' | 'green' | 'blue'; hint?: string }) {
  const tones = { slate: 'text-slate-900', red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700', blue: 'text-sky-700' };
  return (
    <Link to={to} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-500">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold tabular', tones[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </Link>
  );
}

/** Horizontal bars for a small breakdown; each row may link to a filtered list. */
export function Bars({ items, linkFor }: { items: { key: string; count: number; to?: string }[]; linkFor?: (k: { key: string }) => string | undefined }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-1.5">
      {items.map((i) => {
        const to = i.to ?? linkFor?.(i);
        const row = (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-32 truncate text-slate-700">{i.key}</span>
            <span className="h-2 flex-1 rounded bg-slate-100">
              <span className="block h-2 rounded bg-brand-500" style={{ width: `${(i.count / max) * 100}%` }} />
            </span>
            <span className="w-8 text-end text-xs tabular text-slate-600">{i.count}</span>
          </div>
        );
        return (
          <li key={i.key}>
            {to ? (
              <Link to={to} className="block rounded px-1 hover:bg-slate-50">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
