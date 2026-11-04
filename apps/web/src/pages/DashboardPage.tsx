import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, CalendarDays, ClipboardList } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, type Paged } from '@/lib/api';
import { Alert, Card, PageHeader } from '@/shared/ui';

/** Employee dashboard shell [EP §4]. Phase 1 fills profile, contract, requests, tickets, reports, news. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { formatDate } = usePrefs();
  const tasks = useQuery({
    queryKey: ['tasks', 'mine-open'],
    queryFn: () => get<Paged<unknown>>('/tasks?mine=true&limit=1'),
    enabled: can('tasks', 'view'),
  });
  const notif = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => get<{ unread: number }>('/notifications?limit=1'),
  });
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
  const events = useQuery({
    queryKey: ['calendar', 'week'],
    queryFn: () =>
      get<{ items: { _id: string; title: string; startAt: string }[] }>(
        `/calendar/events?from=${now.toISOString()}&to=${weekEnd.toISOString()}`,
      ),
    enabled: can('calendar', 'view'),
  });

  const stat = (to: string, icon: typeof Bell, label: string, value: number | string | undefined) => {
    const Icon = icon;
    return (
      <Link
        to={to}
        className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-500"
      >
        <div className="flex size-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon className="size-5" aria-hidden />
        </div>
        <div>
          <div className="text-2xl font-bold tabular">{value ?? '—'}</div>
          <div className="text-sm text-slate-600">{label}</div>
        </div>
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user?.displayNameAr })}
        subtitle={`${t('dashboard.today')}: ${formatDate(now, { dateStyle: 'full' })}`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {stat('/tasks', ClipboardList, t('dashboard.openTasks'), tasks.data?.total)}
        {stat('/notifications', Bell, t('dashboard.unread'), notif.data?.unread)}
        {stat('/calendar', CalendarDays, t('dashboard.upcoming'), events.data?.items.length)}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title={t('dashboard.upcoming')}>
          {events.data?.items.length ? (
            <ul className="divide-y divide-slate-100">
              {events.data.items.slice(0, 6).map((e) => (
                <li key={e._id} className="flex items-center justify-between py-2 text-sm">
                  <span>{e.title}</span>
                  <span className="text-slate-500 tabular">
                    {formatDate(e.startAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{t('calendar.noEvents')}</p>
          )}
        </Card>
        <Card title={t('dashboard.quick')}>
          <Alert kind="info">{t('dashboard.phase1Note')}</Alert>
        </Card>
      </div>
    </>
  );
}
