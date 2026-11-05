import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Paperclip } from 'lucide-react';
import { PRIORITIES, TICKET_TYPES } from '@eayni/shared';
import { post } from '@/lib/api';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';
import { priorityLabel, useTicketTargets } from './_data';

type F = Record<string, string>;

/** "رفع تذكرة" [EP §9.3]: target department, type, subject, details, priority, attachments, plus the department's own fields. */
export function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const targets = useTicketTargets(open);
  const [attachments, setAttachments] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const form = useForm<F>({ defaultValues: { type: 'request', priority: 'medium' } });
  const departmentCode = form.watch('departmentCode');
  const target = targets.data?.items.find((x) => x.code === departmentCode);
  const required = t('common.requiredField');
  const err = (k: string) => form.formState.errors[k]?.message as string | undefined;

  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    const fields: Record<string, string> = {};
    for (const f of target?.config.fields ?? []) if (v[`f_${f.key}`]) fields[f.key] = v[`f_${f.key}`];
    try {
      const r = await post<{ _id: string }>('/tickets', {
        departmentCode: v.departmentCode,
        type: v.type,
        subject: v.subject,
        body: v.body,
        priority: v.priority,
        fields,
        attachmentIds: attachments.map((a) => a.attachmentId),
      });
      toast(t('tickets.submitted'));
      qc.invalidateQueries({ queryKey: ['tickets'] });
      form.reset({ type: 'request', priority: 'medium' });
      setAttachments([]);
      onClose();
      nav(`/tickets/${r._id}`);
    } catch (e) {
      for (const [name, message] of Object.entries(fieldErrorsFrom(e))) form.setError(`f_${name}`, { type: 'server', message });
      setError(errorMessage(e));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('tickets.new')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('tickets.department')} required error={err('departmentCode')}>
          <Select {...form.register('departmentCode', { required })}>
            <option value="">—</option>
            {targets.data?.items.map((x) => (
              <option key={x.code} value={x.code}>
                {x.nameAr}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('tickets.type')}>
            <Select {...form.register('type')}>
              {TICKET_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`tickets.types.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.priority')}>
            <Select {...form.register('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(t, p, target?.config)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {target?.config.fields.map((f) => (
          <Field key={f.key} label={f.labelAr} required={f.required} error={err(`f_${f.key}`)}>
            {f.type === 'select' ? (
              <Select {...form.register(`f_${f.key}`, { required: f.required ? required : false })}>
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.labelAr}
                  </option>
                ))}
              </Select>
            ) : (
              <Input {...form.register(`f_${f.key}`, { required: f.required ? required : false })} />
            )}
          </Field>
        ))}
        <Field label={t('tickets.subject')} required error={err('subject')}>
          <Input {...form.register('subject', { required, minLength: { value: 2, message: required } })} />
        </Field>
        <Field label={t('tickets.body')} required error={err('body')}>
          <Textarea rows={4} {...form.register('body', { required, minLength: { value: 2, message: required } })} />
        </Field>
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
            {t('tickets.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
