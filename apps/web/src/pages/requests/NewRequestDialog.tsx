import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HR_REQUEST_TYPES, LEAVE_TYPES, type HrRequestType } from '@eayni/shared';
import { get, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';

type F = Record<string, string | boolean>;

interface TypeInfo {
  type: HrRequestType;
  labelAr: string;
  route: { viaManager: boolean; finalApprover: string };
}

/** "رفع طلب" [EP §11]: one form, fields switch per type exactly as HR §3.5 lists them. */
export function NewRequestDialog({
  open,
  onClose,
  initialType,
}: {
  open: boolean;
  onClose: () => void;
  initialType?: HrRequestType;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ['hr-request-types'],
    queryFn: () => get<{ items: TypeInfo[]; advanceLimitHalalas: number | null }>('/hr/requests/types'),
    enabled: open,
  });
  const [type, setType] = useState<HrRequestType>(initialType ?? 'leave');
  const [attachments, setAttachments] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const form = useForm<F>({
    defaultValues: { leaveType: 'annual', detailed: false, chamberAttestation: false },
  });
  const info = types.data?.items.find((i) => i.type === type);

  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    const details: Record<string, unknown> = {};
    switch (type) {
      case 'leave':
        Object.assign(details, {
          leaveType: v.leaveType,
          startDate: v.startDate,
          endDate: v.endDate,
          reason: v.reason,
        });
        break;
      case 'permission':
        Object.assign(details, {
          date: v.date,
          startTime: v.startTime,
          endTime: v.endTime,
          reason: v.reason,
        });
        break;
      case 'remote_work':
        Object.assign(details, { startDate: v.startDate, days: Number(v.days), reason: v.reason });
        break;
      case 'salary_certificate':
        Object.assign(details, {
          addressedTo: v.addressedTo,
          purpose: v.purpose,
          detailed: !!v.detailed,
          chamberAttestation: !!v.chamberAttestation,
        });
        break;
      case 'experience_certificate':
        Object.assign(details, { purpose: v.purpose });
        break;
      case 'advance':
        Object.assign(details, {
          amountHalalas: Math.round(Number(v.amount) * 100),
          reason: v.reason,
          notes: v.notes || undefined,
        });
        break;
      case 'data_update':
        Object.assign(details, {
          changes: [{ field: v.field, currentValue: v.currentValue || undefined, newValue: v.newValue }],
          reason: v.reason || undefined,
        });
        break;
      case 'official_letter':
        Object.assign(details, { letterType: v.letterType, addressedTo: v.addressedTo, purpose: v.purpose });
        break;
    }
    try {
      await post('/hr/requests', {
        type,
        details,
        attachmentIds: attachments.map((a) => a.attachmentId),
        notes: v.generalNotes || undefined,
      });
      toast(t('requests.submitted'));
      qc.invalidateQueries({ queryKey: ['hr-requests'] });
      form.reset();
      setAttachments([]);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const text = (name: string, label: string, required = true, props: Record<string, unknown> = {}) => (
    <Field label={label} required={required}>
      <Input {...props} {...form.register(name, { required })} />
    </Field>
  );
  const reason = (name = 'reason', label = t('requests.fields.reason')) => (
    <Field label={label} required>
      <Textarea rows={2} {...form.register(name, { required: true, minLength: 2 })} />
    </Field>
  );

  return (
    <Dialog open={open} onClose={onClose} title={t('requests.new')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('requests.type')}>
          <Select value={type} onChange={(e) => setType(e.target.value as HrRequestType)}>
            {HR_REQUEST_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`requests.types.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        {info && (
          <p className="text-xs text-slate-500">
            {info.route.viaManager ? t('requests.routeViaManager') : t('requests.routeDirectHr')}
            {info.route.finalApprover === 'hr_then_finance' && ` · ${t('requests.routeThenFinance')}`}
          </p>
        )}

        {type === 'leave' && (
          <>
            <Field label={t('requests.fields.leaveType')}>
              <Select {...form.register('leaveType')}>
                {LEAVE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`requests.leaveTypes.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              {text('startDate', t('requests.fields.startDate'), true, { type: 'date', dir: 'ltr' })}
              {text('endDate', t('requests.fields.endDate'), true, { type: 'date', dir: 'ltr' })}
            </div>
            {reason()}
          </>
        )}
        {type === 'permission' && (
          <>
            {text('date', t('common.date'), true, { type: 'date', dir: 'ltr' })}
            <div className="grid grid-cols-2 gap-3">
              {text('startTime', t('requests.fields.startTime'), true, { type: 'time', dir: 'ltr' })}
              {text('endTime', t('requests.fields.endTime'), true, { type: 'time', dir: 'ltr' })}
            </div>
            {reason()}
          </>
        )}
        {type === 'remote_work' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {text('startDate', t('requests.fields.startDate'), true, { type: 'date', dir: 'ltr' })}
              {text('days', t('requests.fields.days'), true, { type: 'number', min: 1, dir: 'ltr' })}
            </div>
            {reason()}
          </>
        )}
        {type === 'salary_certificate' && (
          <>
            {text('addressedTo', t('requests.fields.addressedTo'))}
            {text('purpose', t('requests.fields.purpose'))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('detailed')} /> {t('requests.fields.detailed')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('chamberAttestation')} />{' '}
              {t('requests.fields.chamberAttestation')}
            </label>
          </>
        )}
        {type === 'experience_certificate' && text('purpose', t('requests.fields.purpose'))}
        {type === 'advance' && (
          <>
            {text('amount', t('requests.fields.amount'), true, {
              type: 'number',
              min: 1,
              step: '0.01',
              dir: 'ltr',
            })}
            {types.data?.advanceLimitHalalas === null && (
              <Alert kind="info">{t('requests.advanceLimitUnset')}</Alert>
            )}
            {reason()}
            <Field label={t('hr.notes')}>
              <Textarea rows={2} {...form.register('notes')} />
            </Field>
          </>
        )}
        {type === 'data_update' && (
          <>
            {text('field', t('requests.fields.field'))}
            {text('currentValue', t('requests.fields.currentValue'), false)}
            {text('newValue', t('requests.fields.newValue'))}
            <Field label={t('requests.fields.reason')}>
              <Textarea rows={2} {...form.register('reason')} />
            </Field>
          </>
        )}
        {type === 'official_letter' && (
          <>
            {text('letterType', t('requests.fields.letterType'))}
            {text('addressedTo', t('requests.fields.addressedTo'))}
            {text('purpose', t('requests.fields.purpose'))}
          </>
        )}

        <Field label={t('requests.attachments')} hint={t('requests.attachmentsHint')}>
          <div className="space-y-1">
            <FileUploader onUploaded={(a) => setAttachments((s) => [...s, a])} />
            {attachments.map((a) => (
              <div key={a.attachmentId} className="text-xs text-slate-600">
                📎 {a.fileName}
              </div>
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            {t('requests.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
