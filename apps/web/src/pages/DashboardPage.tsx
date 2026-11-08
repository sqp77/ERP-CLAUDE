import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  Briefcase,
  Cake,
  CalendarDays,
  ClipboardList,
  FileText,
  Landmark,
  Newspaper,
  Ticket,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, type Paged } from '@/lib/api';
import { Alert, Badge, Card, PageHeader } from '@/shared/ui';
import { isBirthdayToday } from '@/lib/dates';
import { sar } from './hr/_data';

interface MyProfile {
  fullNameAr: string;
  birthDate?: string;
  status: string;
  labels: { position?: string; department?: string; directManager?: string };
  currentContract: null | {
    status: string;
    endDate?: string;
    probation: null | { endDate: string; inProbation: boolean };
  };
  basicSalaryHalalas?: number;
  pendingChanges: { number: string }[];
}

/** Employee dashboard [EP §4]: the nine sections as cards; later slices fill requests, tickets, reports and news. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { formatDate } = usePrefs();
  const me = useQuery({ queryKey: ['me', 'profile'], queryFn: () => get<MyProfile>('/hr/me'), retry: false });
  const tasks = useQuery({
    queryKey: ['tasks', 'mine-open'],
    queryFn: () => get<Paged<unknown>>('/tasks?mine=true&limit=1'),
    enabled: can('tasks', 'view'),
  });
  const myTickets = useQuery({
    queryKey: ['tickets', 'mine', 'open'],
    queryFn: () => get<Paged<unknown>>('/tickets?view=mine&open=true&limit=1'),
    enabled: can('tickets', 'view'),
  });
  const latestNews = useQuery({
    queryKey: ['news', { view: 'feed', limit: 1 }],
    queryFn: () => get<Paged<{ title: string }>>('/news?view=feed&limit=1'),
    enabled: can('news', 'view'),
  });
  const myReq = useQuery({
    queryKey: ['hr-requests', 'mine', 'open'],
    queryFn: () => get<Paged<unknown>>('/hr/requests?view=mine&open=true&limit=1'),
    enabled: can('hr.requests', 'create'),
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
  const p = me.data;
  const isBirthday = isBirthdayToday(p?.birthDate, now);

  const tile = (to: string, Icon: typeof Bell, title: string, body: React.ReactNode, soon = false) => (
    <Link
      to={to}
      className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-500"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {title}
          {soon && <Badge>{t('dashboard.soon')}</Badge>}
        </div>
        <div className="mt-0.5 text-sm text-slate-600">{body}</div>
      </div>
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user?.displayNameAr })}
        subtitle={`${t('dashboard.today')}: ${formatDate(now, { dateStyle: 'full' })}`}
      />
      {isBirthday && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <Cake className="size-6" aria-hidden />
          <div className="font-medium">{t('dashboard.birthday', { name: p?.fullNameAr })}</div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tile(
          '/me/profile',
          UserRound,
          t('dashboard.sections.profile'),
          p ? `${p.labels.position ?? ''} · ${p.labels.department ?? ''}` : t('profile.noFile'),
        )}
        {tile(
          '/me/profile',
          FileText,
          t('dashboard.sections.contract'),
          p?.currentContract
            ? p.currentContract.probation?.inProbation
              ? `${t('profile.inProbation')} — ${formatDate(p.currentContract.probation.endDate)}`
              : p.currentContract.endDate
                ? `${t('calendar.end')}: ${formatDate(p.currentContract.endDate)}`
                : t('hr.contractTypes.open_ended')
            : '—',
        )}
        {tile(
          '/me/profile',
          Landmark,
          t('dashboard.sections.financial'),
          p
            ? `${t('hr.basicSalary')}: ${sar(p.basicSalaryHalalas)}${p.pendingChanges.length ? ` · ${t('profile.pendingChange')}` : ''}`
            : '—',
        )}
        {tile(
          '/me/requests',
          Ticket,
          t('dashboard.sections.requests'),
          `${myReq.data?.total ?? 0} ${t('dashboard.openRequests')}`,
        )}
        {tile(
          '/me/tickets',
          Ticket,
          t('dashboard.sections.tickets'),
          `${myTickets.data?.total ?? 0} ${t('dashboard.openTickets')}`,
        )}
        {tile(
          '/tasks',
          ClipboardList,
          t('dashboard.sections.tasks'),
          `${tasks.data?.total ?? 0} ${t('dashboard.openTasks')}`,
        )}
        {tile(
          '/calendar',
          CalendarDays,
          t('dashboard.sections.calendar'),
          `${events.data?.items.length ?? 0} ${t('dashboard.upcoming')}`,
        )}
        {tile('/', Briefcase, t('dashboard.sections.reports'), t('dashboard.phaseNote'), true)}
        {tile(
          '/news',
          Newspaper,
          t('dashboard.sections.news'),
          latestNews.data?.items[0]?.title ?? t('news.empty'),
        )}
        {tile(
          '/notifications',
          Bell,
          t('dashboard.sections.notifications'),
          `${notif.data?.unread ?? 0} ${t('dashboard.unread')}`,
        )}
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
