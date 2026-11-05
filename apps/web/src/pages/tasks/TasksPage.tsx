import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { Badge, Button, Card, EmptyState, PageHeader, QueryError, Spinner, Table, Td } from '@/shared/ui';
import { AssignTaskDialog } from './AssignTaskDialog';
import { TaskDialog } from './TaskDialog';
import { TONE_BADGE, taskTone, useTasks } from './_data';

/** My tasks [EP §10]; managers also assign from here. /tasks/:id opens one task over the list (notification links). */
export function TasksPage() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { formatDateTime } = usePrefs();
  const nav = useNavigate();
  const { id: openId } = useParams();
  const [mine, setMine] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const tasks = useTasks({ limit: 200, mine });
  const canAssign = can('tasks', 'create');

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{' '}
              {t('tasks.mine')}
            </label>
            {canAssign && (
              <Link to="/tasks/board" className="text-sm text-brand-700 hover:underline">
                {t('tasks.board')}
              </Link>
            )}
            {canAssign && <Button onClick={() => setAssignOpen(true)}>{t('tasks.assign')}</Button>}
          </>
        }
      />
      <Card>
        {tasks.isError ? (
          <QueryError error={tasks.error} onRetry={() => tasks.refetch()} />
        ) : tasks.isLoading ? (
          <Spinner />
        ) : !tasks.data?.items.length ? (
          <EmptyState title={t('common.empty')} />
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
            {tasks.data.items.map((task) => (
              <tr
                key={task._id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => nav(`/tasks/${task._id}`)}
              >
                <Td className="tabular text-xs text-slate-500">{task.number}</Td>
                <Td className="font-medium">
                  {task.title}
                  {task.assigneeId && task.assigneeId !== user?.id && task.assignerId === user?.id && (
                    <span className="ms-2 text-xs text-slate-500">{t('tasks.assignedByMe')}</span>
                  )}
                </Td>
                <Td>{t(`tasks.priorities.${task.priority}`)}</Td>
                <Td className="tabular">{task.dueAt ? formatDateTime(task.dueAt) : '—'}</Td>
                <Td>
                  <Badge tone={TONE_BADGE[taskTone(task)]}>{t(`tasks.status.${task.status}`)}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <TaskDialog id={openId ?? null} onClose={() => nav('/tasks')} />
      <AssignTaskDialog open={assignOpen} onClose={() => setAssignOpen(false)} />
    </>
  );
}
