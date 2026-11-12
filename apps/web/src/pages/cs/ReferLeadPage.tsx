import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { post } from '@/lib/api';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Textarea,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';
import { leadTone, useCrmMeta, useLeads } from '../sales/_data';

type F = Record<string, string>;

/**
 * «إحالة عميل محتمل إلى المبيعات» [SAL §3, §8.1; CS §6.8]: a small form for Customer Service users; the full unified inbox
 * comes with the CS module. Below it, the agent's own referrals and what Sales did with them.
 */
export function ReferLeadPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { formatDateTime } = usePrefs();
  const meta = useCrmMeta();
  const mine = useLeads({ view: 'referred', limit: 100 });
  const [atts, setAtts] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const form = useForm<F>({ defaultValues: { targetDepartment: 'sales' } });
  const required = t('common.requiredField');
  const err = (k: string) => form.formState.errors[k]?.message as string | undefined;
  const m = useMutation({
    mutationFn: (v: F) =>
      post('/crm/leads', {
        customerName: v.customerName,
        contactName: v.contactName || undefined,
        phone: v.phone || undefined,
        email: v.email || undefined,
        interest: v.interest,
        channel: v.channel || undefined,
        notes: v.notes || undefined,
        targetDepartment: v.targetDepartment,
        attachmentIds: atts.map((a) => a.attachmentId),
      }),
    onSuccess: () => {
      toast(t('cs.referLead.sent'));
      form.reset({ targetDepartment: 'sales' });
      setAtts([]);
      setError(undefined);
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] });
    },
    onError: (e) => {
      for (const [name, message] of Object.entries(fieldErrorsFrom(e)))
        form.setError(name, { type: 'server', message });
      setError(errorMessage(e));
    },
  });
  if (meta.data && !meta.data.canReferLeads)
    return <Alert kind="warning">{t('cs.referLead.notAllowed')}</Alert>;
  return (
    <>
      <PageHeader title={t('cs.referLead.title')} subtitle={t('cs.referLead.subtitle')} />
      <div className="grid gap-3 lg:grid-cols-[420px_1fr]">
        <Card>
          <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-3" noValidate>
            {error && <Alert kind="error">{error}</Alert>}
            <Field label={t('sales.leads.customerName')} required error={err('customerName')}>
              <Input {...form.register('customerName', { required })} />
            </Field>
            <Field label={t('sales.leads.interest')} required error={err('interest')}>
              <Textarea {...form.register('interest', { required })} rows={2} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('sales.contacts.name')}>
                <Input {...form.register('contactName')} />
              </Field>
              <Field label={t('sales.customers.phone')} error={err('phone')}>
                <Input {...form.register('phone')} inputMode="tel" dir="ltr" />
              </Field>
              <Field label={t('sales.customers.email')} error={err('email')}>
                <Input {...form.register('email')} type="email" dir="ltr" />
              </Field>
              <Field label={t('sales.leads.channel')}>
                <Input {...form.register('channel')} />
              </Field>
              <Field label={t('cs.referLead.target')}>
                <Select {...form.register('targetDepartment')}>
                  <option value="sales">{t('cs.referLead.targets.sales')}</option>
                  <option value="sustainability">{t('cs.referLead.targets.sustainability')}</option>
                </Select>
              </Field>
            </div>
            <Field label={t('sales.customers.notes')}>
              <Textarea {...form.register('notes')} rows={2} />
            </Field>
            <FileUploader onUploaded={(r) => setAtts((a) => [...a, r])} label={t('sales.log.attach')} />
            {atts.map((a) => (
              <div key={a.attachmentId} className="text-xs text-slate-600">
                {a.fileName}
              </div>
            ))}
            <Button type="submit" className="w-full" loading={m.isPending}>
              {t('cs.referLead.submit')}
            </Button>
          </form>
        </Card>
        <Card title={t('cs.referLead.mine')}>
          {mine.isError ? (
            <QueryError error={mine.error} onRetry={() => mine.refetch()} />
          ) : mine.isLoading ? (
            <Spinner />
          ) : !mine.data?.items.length ? (
            <EmptyState title={t('sales.leads.empty')} />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {mine.data.items.map((l) => (
                <li key={l._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="text-xs text-slate-500 tabular">{l.number}</span>{' '}
                    <span className="font-medium">{l.customerName}</span>
                    <span className="text-slate-500"> — {l.interest}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 tabular">{formatDateTime(l.referredAt)}</span>
                    {l.assigneeName && <span>{l.assigneeName}</span>}
                    <Badge tone={leadTone[l.state]}>{t(`sales.leadStates.${l.state}`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
