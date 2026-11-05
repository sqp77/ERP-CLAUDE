import type { ReactNode } from 'react';
import type { FieldErrors, UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { LEAVE_TYPES, type HrRequestType } from '@eayni/shared';
import { Alert, Field, Input, Select, Textarea } from '@/shared/ui';

/** Flat form values for every request type; `detailsFromForm` / `formFromDetails` map to the API shape. */
export type RequestFormValues = Record<string, string | boolean>;

/** Form values → `details` as HR §3.5 lists them per type (shared by "new" and "resubmit", review C19). */
export function detailsFromForm(type: HrRequestType, v: RequestFormValues): Record<string, unknown> {
  const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  switch (type) {
    case 'leave':
      return {
        leaveType: s('leaveType'),
        startDate: s('startDate'),
        endDate: s('endDate'),
        reason: s('reason'),
      };
    case 'permission':
      return { date: s('date'), startTime: s('startTime'), endTime: s('endTime'), reason: s('reason') };
    case 'remote_work':
      return { startDate: s('startDate'), days: Number(s('days')), reason: s('reason') };
    case 'salary_certificate':
      return {
        addressedTo: s('addressedTo'),
        purpose: s('purpose'),
        detailed: !!v.detailed,
        chamberAttestation: !!v.chamberAttestation,
      };
    case 'experience_certificate':
      return { purpose: s('purpose') };
    case 'advance':
      return {
        amountHalalas: Math.round(Number(s('amount')) * 100),
        reason: s('reason'),
        notes: s('notes') || undefined,
      };
    case 'data_update':
      return {
        changes: [
          { field: s('field'), currentValue: s('currentValue') || undefined, newValue: s('newValue') },
        ],
        reason: s('reason') || undefined,
      };
    case 'official_letter':
      return { letterType: s('letterType'), addressedTo: s('addressedTo'), purpose: s('purpose') };
  }
}

/** Stored `details` → form values, for editing a returned request. */
export function formFromDetails(type: HrRequestType, d: Record<string, unknown>): RequestFormValues {
  const out: RequestFormValues = {};
  const str = (k: string) => (d[k] === undefined || d[k] === null ? '' : String(d[k]));
  const date = (k: string) => (d[k] ? String(d[k]).slice(0, 10) : '');
  switch (type) {
    case 'leave':
      Object.assign(out, {
        leaveType: str('leaveType'),
        startDate: date('startDate'),
        endDate: date('endDate'),
        reason: str('reason'),
      });
      break;
    case 'permission':
      Object.assign(out, {
        date: date('date'),
        startTime: str('startTime'),
        endTime: str('endTime'),
        reason: str('reason'),
      });
      break;
    case 'remote_work':
      Object.assign(out, { startDate: date('startDate'), days: str('days'), reason: str('reason') });
      break;
    case 'salary_certificate':
      Object.assign(out, {
        addressedTo: str('addressedTo'),
        purpose: str('purpose'),
        detailed: !!d.detailed,
        chamberAttestation: !!d.chamberAttestation,
      });
      break;
    case 'experience_certificate':
      out.purpose = str('purpose');
      break;
    case 'advance':
      Object.assign(out, {
        amount: typeof d.amountHalalas === 'number' ? String(d.amountHalalas / 100) : '',
        reason: str('reason'),
        notes: str('notes'),
      });
      break;
    case 'data_update': {
      const c = (Array.isArray(d.changes) ? d.changes[0] : {}) as Record<string, unknown>;
      Object.assign(out, {
        field: c.field ? String(c.field) : '',
        currentValue: c.currentValue ? String(c.currentValue) : '',
        newValue: c.newValue ? String(c.newValue) : '',
        reason: str('reason'),
      });
      break;
    }
    case 'official_letter':
      Object.assign(out, {
        letterType: str('letterType'),
        addressedTo: str('addressedTo'),
        purpose: str('purpose'),
      });
      break;
  }
  return out;
}

const msg = (errors: FieldErrors<RequestFormValues>, name: string): string | undefined => {
  const e = errors[name];
  return e ? (typeof e.message === 'string' && e.message) || undefined : undefined;
};

/** The per-type fields of HR §3.5, with inline validation messages (review C19). */
export function RequestFields({
  type,
  form,
  advanceLimitUnset,
}: {
  type: HrRequestType;
  form: UseFormReturn<RequestFormValues>;
  advanceLimitUnset?: boolean;
}) {
  const { t } = useTranslation();
  const required = t('common.requiredField');
  const errors = form.formState.errors;
  const text = (name: string, label: string, req = true, props: Record<string, unknown> = {}): ReactNode => (
    <Field label={label} required={req} error={msg(errors, name) ?? (errors[name] ? required : undefined)}>
      <Input {...props} {...form.register(name, { required: req ? required : false })} />
    </Field>
  );
  const reason = (name = 'reason', label = t('requests.fields.reason'), req = true) => (
    <Field label={label} required={req} error={msg(errors, name)}>
      <Textarea
        rows={2}
        {...form.register(name, {
          required: req ? required : false,
          minLength: { value: 2, message: t('requests.reasonTooShort') },
        })}
      />
    </Field>
  );
  switch (type) {
    case 'leave':
      return (
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
      );
    case 'permission':
      return (
        <>
          {text('date', t('common.date'), true, { type: 'date', dir: 'ltr' })}
          <div className="grid grid-cols-2 gap-3">
            {text('startTime', t('requests.fields.startTime'), true, { type: 'time', dir: 'ltr' })}
            {text('endTime', t('requests.fields.endTime'), true, { type: 'time', dir: 'ltr' })}
          </div>
          {reason()}
        </>
      );
    case 'remote_work':
      return (
        <>
          <div className="grid grid-cols-2 gap-3">
            {text('startDate', t('requests.fields.startDate'), true, { type: 'date', dir: 'ltr' })}
            {text('days', t('requests.fields.days'), true, { type: 'number', min: 1, dir: 'ltr' })}
          </div>
          {reason()}
        </>
      );
    case 'salary_certificate':
      return (
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
      );
    case 'experience_certificate':
      return text('purpose', t('requests.fields.purpose'));
    case 'advance':
      return (
        <>
          {text('amount', t('requests.fields.amount'), true, {
            type: 'number',
            min: 1,
            step: '0.01',
            dir: 'ltr',
          })}
          {advanceLimitUnset && <Alert kind="info">{t('requests.advanceLimitUnset')}</Alert>}
          {reason()}
          <Field label={t('hr.notes')}>
            <Textarea rows={2} {...form.register('notes')} />
          </Field>
        </>
      );
    case 'data_update':
      return (
        <>
          {text('field', t('requests.fields.field'))}
          {text('currentValue', t('requests.fields.currentValue'), false)}
          {text('newValue', t('requests.fields.newValue'))}
          {reason('reason', t('requests.fields.reason'), false)}
        </>
      );
    case 'official_letter':
      return (
        <>
          {text('letterType', t('requests.fields.letterType'))}
          {text('addressedTo', t('requests.fields.addressedTo'))}
          {text('purpose', t('requests.fields.purpose'))}
        </>
      );
  }
}
