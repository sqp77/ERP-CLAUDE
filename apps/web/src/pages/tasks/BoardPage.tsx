import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { TASK_STATUSES, PRIORITIES, type TaskStatus } from '@eayni/shared';
import { get } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { useAuth } from '@/lib/auth';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
  cx,
} from '@/shared/ui';
import { AssignTaskDialog } from './AssignTaskDialog';
import { TaskDialog } from './TaskDialog';
import { OPEN, TONE_BADGE, TONE_CLASS, taskTone, useTasks, useTeam, type Task } from './_data';
import { Link } from 'react-router';
import { ticketTone, useTickets } from '../tickets/_data';

const COLUMNS: TaskStatus[] = ['new', 'in_progress', 'waiting_review', 'late', 'done'];

/**
 * Department task board [EP §16, MKT §11]: unassigned queue on top, Kanban by status or a table,
 * filters by employee / priority / due date, colours per MKT §11, and the workload per employee.
 */
export function BoardPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const { user } = useAuth();
  const { formatDate } = usePrefs();
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [assignee, setAssignee] = useState(search.get('assigneeId') ?? '');
  const [priority, setPriority] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [status, setStatus] = useState(search.get('status') ?? '');
  const [overdue, setOverdue] = useState(search.get('overdue') === 'true'); // review H5: server-side overdue
  const [openId, setOpenId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<{ assigneeId?: string } | null>(null);
  const team = useTeam();
  // The queue of THIS board (review H2): the department the manager role is scoped to, else the user's own.
  const boardDepartmentId =
    user?.roles.find((r) => r.role === 'department_manager' && r.departmentId)?.departmentId ??
    user?.departmentId ??
    undefined;
  const tasks = useTasks({
    limit: 500,
    assigneeId: assignee || undefined,
    priority: priority || undefined,
    dueTo: dueTo ? `${dueTo}T23:59:59+03:00` : undefined,
    status: status || undefined,
    overdue: overdue || undefined,
  });
  const ticketQueue = useTickets({ view: 'department', open: true, limit: 100 });
  const workload = useQuery({
    queryKey: ['workload'],
    queryFn: () =>
      get<{
        items: { userId: string; open: number; late: number }[];
        unassigned: { open: number; late: number };
      }>('/tasks/workload'),
  });
  const nameOf = (uid?: string | null) =>
    uid === user?.id
      ? user?.displayNameAr
      : (team.data?.items.find((m) => m.userId === uid)?.fullNameAr ?? '—');
  const items = useMemo(() => tasks.data?.items ?? [], [tasks.data]);
  const queue = useMemo(() => items.filter((x) => !x.assigneeId && OPEN.includes(x.status)), [items]);
  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    for (const s of COLUMNS) m.set(s, []);
    for (const x of items) if (x.assigneeId && m.has(x.status)) m.get(x.status)!.push(x);
    return m;
  }, [items]);

  const card = (x: Task) => (
    <button
      key={x._id}
      type="button"
      onClick={() => setOpenId(x._id)}
      className={cx(
        'block w-full rounded-lg border border-slate-200 border-s-4 bg-white p-2 text-start text-sm shadow-sm hover:bg-slate-50',
        TONE_CLASS[taskTone(x)],
      )}
    >
      <div className="text-[11px] tabular text-slate-400">{x.number}</div>
      <div className="font-medium leading-snug">{x.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <span>{x.assigneeId ? nameOf(x.assigneeId) : t('tasks.queue')}</span>
        {x.dueAt && <span className="tabular">· {formatDate(x.dueAt)}</span>}
        <Badge tone={TONE_BADGE[taskTone(x)]}>{t(`tasks.priorities.${x.priority}`)}</Badge>
      </div>
    </button>
  );

  return (
    <>
      <PageHeader
        title={t('tasks.board')}
        subtitle={t('tasks.boardHint')}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {(['kanban', 'table'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cx(
                    'rounded-md px-2.5 py-1.5',
                    view === v ? 'bg-brand-700 text-white' : 'text-slate-600',
                  )}
                >
                  {t(`tasks.view.${v}`)}
                </button>
              ))}
            </div>
            <Button onClick={() => setAssignOpen({})}>{t('tasks.assign')}</Button>
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label={t('tasks.assignee')}
        >
          <option value="">{t('tasks.allEmployees')}</option>
          {(team.data?.items ?? [])
            .filter((m) => m.userId)
            .map((m) => (
              <option key={m._id} value={m.userId}>
                {m.fullNameAr}
              </option>
            ))}
        </Select>
        <Select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          aria-label={t('tasks.priority')}
        >
          <option value="">{t('tasks.allPriorities')}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`tasks.priorities.${p}`)}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          dir="ltr"
          value={dueTo}
          onChange={(e) => setDueTo(e.target.value)}
          aria-label={t('tasks.dueBefore')}
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')}>
          <option value="">{t('tasks.allStatuses')}</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.status.${s}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          {t('tasks.overdueOnly')}
        </label>
      </div>

      {tasks.isError ? (
        <QueryError error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : tasks.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <Card
              title={`${t('tickets.departmentQueue')} (${ticketQueue.data?.items.filter((x) => !x.assigneeId).length ?? 0})`}
            >
              {ticketQueue.isError ? (
                <p className="text-xs text-slate-500">{t('tickets.queueUnavailable')}</p>
              ) : !ticketQueue.data?.items.length ? (
                <p className="text-sm text-slate-500">{t('tickets.queueEmpty')}</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {ticketQueue.data.items.map((x) => (
                    <li key={x._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link to={`/tickets/${x._id}`} className="font-medium text-brand-800 hover:underline">
                        {x.number} · {x.subject}
                      </Link>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{x.requesterName}</span>
                        <Badge tone={ticketTone[x.state]}>{t(`tickets.states.${x.state}`)}</Badge>
                        {!x.assigneeId && <Badge tone="amber">{t('tickets.unassigned')}</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={`${t('tasks.queue')} (${queue.length})`}>
              {queue.length ? (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{queue.map(card)}</div>
              ) : (
                <p className="text-sm text-slate-500">{t('tasks.queueEmpty')}</p>
              )}
            </Card>
            {view === 'kanban' ? (
              <div className="grid gap-3 md:grid-cols-5">
                {COLUMNS.map((s) => (
                  <div key={s} className="rounded-xl bg-slate-100 p-2">
                    <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-slate-600">
                      <span>{t(`tasks.status.${s}`)}</span>
                      <span className="tabular">{byStatus.get(s)!.length}</span>
                    </div>
                    <div className="space-y-2">{byStatus.get(s)!.map(card)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <Card>
                {!items.length ? (
                  <EmptyState title={t('common.empty')} />
                ) : (
                  <Table
                    head={[
                      t('common.number'),
                      t('tasks.taskTitle'),
                      t('tasks.assignee'),
                      t('tasks.priority'),
                      t('tasks.dueAt'),
                      t('common.status'),
                    ]}
                  >
                    {items.map((x) => (
                      <tr
                        key={x._id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setOpenId(x._id)}
                      >
                        <Td className="tabular text-xs text-slate-500">{x.number}</Td>
                        <Td className="font-medium">{x.title}</Td>
                        <Td>
                          {x.assigneeId ? (
                            nameOf(x.assigneeId)
                          ) : (
                            <Badge tone="amber">{t('tasks.queue')}</Badge>
                          )}
                        </Td>
                        <Td>{t(`tasks.priorities.${x.priority}`)}</Td>
                        <Td className="tabular">{x.dueAt ? formatDate(x.dueAt) : '—'}</Td>
                        <Td>
                          <Badge tone={TONE_BADGE[taskTone(x)]}>{t(`tasks.status.${x.status}`)}</Badge>
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            )}
          </div>
          <Card title={t('tasks.workload')}>
            {workload.isLoading ? (
              <Spinner />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {(team.data?.items ?? [])
                  .filter((m) => m.userId)
                  .map((m) => {
                    const w = workload.data?.items.find((i) => i.userId === m.userId);
                    const open = w?.open ?? 0;
                    const late = w?.late ?? 0;
                    return (
                      <li key={m._id} className="flex items-center justify-between py-2">
                        <button
                          type="button"
                          className="text-start hover:underline"
                          onClick={() => setAssignOpen({ assigneeId: m.userId })}
                        >
                          {m.fullNameAr}
                        </button>
                        <span className="flex items-center gap-1 tabular text-xs">
                          <Badge tone={open >= 5 ? 'amber' : 'slate'}>{open}</Badge>
                          {late > 0 && <Badge tone="red">{late}</Badge>}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-500">{t('tasks.workloadHint')}</p>
          </Card>
        </div>
      )}
      <TaskDialog id={openId} onClose={() => setOpenId(null)} />
      <AssignTaskDialog
        open={!!assignOpen}
        onClose={() => setAssignOpen(null)}
        initialAssigneeId={assignOpen?.assigneeId}
        departmentId={boardDepartmentId}
      />
    </>
  );
}
