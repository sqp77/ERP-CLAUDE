import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { patch, post } from '@/lib/api';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { localInputToIso } from '@/lib/dates';
import { useDepartments } from '@/lib/lookups';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';
import { usePublishableDepartments, type NewsDetail } from './_data';

interface F {
  title: string;
  body: string;
  departmentCode: string;
  audience: 'all' | 'departments';
  audienceDepartmentIds: string[];
  pinned: boolean;
  publishFrom?: string;
  publishTo?: string;
}

/** Publish / edit a news item [EP §12.2]: title, body, publishing department, audience, window, pin, images and files. */
export function NewsEditorDialog({
  open,
  onClose,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  existing?: NewsDetail | null;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const depts = usePublishableDepartments(open);
  const allDepts = useDepartments(true);
  const [attachments, setAttachments] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [cover, setCover] = useState<string | undefined>(existing?.coverAttachmentId ?? undefined);
  const [error, setError] = useState<string>();
  const form = useForm<F>({ defaultValues: { audience: 'all', pinned: false, audienceDepartmentIds: [] } });
  useEffect(() => {
    if (!open) return;
    if (existing) {
      form.reset({
        title: existing.title,
        body: existing.body,
        departmentCode: existing.departmentCode,
        audience: existing.audienceAll ? 'all' : 'departments',
        audienceDepartmentIds: existing.audienceDepartmentIds,
        pinned: existing.pinned,
        publishFrom: existing.publishFrom ? existing.publishFrom.slice(0, 16) : '',
        publishTo: existing.publishTo ? existing.publishTo.slice(0, 16) : '',
      });
      setCover(existing.coverAttachmentId ?? undefined);
    } else {
      form.reset({ audience: 'all', pinned: false, audienceDepartmentIds: [], departmentCode: depts.data?.items[0]?.code });
      setCover(undefined);
    }
    setAttachments([]);
  }, [open, existing, depts.data, form]);
  const audience = form.watch('audience');
  const required = t('common.requiredField');
  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    const body = {
      title: v.title,
      body: v.body,
      departmentCode: v.departmentCode || undefined,
      audienceAll: v.audience === 'all',
      audienceDepartmentIds: v.audience === 'all' ? [] : v.audienceDepartmentIds,
      pinned: v.pinned,
      publishFrom: v.publishFrom ? localInputToIso(v.publishFrom) : null,
      publishTo: v.publishTo ? localInputToIso(v.publishTo) : null,
      attachmentIds: [...(existing?.attachmentIds ?? []), ...attachments.map((a) => a.attachmentId)],
      coverAttachmentId: cover ?? null,
    };
    try {
      const r = existing ? await patch<{ _id: string }>(`/news/${existing._id}`, body) : await post<{ _id: string }>('/news', body);
      toast(t('actions.save'));
      qc.invalidateQueries({ queryKey: ['news'] });
      onSaved(r._id);
      onClose();
    } catch (e) {
      for (const [name, message] of Object.entries(fieldErrorsFrom(e))) form.setError(name as keyof F, { type: 'server', message });
      setError(errorMessage(e));
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title={existing ? t('news.edit') : t('news.new')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('news.titleField')} required error={form.formState.errors.title?.message}>
          <Input {...form.register('title', { required, minLength: { value: 2, message: required } })} />
        </Field>
        <Field label={t('news.publisher')} required>
          <Select {...form.register('departmentCode', { required })}>
            {depts.data?.items.map((d) => (
              <option key={d.code} value={d.code}>
                {d.nameAr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('news.body')} required error={form.formState.errors.body?.message}>
          <Textarea rows={8} {...form.register('body', { required, minLength: { value: 2, message: required } })} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('news.audience')}>
            <Select {...form.register('audience')}>
              <option value="all">{t('news.audienceAll')}</option>
              <option value="departments">{t('news.audienceDepartments')}</option>
            </Select>
          </Field>
          {audience === 'departments' && (
            <Field label={t('news.targetDepartments')}>
              <select multiple className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" {...form.register('audienceDepartmentIds')}>
                {allDepts.data?.items.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.nameAr}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('news.publishFrom')} hint={t('news.windowHint')}>
            <Input type="datetime-local" dir="ltr" {...form.register('publishFrom')} />
          </Field>
          <Field label={t('news.publishTo')}>
            <Input type="datetime-local" dir="ltr" {...form.register('publishTo')} />
          </Field>
          <label className="mt-7 flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('pinned')} /> {t('news.pinned')}
          </label>
        </div>
        <Field label={t('news.cover')} hint={t('news.coverHint')}>
          <FileUploader onUploaded={(a) => setCover(a.attachmentId)} />
          {cover && <div className="text-xs text-emerald-700">{t('news.coverSet')}</div>}
        </Field>
        <Field label={t('news.attachments')}>
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
            {t('news.saveDraft')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
