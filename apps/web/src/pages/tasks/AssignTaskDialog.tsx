import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { PRIORITIES, TASK_SOURCE_TYPES, type Priority } from '@eayni/shared';
import { post } from '@/lib/api';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { localInputToIso } from '@/lib/dates';
import { usePositions, lookupName } from '@/lib/lookups';
import { usePrefs } from '@/lib/preferences';
import { Alert, Button, Dialog, Field, Input, QueryError, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';
import { awayNotice, useTeam, type TeamMember } from './_data';

interface FormValues {
  title: string;
  description?: string;
  priority: Priority;
  startAt?: string;
  dueAt?: string;
  sourceType?: string;
  sourceId?: string;
}

/**
 * "إسناد مهمة" [EP §16, EP §10]: pick the employee from my team / department by name (no ids), or
 * leave the task in the department queue; dates are sent with the Riyadh offset; attachments and an
 * optional link to a record.
 */
export function AssignTaskDialog({
  open,
  onClose,
  initialAssigneeId,
  departmentId,
}: {
  open: boolean;
  onClose: () => void;
  initialAssigneeId?: string;
  departmentId?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const team = useTeam(open);
  const positions = usePositions();
  const { formatDate } = usePrefs();
  const [q, setQ] = useState('');
  const [awayConfirmed, setAwayConfirmed] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string | ''>(initialAssigneeId ?? '');
  const [attachments, setAttachments] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const form = useForm<FormValues>({ defaultValues: { priority: 'medium' } });
  // Every opening starts clean with the props of that opening (go-live review H2): no leftover assignee,
  // search text, attachments or error from a previous task.
  useEffect(() => {
    if (!open) return;
    form.reset({ priority: 'medium' });
    setQ('');
    setAwayConfirmed(false);
    setAssigneeId(initialAssigneeId ?? '');
    setAttachments([]);
    setError(undefined);
  }, [open, initialAssigneeId, form]);
  const members = useMemo(() => {
    const items = team.data?.items ?? [];
    const needle = q.trim();
    return items.filter((m) => !needle || m.fullNameAr.includes(needle) || m.employeeNumber.includes(needle));
  }, [team.data, q]);
  const selected = team.data?.items.find((m) => m.userId === assigneeId);
  const away = selected ? awayNotice(selected) : null;
  const required = t('common.requiredField');

  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    if (away && !awayConfirmed) {
      setError(t('tasks.awayConfirmRequired'));
      return;
    }
    try {
      await post('/tasks', {
        title: v.title,
        description: v.description || undefined,
        priority: v.priority,
        startAt: localInputToIso(v.startAt),
        dueAt: localInputToIso(v.dueAt),
        assigneeId: assigneeId || undefined,
        departmentId: assigneeId ? undefined : departmentId,
        source: v.sourceType && v.sourceId ? { type: v.sourceType, id: v.sourceId.trim() } : undefined,
        attachmentIds: attachments.map((a) => a.attachmentId),
      });
      toast(t('tasks.assigned'));
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      form.reset({ priority: 'medium' });
      setAttachments([]);
      setAssigneeId('');
      onClose();
    } catch (e) {
      for (const [name, message] of Object.entries(fieldErrorsFrom(e)))
        form.setError(name as keyof FormValues, { type: 'server', message });
      setError(errorMessage(e));
    }
  });

  const row = (m: TeamMember) => (
    <button
      key={m._id}
      type="button"
      onClick={() => {
        setAssigneeId(m.userId ?? '');
        setAwayConfirmed(false);
      }}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-start text-sm ${
        assigneeId === m.userId ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span>
        <span className="font-medium">{m.fullNameAr}</span>
        <span className="ms-2 text-xs text-slate-500">{lookupName(positions.data?.items, m.positionId)}</span>
      </span>
      <span className="text-xs tabular text-slate-500">
        {t('tasks.openCount', { count: m.openTasks })}
        {m.lateTasks > 0 && (
          <span className="ms-2 text-red-700">{t('tasks.lateCount', { count: m.lateTasks })}</span>
        )}
      </span>
    </button>
  );

  return (
    <Dialog open={open} onClose={onClose} title={t('tasks.assign')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        {team.isError && <QueryError error={team.error} onRetry={() => team.refetch()} />}
        <Field label={t('tasks.assignee')} hint={t('tasks.assigneeHint')}>
          <div className="space-y-2">
            <Input placeholder={t('actions.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-48 space-y-1 overflow-y-auto">
              <button
                type="button"
                onClick={() => setAssigneeId('')}
                className={`w-full rounded-lg border px-3 py-2 text-start text-sm ${
                  assigneeId === '' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t('tasks.queue')}
              </button>
              {members.filter((m) => m.userId).map(row)}
            </div>
            {selected && (
              <p className="text-xs text-slate-600">{t('tasks.selected', { name: selected.fullNameAr })}</p>
            )}
            {away && (
              <Alert kind="warning">
                <div>
                  {t(`tasks.away.${away.kind}`, {
                    date: away.until ? formatDate(away.until) : t('tasks.awayUnknownDate'),
                  })}
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={awayConfirmed}
                    onChange={(e) => setAwayConfirmed(e.target.checked)}
                  />
                  {t('tasks.awayConfirm')}
                </label>
              </Alert>
            )}
          </div>
        </Field>
        <Field label={t('tasks.taskTitle')} required error={form.formState.errors.title?.message}>
          <Input {...form.register('title', { required, minLength: { value: 2, message: required } })} />
        </Field>
        <Field label={t('tasks.description')}>
          <Textarea rows={3} {...form.register('description')} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('tasks.priority')}>
            <Select {...form.register('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`tasks.priorities.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.startAt')}>
            <Input type="datetime-local" dir="ltr" {...form.register('startAt')} />
          </Field>
          <Field label={t('tasks.dueAt')} error={form.formState.errors.dueAt?.message}>
            <Input type="datetime-local" dir="ltr" {...form.register('dueAt')} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('tasks.sourceType')}>
            <Select {...form.register('sourceType')}>
              <option value="">—</option>
              {TASK_SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`tasks.sources.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.sourceId')} hint={t('tasks.sourceHint')}>
            <Input dir="ltr" {...form.register('sourceId')} />
          </Field>
        </div>
        <Field label={t('requests.attachments')}>
          <div className="space-y-1">
            <FileUploader onUploaded={(a) => setAttachments((s) => [...s, a])} />
            {attachments.map((a) => (
              <div key={a.attachmentId} className="flex items-center gap-1 text-xs text-slate-600">
                <Paperclip className="size-3" aria-hidden /> {a.fileName}
              </div>
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            {assigneeId ? t('tasks.assign') : t('tasks.addToQueue')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
