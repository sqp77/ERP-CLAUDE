import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SALES_SERVICE_TYPES, type SalesServiceType } from '@eayni/shared';
import { post } from '@/lib/api';
import { localInputToIso } from '@/lib/dates';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';
import { useCustomers, useSalesTags } from '../_data';
import { SERVICE_FIELDS, useRequestsMeta, type FieldDef } from './_data';

/** One screen per service [SAL §5 «لكل خدمة واجهة مستقلة»]: the service's own fields, the customer, attachments, photos, tags. */
export function NewRequestPage() {
  const { type = '' } = useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const meta = useRequestsMeta();
  const tags = useSalesTags();
  const [customerQ, setCustomerQ] = useState('');
  const customers = useCustomers({ q: customerQ || undefined, limit: 20 });
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [tagValues, setTagValues] = useState<Record<string, string[]>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [atts, setAtts] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [photos, setPhotos] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  if (!(SALES_SERVICE_TYPES as readonly string[]).includes(type))
    return <Alert kind="error">{t('errors.not_found')}</Alert>;
  const svc = type as SalesServiceType;
  const fields = SERVICE_FIELDS[svc];
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const buildDetails = () => {
    const d: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.kind === 'tags') {
        d[f.key] = tagValues[f.key] ?? [];
        continue;
      }
      const v = values[f.key];
      if (v === undefined || v === '') continue;
      if (f.kind === 'number' || f.kind === 'kg') d[f.key] = Number(v);
      else if (f.kind === 'money') d[f.key] = Math.round(Number(v) * 100);
      else if (f.kind === 'date') d[f.key] = new Date(`${v}T09:00:00+03:00`).toISOString();
      else if (f.kind === 'datetime') d[f.key] = localInputToIso(v);
      else d[f.key] = v;
    }
    return d;
  };
  const submit = async () => {
    setSaving(true);
    setError(undefined);
    setErrors({});
    try {
      const r = await post<{ _id: string }>('/sales/requests', {
        type: svc,
        customerId,
        details: buildDetails(),
        attachmentIds: atts.map((a) => a.attachmentId),
        photoIds: photos.map((a) => a.attachmentId),
        tags: picked,
      });
      toast(t('sales.requests.created'));
      nav(`/sales/requests/${r._id}`);
    } catch (e) {
      const fe = fieldErrorsFrom(e);
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^details\./, ''), v])));
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const label = (k: string) => t(`sales.requestFields.${k}`);
  const renderField = (f: FieldDef) => {
    const common = { 'aria-label': label(f.key) };
    const list = f.list ? (meta.data?.lists[f.list] ?? []) : [];
    switch (f.kind) {
      case 'textarea':
        return (
          <Textarea
            rows={3}
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            {...common}
          />
        );
      case 'select':
        return (
          <Select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} {...common}>
            <option value="">—</option>
            {f.options!.map((o) => (
              <option key={o} value={o}>
                {t(`sales.${f.optionLabelKey}.${o}`)}
              </option>
            ))}
          </Select>
        );
      case 'list':
        return list.length ? (
          <Select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} {...common}>
            <option value="">—</option>
            {list.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={t('sales.requests.listEmptyHint')}
            {...common}
          />
        );
      case 'tags':
        return (
          <Input
            value={(tagValues[f.key] ?? []).join(t('common.listSeparator'))}
            onChange={(e) =>
              setTagValues((s) => ({
                ...s,
                [f.key]: e.target.value
                  .split(new RegExp('[\\u060C,]'))
                  .map((x) => x.trim())
                  .filter(Boolean),
              }))
            }
            placeholder={t('sales.requests.commaSeparated')}
            {...common}
          />
        );
      case 'number':
      case 'kg':
        return (
          <Input
            type="number"
            min={0}
            step={1}
            dir="ltr"
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            {...common}
          />
        );
      case 'money':
        return (
          <Input
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            {...common}
          />
        );
      case 'date':
        return (
          <Input
            type="date"
            dir="ltr"
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            {...common}
          />
        );
      case 'datetime':
        return (
          <Input
            type="datetime-local"
            dir="ltr"
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            {...common}
          />
        );
      case 'phone':
        return (
          <Input
            inputMode="tel"
            dir="ltr"
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            {...common}
          />
        );
      default:
        return <Input value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} {...common} />;
    }
  };
  return (
    <>
      <PageHeader title={t(`sales.services.${svc}`)} subtitle={t(`sales.serviceHints.${svc}`)} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (customerId) void submit();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Card title={t('sales.customers.nameAr')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={customerQ}
              onChange={(e) => setCustomerQ(e.target.value)}
              placeholder={t('sales.customers.searchPlaceholder')}
              aria-label={t('actions.search')}
            />
            <Select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              aria-label={t('sales.customers.nameAr')}
              required
            >
              <option value="">—</option>
              {customers.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.number} — {c.nameAr}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-2 text-xs text-slate-500">{t('sales.requests.customerHint')}</p>
        </Card>
        <Card title={t('sales.requests.serviceData')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.kind === 'textarea' ? 'sm:col-span-2' : undefined}>
                <Field
                  label={label(f.key)}
                  required={f.required}
                  error={errors[f.key]}
                  hint={
                    f.kind === 'list' && !(meta.data?.lists[f.list!]?.length ?? 0)
                      ? t('sales.requests.listEmptyHint')
                      : undefined
                  }
                >
                  {renderField(f)}
                </Field>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t('sales.requests.attachments')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <FileUploader
                onUploaded={(r) => setAtts((a) => [...a, r])}
                label={t('sales.requests.attach')}
              />
              {atts.map((a) => (
                <div key={a.attachmentId} className="text-xs text-slate-600">
                  {a.fileName}
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <FileUploader
                onUploaded={(r) => setPhotos((a) => [...a, r])}
                label={t('sales.requests.photos')}
              />
              {photos.map((a) => (
                <div key={a.attachmentId} className="text-xs text-slate-600">
                  {a.fileName}
                </div>
              ))}
            </div>
          </div>
          {!!tags.data?.items.length && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.data.items.map((tag) => (
                <button
                  key={tag._id}
                  type="button"
                  onClick={() =>
                    setPicked((p) =>
                      p.includes(tag.name) ? p.filter((x) => x !== tag.name) : [...p, tag.name],
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(tag.name) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => nav(-1)}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={saving} disabled={!customerId}>
            {t('sales.requests.submit')}
          </Button>
        </div>
      </form>
    </>
  );
}
