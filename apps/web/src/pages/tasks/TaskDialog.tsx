import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Paperclip } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, patch, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Alert, Badge, Button, Dialog, Field, QueryError, Select, Spinner, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { downloadAttachment } from '@/shared/files/FileUploader';
import { TONE_BADGE, taskTone, useTeam, type Task, type TaskEvent } from './_data';

interface Att {
  _id: string;
  originalName: string;
}

/**
 * One task: fields, history and the actions open to me — start / finish (assignee), approve / return
 * (assigner or department manager), reassign with a reason (manager) [EP §10, EP §16].
 */
export function TaskDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['task', id],
    queryFn: () => get<Task & { history: TaskEvent[] }>(`/tasks/${id}`),
    enabled: !!id,
  });
  const atts = useQuery({
    queryKey: ['task', id, 'attachments'],
    queryFn: async () => Promise.all((q.data?.attachmentIds ?? []).map((a) => get<Att>(`/files/${a}`))),
    enabled: !!q.data?.attachmentIds?.length,
  });
  const managerScope =
    (user?.permissions.find((p) => p.resource === 'tasks')?.scope ?? 'own') !== 'own' && can('tasks', 'edit');
  const team = useTeam(managerScope && !!id);
  const [mode, setMode] = useState<'return' | 'reassign' | null>(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['task', id] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['team'] });
    qc.invalidateQueries({ queryKey: ['workload'] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      refresh();
      setMode(null);
      setNote('');
      toast(t('actions.save'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const task = q.data;
  const me = user?.id;
  const isAssignee = !!task?.assigneeId && task.assigneeId === me;
  const isAssigner = task?.assignerId === me;
  const open = task && ['new', 'in_progress', 'late', 'waiting_review'].includes(task.status);
  const canReview = task?.status === 'waiting_review' && (isAssigner || managerScope);
  const canReassign = managerScope && open;
  const nameOf = (uid?: string | null) => team.data?.items.find((m) => m.userId === uid)?.fullNameAr;

  return (
    <Dialog
      open={!!id}
      onClose={onClose}
      title={task ? `${task.number} · ${task.title}` : t('tasks.details')}
    >
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : !task ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE_BADGE[taskTone(task)]}>{t(`tasks.status.${task.status}`)}</Badge>
            <Badge>{t(`tasks.priorities.${task.priority}`)}</Badge>
            {task.source && (
              <Link
                to={task.source.type === 'hr_request' ? `/hr/requests/${task.source.id}` : '#'}
                className="text-xs text-brand-700 hover:underline"
              >
                {t(`tasks.sources.${task.source.type}`)} {task.source.label ?? ''}
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-sm">
            <dt className="text-slate-500">{t('tasks.assignee')}</dt>
            <dd>
              {task.assigneeId
                ? (nameOf(task.assigneeId) ?? (isAssignee ? user?.displayNameAr : '—'))
                : t('tasks.queue')}
            </dd>
            <dt className="text-slate-500">{t('tasks.startAt')}</dt>
            <dd className="tabular">{task.startAt ? formatDateTime(task.startAt) : '—'}</dd>
            <dt className="text-slate-500">{t('tasks.dueAt')}</dt>
            <dd className="tabular">{task.dueAt ? formatDateTime(task.dueAt) : '—'}</dd>
            <dt className="text-slate-500">{t('tasks.progress')}</dt>
            <dd className="tabular">{task.progressPercent}%</dd>
            <dt className="text-slate-500">{t('tasks.description')}</dt>
            <dd className="whitespace-pre-wrap">{task.description || '—'}</dd>
          </dl>
          {task.reviewNote && task.status !== 'done' && (
            <Alert kind="warning">
              <strong>{t('tasks.reviewNote')}:</strong> {task.reviewNote}
            </Alert>
          )}
          {atts.data?.length ? (
            <div className="flex flex-wrap gap-2">
              {atts.data.map((a) => (
                <Button key={a._id} variant="secondary" onClick={() => downloadAttachment(a._id)}>
                  <Paperclip className="size-4" aria-hidden /> {a.originalName}
                </Button>
              ))}
            </div>
          ) : null}

          {(isAssignee || canReview || canReassign) && open && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {isAssignee && task.status === 'new' && (
                <Button
                  variant="secondary"
                  onClick={() => act.mutate(() => patch(`/tasks/${task._id}`, { status: 'in_progress' }))}
                >
                  {t('tasks.startWork')}
                </Button>
              )}
              {isAssignee && task.status !== 'waiting_review' && (
                <Button onClick={() => act.mutate(() => patch(`/tasks/${task._id}`, { status: 'done' }))}>
                  {isAssigner ? t('tasks.markDone') : t('tasks.submitForReview')}
                </Button>
              )}
              {canReview && (
                <>
                  <Button
                    onClick={() => act.mutate(() => post(`/tasks/${task._id}/review`, { approve: true }))}
                  >
                    {t('tasks.approve')}
                  </Button>
                  <Button variant="secondary" onClick={() => setMode('return')}>
                    {t('tasks.return')}
                  </Button>
                </>
              )}
              {canReassign && (
                <Button variant="ghost" onClick={() => setMode('reassign')}>
                  {task.assigneeId ? t('tasks.reassign') : t('tasks.assign')}
                </Button>
              )}
              {(isAssigner || managerScope) && task.status !== 'waiting_review' && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    window.confirm(t('tasks.cancelConfirm')) &&
                    act.mutate(() => patch(`/tasks/${task._id}`, { status: 'cancelled' }))
                  }
                >
                  {t('tasks.cancel')}
                </Button>
              )}
            </div>
          )}

          {mode === 'return' && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <Field label={t('tasks.returnNote')} required>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMode(null)}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  disabled={note.trim().length < 2}
                  onClick={() =>
                    act.mutate(() => post(`/tasks/${task._id}/review`, { approve: false, note }))
                  }
                >
                  {t('tasks.return')}
                </Button>
              </div>
            </div>
          )}
          {mode === 'reassign' && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <Field label={t('tasks.assignee')} required>
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">—</option>
                  {(team.data?.items ?? [])
                    .filter((m) => m.userId && m.userId !== task.assigneeId)
                    .map((m) => (
                      <option key={m._id} value={m.userId}>
                        {m.fullNameAr} ({t('tasks.openCount', { count: m.openTasks })})
                      </option>
                    ))}
                </Select>
              </Field>
              {task.assigneeId && (
                <Field label={t('tasks.reassignReason')} required>
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMode(null)}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  disabled={!target || (!!task.assigneeId && note.trim().length < 2)}
                  onClick={() =>
                    act.mutate(() =>
                      post(`/tasks/${task._id}/assign`, { assigneeId: target, reason: note || undefined }),
                    )
                  }
                >
                  {t('tasks.assign')}
                </Button>
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('tasks.history')}</h3>
            <ol className="space-y-2 border-s border-slate-200 ps-3 text-xs">
              {task.history.map((h) => (
                <li key={h._id}>
                  <div className="font-medium text-slate-800">
                    {t(`tasks.events.${h.type}`, h.type)}
                    {h.toStatus && h.toStatus !== h.fromStatus && (
                      <span className="ms-1 text-slate-500">
                        ← {t(`tasks.status.${h.toStatus}`, h.toStatus)}
                      </span>
                    )}
                  </div>
                  {h.note && <div className="text-slate-600">{h.note}</div>}
                  <div className="tabular text-slate-400">
                    {formatDateTime(h.at)}
                    {h.actorEmail ? ` · ${h.actorEmail}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Dialog>
  );
}
