import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PRIORITIES, type Priority, type TaskStatus } from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, patch, post, type Paged } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';

interface Task {
  _id: string;
  number: string;
  title: string;
  assigneeId: string;
  assignerId: string;
  priority: Priority;
  status: TaskStatus;
  dueAt?: string;
  progressPercent: number;
}
interface UserRow {
  _id: string;
  displayNameAr: string;
  email: string;
}

const statusTone: Record<TaskStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  new: 'slate',
  in_progress: 'blue',
  waiting_review: 'amber',
  done: 'green',
  late: 'red',
  cancelled: 'slate',
};

/** My tasks + assignment [EP §10]. Reminders are server jobs. */
export function TasksPage() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { formatDate } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [mine, setMine] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const tasks = useQuery({
    queryKey: ['tasks', mine],
    queryFn: () => get<Paged<Task>>(`/tasks?limit=100${mine ? '&mine=true' : ''}`),
  });
  const users = useQuery({
    queryKey: ['users', 'picker'],
    queryFn: () => get<Paged<UserRow>>('/users?limit=200'),
    enabled: can('users', 'view') && open,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Task> }) => patch(`/tasks/${id}`, body),
    onSuccess: invalidate,
  });
  const form = useForm<{
    title: string;
    description?: string;
    assigneeId: string;
    priority: Priority;
    dueAt?: string;
  }>({ defaultValues: { priority: 'medium', assigneeId: user?.id } });
  const create = form.handleSubmit(async (v) => {
    try {
      await post('/tasks', { ...v, dueAt: v.dueAt || undefined });
      toast(t('actions.save'));
      setOpen(false);
      form.reset();
      invalidate();
    } catch (e) {
      setError(errorMessage(e));
    }
  });

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
            {can('tasks', 'create') && <Button onClick={() => setOpen(true)}>{t('tasks.new')}</Button>}
          </>
        }
      />
      <Card>
        {tasks.isLoading ? (
          <Spinner />
        ) : !tasks.data?.items.length ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <Table
            head={['#', t('tasks.taskTitle'), t('tasks.priority'), t('tasks.dueAt'), t('common.status'), '']}
          >
            {tasks.data.items.map((task) => (
              <tr key={task._id}>
                <Td className="tabular text-xs text-slate-500">{task.number}</Td>
                <Td className="font-medium">{task.title}</Td>
                <Td>{t(`tasks.priorities.${task.priority}`)}</Td>
                <Td className="tabular">{formatDate(task.dueAt)}</Td>
                <Td>
                  <Badge tone={statusTone[task.status]}>{t(`tasks.status.${task.status}`)}</Badge>
                </Td>
                <Td>
                  {task.assigneeId === user?.id && task.status !== 'done' && task.status !== 'cancelled' && (
                    <div className="flex gap-1">
                      {task.status === 'new' && (
                        <Button
                          variant="ghost"
                          onClick={() => update.mutate({ id: task._id, body: { status: 'in_progress' } })}
                        >
                          {t('tasks.startWork')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => update.mutate({ id: task._id, body: { status: 'done' } })}
                      >
                        {t('tasks.markDone')}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('tasks.new')}>
        <form onSubmit={create} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('tasks.taskTitle')} required>
            <Input {...form.register('title', { required: true })} />
          </Field>
          <Field label={t('tasks.assignee')} required>
            {users.data ? (
              <Select {...form.register('assigneeId', { required: true })}>
                {users.data.items.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.displayNameAr} — {u.email}
                  </option>
                ))}
              </Select>
            ) : (
              <Input dir="ltr" {...form.register('assigneeId', { required: true })} placeholder="user id" />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('tasks.priority')}>
              <Select {...form.register('priority')}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`tasks.priorities.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('tasks.dueAt')}>
              <Input type="datetime-local" dir="ltr" {...form.register('dueAt')} />
            </Field>
          </div>
          <Field label={t('tasks.description')}>
            <Textarea rows={3} {...form.register('description')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
