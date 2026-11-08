import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { TASK_STATUSES } from '@eayni/shared';
import { get } from '@/lib/api';
import { Card, PageHeader, QueryError, Spinner } from '@/shared/ui';
import { Bars, Kpi } from './_ui';

interface Data {
  team: { total: number; active: number; onLeave: number; seconded: number; other: number };
  tasks: { byStatus: Record<string, number>; overdue: number; open: number };
  tickets: { open: number };
  requestsPending: number;
  reportsPending: number;
  meetingsThisWeek: number;
}

/** Direct-manager dashboard [EP §16]: every card opens the filtered list behind it. */
export function ManagerDashboardPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['dashboard', 'manager'],
    queryFn: () => get<Data>('/hr/dashboard/manager'),
  });
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <>
      <PageHeader title={t('dash.manager.title')} subtitle={t('dash.manager.hint')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          to="/manager/team"
          label={t('dash.manager.team')}
          value={d.team.total}
          hint={`${t('dash.manager.active')} ${d.team.active}`}
        />
        <Kpi to="/manager/team" label={t('dash.manager.onLeave')} value={d.team.onLeave} tone="amber" />
        <Kpi to="/manager/team" label={t('dash.manager.seconded')} value={d.team.seconded} tone="blue" />
        <Kpi to="/tasks/board" label={t('dash.manager.openTasks')} value={d.tasks.open} />
        <Kpi
          to="/tasks/board?overdue=true"
          label={t('dash.manager.overdue')}
          value={d.tasks.overdue}
          tone={d.tasks.overdue ? 'red' : 'green'}
        />
        <Kpi
          to="/manager/requests"
          label={t('dash.manager.requestsPending')}
          value={d.requestsPending}
          tone={d.requestsPending ? 'amber' : 'slate'}
        />
        <Kpi
          to="/reports"
          label={t('dash.manager.reportsPending')}
          value={d.reportsPending}
          tone={d.reportsPending ? 'amber' : 'slate'}
        />
        <Kpi to="/calendar" label={t('dash.manager.meetings')} value={d.meetingsThisWeek} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={t('dash.manager.tasksByStatus')}>
          <Bars
            items={TASK_STATUSES.map((s) => ({
              key: t(`tasks.status.${s}`),
              count: d.tasks.byStatus[s] ?? 0,
              to: `/tasks/board?status=${s}`,
            }))}
          />
        </Card>
        <Card title={t('dash.manager.tickets')}>
          <Kpi
            to="/tickets?view=team&open=true"
            label={t('dash.manager.openTickets')}
            value={d.tickets.open}
          />
        </Card>
      </div>
    </>
  );
}
