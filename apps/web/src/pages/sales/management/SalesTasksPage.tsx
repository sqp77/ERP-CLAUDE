import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EVENT_STATUS_AR, type EventStatus } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { recordLink } from '@/lib/links';
import { useDepartments } from '@/lib/lookups';
import { usePrefs } from '@/lib/preferences';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
  cx,
} from '@/shared/ui';
import type { Task } from '../../tasks/_data';
import { useSalesTeam } from '../_data';

interface SalesEvent {
  _id: string;
  title: string;
  type: 'meeting' | 'visit' | 'event' | string;
  status: EventStatus;
  startAt: string;
  location?: string;
  meetingType?: string;
  link?: { type: string; id: string; label?: string };
  ownerId?: string;
  needsMarketing?: boolean;
  marketingNotifiedAt?: string | null;
}
const eventTone: Record<EventStatus, 'slate' | 'green' | 'red' | 'amber' | 'blue'> = {
  scheduled: 'blue',
  done: 'green',
  not_done: 'red',
  rescheduled: 'amber',
  cancelled: 'slate',
};
const taskTone: Record<string, 'slate' | 'green' | 'red' | 'amber' | 'blue'> = {
  new: 'slate',
  in_progress: 'blue',
  waiting_review: 'amber',
  late: 'red',
  done: 'green',
  cancelled: 'slate',
};

/**
 * واجهة إدارة المهام والزيارات [SAL §18 (11)]: the Sales department's open tasks (core tasks, one store) and the
 * meetings and visits of the next 30 days from the calendar, filtered by employee. Opening an item uses its own screen.
 */
export function SalesTasksPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'visits' ? 'visits' : 'tasks';
  const assigneeId = params.get('assigneeId') ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const managerView = !!user?.permissions.some(
    (p) => p.resource === 'sales.dashboard' && p.scope !== 'own' && p.scope !== 'team',
  );
  const team = useSalesTeam(managerView);
  const depts = useDepartments();
  const salesDept = depts.data?.items.find((d) => d.code === 'sales')?._id;
  const who = managerView ? assigneeId : (user?.id ?? '');
  const tasks = useQuery({
    queryKey: ['sales', 'tasks', salesDept, who],
    queryFn: () =>
      get<Paged<Task>>(
        `/tasks?open=true&limit=200${who ? `&assigneeId=${who}` : salesDept ? `&departmentId=${salesDept}` : '&mine=true'}`,
      ),
    enabled: view === 'tasks' && (!!who || !!salesDept || !managerView),
  });
  const range = useMemo(() => {
    const from = new Date(Date.now() - 7 * 86_400_000);
    const to = new Date(Date.now() + 30 * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const events = useQuery({
    queryKey: ['sales', 'visits', range.from, who],
    queryFn: async () => {
      const base = `/calendar/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&include=none${who ? `&userId=${who}` : ''}`;
      const [m, v, e] = await Promise.all([
        get<{ items: SalesEvent[] }>(`${base}&type=meeting`),
        get<{ items: SalesEvent[] }>(`${base}&type=visit`),
        get<{ items: SalesEvent[] }>(`${base}&type=event`),
      ]);
      return [...m.items, ...v.items, ...e.items].sort((a, b) => a.startAt.localeCompare(b.startAt));
    },
    enabled: view === 'visits' && can('calendar', 'view'),
  });
  return (
    <>
      <PageHeader
        title={t('sales.tasksPage.title')}
        subtitle={t('sales.tasksPage.subtitle')}
        actions={
          <>
            <Link to="/calendar">
              <Button variant="secondary">{t('sales.tasksPage.openCalendar')}</Button>
            </Link>
            <Link to="/tasks">
              <Button variant="secondary">{t('sales.tasksPage.openTasks')}</Button>
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1" role="tablist">
          {(['tasks', 'visits'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => set('view', v === 'tasks' ? '' : v)}
              className={cx(
                'min-h-9 rounded-md px-3 text-sm',
                view === v ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              {t(`sales.tasksPage.tabs.${v}`)}
            </button>
          ))}
        </div>
        {managerView && (
          <Select className="w-56" value={assigneeId} onChange={(e) => set('assigneeId', e.target.value)}>
            <option value="">{t('sales.kpi.wholeDepartment')}</option>
            {team.data?.items.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.fullNameAr}
              </option>
            ))}
          </Select>
        )}
      </div>
      {view === 'tasks' ? (
        <Card>
          {tasks.isError ? (
            <QueryError error={tasks.error} onRetry={() => tasks.refetch()} />
          ) : tasks.isLoading ? (
            <Spinner />
          ) : !tasks.data?.items.length ? (
            <EmptyState title={t('sales.tasksPage.noTasks')} />
          ) : (
            <Table
              head={[
                t('common.number'),
                t('tasks.taskTitle'),
                t('tasks.priority'),
                t('tasks.dueAt'),
                t('common.status'),
              ]}
            >
              {tasks.data.items.map((x) => {
                const src = x.source ? recordLink(x.source.type, x.source.id) : undefined;
                return (
                  <tr key={x._id}>
                    <Td className="tabular text-xs text-slate-500">{x.number}</Td>
                    <Td>
                      <Link to={`/tasks/${x._id}`} className="font-medium text-brand-700 hover:underline">
                        {x.title}
                      </Link>
                      {x.source && src && (
                        <Link to={src} className="ms-2 text-xs text-slate-500 hover:underline">
                          {x.source.label ?? x.source.type}
                        </Link>
                      )}
                    </Td>
                    <Td>{t(`tasks.priorities.${x.priority}`)}</Td>
                    <Td className="tabular">{x.dueAt ? formatDate(x.dueAt) : '—'}</Td>
                    <Td>
                      <Badge tone={taskTone[x.status] ?? 'slate'}>{t(`tasks.status.${x.status}`)}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          {events.isError ? (
            <QueryError error={events.error} onRetry={() => events.refetch()} />
          ) : events.isLoading ? (
            <Spinner />
          ) : !events.data?.length ? (
            <EmptyState title={t('sales.tasksPage.noVisits')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.data.map((e) => {
                const href = recordLink(e.link?.type, e.link?.id);
                return (
                  <li key={e._id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div className="min-w-0">
                      <Link
                        to={`/calendar?event=${e._id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {e.title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {t(`calendar.types.${e.type}`)}
                        {e.meetingType ? ` · ${e.meetingType}` : ''}
                        {e.location ? ` · ${e.location}` : ''}
                        {e.link && href && (
                          <>
                            {' · '}
                            <Link to={href} className="hover:underline">
                              {e.link.label ?? e.link.id}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {e.marketingNotifiedAt && <Badge tone="brand">{t('calendar.marketingNotified')}</Badge>}
                      <span className="tabular text-xs text-slate-600">
                        {formatDate(e.startAt, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                      <Badge tone={eventTone[e.status]}>{EVENT_STATUS_AR[e.status]}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
