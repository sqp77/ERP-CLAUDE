import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Paperclip } from 'lucide-react';
import { post } from '@/lib/api';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';
import { useReportTypes, type ReportRequestRow } from './_data';

interface F {
  type: string;
  title: string;
  periodFrom?: string;
  periodTo?: string;
  body: string;
}

/** "رفع تقرير" [EP §14.2]: type, title, period, details, files; the date and the manager come from the system. */
export function NewReportDialog({ open, onClose, answering }: { open: boolean; onClose: () => void; answering?: ReportRequestRow | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const types = useReportTypes();
  const [attachments, setAttachments] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const form = useForm<F>({ defaultValues: { type: 'weekly' } });
  useEffect(() => {
    if (open) form.reset({ type: answering?.type ?? 'weekly', title: answering?.note ?? '' });
  }, [open, answering, form]);
  const required = t('common.requiredField');
  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      const r = await post<{ _id: string }>('/hr/employee-reports', {
        type: v.type,
        title: v.title,
        periodFrom: v.periodFrom || null,
        periodTo: v.periodTo || null,
        body: v.body,
        attachmentIds: attachments.map((a) => a.attachmentId),
        requestId: answering?._id,
      });
      toast(t('reports.submitted'));
      qc.invalidateQueries({ queryKey: ['reports'] });
      setAttachments([]);
      onClose();
      nav(`/reports/${r._id}`);
    } catch (e) {
      for (const [name, message] of Object.entries(fieldErrorsFrom(e))) form.setError(name as keyof F, { type: 'server', message });
      setError(errorMessage(e));
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('reports.new')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        {answering && <Alert kind="info">{t('reports.answering', { manager: answering.managerName ?? '' })}</Alert>}
        <Field label={t('reports.type')} required>
          <Select {...form.register('type', { required })}>
            {types.data?.items.map((x) => (
              <option key={x.code} value={x.code}>
                {x.labelAr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('reports.reportTitle')} required error={form.formState.errors.title?.message}>
          <Input {...form.register('title', { required, minLength: { value: 2, message: required } })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('reports.periodFrom')} error={form.formState.errors.periodFrom?.message}>
            <Input type="date" dir="ltr" {...form.register('periodFrom')} />
          </Field>
          <Field label={t('reports.periodTo')} error={form.formState.errors.periodTo?.message}>
            <Input type="date" dir="ltr" {...form.register('periodTo')} />
          </Field>
        </div>
        <Field label={t('reports.body')} required error={form.formState.errors.body?.message}>
          <Textarea rows={8} {...form.register('body', { required, minLength: { value: 2, message: required } })} />
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
            {t('reports.send')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
