import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePrefs } from '@/lib/preferences';
import { usePositions, lookupName } from '@/lib/lookups';
import { Badge, Button, Card, EmptyState, PageHeader, QueryError, Spinner, Table, Td } from '@/shared/ui';
import { downloadAttachment } from '@/shared/files/FileUploader';
import { AssignTaskDialog } from '../tasks/AssignTaskDialog';
import { useTeam } from '../tasks/_data';

/**
 * "فريقي" [HR §6.2, EP §16]: my direct reports and, for a department manager, the whole department —
 * position, status, open / late tasks, pending requests, secondment report; each row opens the
 * employee's page within my rights, and work can be assigned from here.
 */
export function TeamPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const positions = usePositions();
  const q = useTeam();
  const [assignTo, setAssignTo] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title={t('team.title')}
        subtitle={q.data?.scope === 'department' ? t('team.hintDepartment') : t('team.hint')}
        actions={
          <Link to="/tasks/board" className="text-sm text-brand-700 hover:underline">
            {t('tasks.board')}
          </Link>
        }
      />
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('team.empty')} />
        ) : (
          <Table
            head={[
              t('common.name'),
              t('hr.position'),
              t('common.status'),
              t('team.openTasks'),
              t('team.pendingRequests'),
              t('team.secondment'),
              '',
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={r._id}>
                <Td>
                  <Link to={`/hr/employees/${r._id}`} className="font-medium text-brand-800 hover:underline">
                    {r.fullNameAr}
                  </Link>
                  {r.directReport && (
                    <span className="ms-1 text-[10px] text-slate-400">{t('team.directReport')}</span>
                  )}
                  <div className="break-all text-xs text-slate-500" dir="ltr">
                    {r.workEmail}
                  </div>
                </Td>
                <Td>{lookupName(positions.data?.items, r.positionId)}</Td>
                <Td>
                  <Badge>{t(`hr.status.${r.status}`, r.status)}</Badge>
                </Td>
                <Td className="tabular">
                  <Badge tone={r.openTasks >= 5 ? 'amber' : 'slate'}>{r.openTasks}</Badge>
                  {r.lateTasks > 0 && (
                    <Badge tone="red">{t('tasks.lateCount', { count: r.lateTasks })}</Badge>
                  )}
                </Td>
                <Td className="tabular">{r.pendingRequests || '—'}</Td>
                <Td className="text-xs">
                  {r.secondment ? (
                    <span>
                      {r.secondment.destination} · {formatDate(r.secondment.startDate)} –{' '}
                      {formatDate(r.secondment.endDate)}{' '}
                      {r.secondment.reportAttachmentId ? (
                        <Button
                          variant="ghost"
                          onClick={() => downloadAttachment(r.secondment!.reportAttachmentId!)}
                        >
                          {t('team.report')}
                        </Button>
                      ) : (
                        <Badge tone="amber">{t('profile.notReported')}</Badge>
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  {r.userId && (
                    <Button variant="ghost" onClick={() => setAssignTo(r.userId!)}>
                      {t('tasks.assign')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <AssignTaskDialog
        open={!!assignTo}
        onClose={() => setAssignTo(null)}
        initialAssigneeId={assignTo ?? undefined}
      />
    </>
  );
}
