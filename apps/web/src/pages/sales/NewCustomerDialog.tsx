import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { CUSTOMER_SOURCES, CUSTOMER_STATUSES, SALES_SERVICE_TYPES } from '@eayni/shared';
import { post } from '@/lib/api';
import { localInputToIso } from '@/lib/dates';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { useCrmMeta, useSalesTags, useSalesTeam } from './_data';

type F = Record<string, string>;
interface Dup {
  duplicate: boolean;
  hard: boolean;
  visible: { id: string; number: string; nameAr: string; ownerName: string; hard: boolean }[];
  hiddenCount: number;
  message?: string;
}

/**
 * «عميل جديد / فرصة بيعية جديدة» [SAL §4.1]: the organization, up to three contact persons, and optionally the first
 * opportunity, in one form. The duplicate check runs before saving and never shows another rep's file (§15, §19).
 */
export function NewCustomerDialog({
  open,
  onClose,
  leadId,
}: {
  open: boolean;
  onClose: () => void;
  leadId?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const meta = useCrmMeta();
  const tags = useSalesTags();
  const manager = (user?.permissions.find((p) => p.resource === 'crm.customers')?.scope ?? 'own') !== 'own';
  const team = useSalesTeam(open && manager);
  const [contacts, setContacts] = useState(1);
  const [withOpportunity, setWithOpportunity] = useState(false);
  const [dup, setDup] = useState<Dup | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<string[]>([]);
  const form = useForm<F>({
    defaultValues: { kind: 'organization', status: 'potential', source: 'direct_contact', country: '' },
  });
  const required = t('common.requiredField');
  const err = (k: string) => form.formState.errors[k]?.message as string | undefined;
  useEffect(() => {
    if (!open) {
      form.reset();
      setContacts(1);
      setWithOpportunity(false);
      setDup(null);
      setConfirmDup(false);
      setPicked([]);
      setError(undefined);
    }
  }, [open, form]);

  const checkDuplicate = async () => {
    const v = form.getValues();
    if (!v.nameAr || v.nameAr.trim().length < 2) return;
    const r = await post<Dup>('/crm/customers/check-duplicate', {
      nameAr: v.nameAr,
      phone: v.phone || undefined,
      crNumber: v.crNumber || undefined,
      unifiedNumber: v.unifiedNumber || undefined,
    });
    setDup(r.duplicate ? r : null);
  };

  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    const list = Array.from({ length: contacts }, (_, i) => i)
      .map((i) => ({
        nameAr: v[`c${i}_name`],
        jobTitle: v[`c${i}_title`] || undefined,
        phone: v[`c${i}_phone`] || undefined,
        email: v[`c${i}_email`] || undefined,
        notes: v[`c${i}_notes`] || undefined,
      }))
      .filter((c) => c.nameAr);
    try {
      const r = await post<{ _id: string }>('/crm/customers', {
        kind: v.kind,
        nameAr: v.nameAr,
        country: v.country || undefined,
        region: v.region || undefined,
        city: v.city || undefined,
        activity: v.activity || undefined,
        organizationType: v.organizationType || undefined,
        facilitySize: v.facilitySize || undefined,
        source: v.source,
        sourceNote: v.sourceNote || undefined,
        status: v.status,
        phone: v.phone || undefined,
        email: v.email || undefined,
        crNumber: v.crNumber || undefined,
        unifiedNumber: v.unifiedNumber || undefined,
        vatNumber: v.vatNumber || undefined,
        nationalAddress: v.nationalAddress || undefined,
        notes: v.notes || undefined,
        tags: picked,
        ownerUserId: manager && v.ownerUserId ? v.ownerUserId : undefined,
        leadId,
        confirmDuplicateName: confirmDup || undefined,
        contacts: list,
        opportunity: withOpportunity
          ? {
              title: v.oppTitle,
              serviceType: v.oppService || undefined,
              expectedValueHalalas: v.oppValue ? Math.round(Number(v.oppValue) * 100) : undefined,
              nextFollowUpAt: localInputToIso(v.oppFollowUp),
            }
          : undefined,
      });
      toast(t('sales.customers.created'));
      qc.invalidateQueries({ queryKey: ['crm'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      onClose();
      nav(`/sales/customers/${r._id}`);
    } catch (e) {
      for (const [name, message] of Object.entries(fieldErrorsFrom(e)))
        form.setError(name, { type: 'server', message });
      setError(errorMessage(e));
    }
  });

  const toggleTag = (name: string) =>
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));

  return (
    <Dialog open={open} onClose={onClose} title={t('sales.newCustomer')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">{t('sales.customers.sectionOrg')}</h3>
          <Field label={t('sales.customers.nameAr')} required error={err('nameAr')}>
            <Input
              {...form.register('nameAr', { required, minLength: { value: 2, message: required } })}
              onBlur={checkDuplicate}
              autoFocus
            />
          </Field>
          {dup && (
            <Alert kind={dup.hard ? 'error' : 'warning'}>
              <div className="space-y-1">
                {dup.visible.map((d) => (
                  <div key={d.id}>
                    {t('sales.customers.dupVisible', {
                      number: d.number,
                      name: d.nameAr,
                      owner: d.ownerName,
                    })}
                  </div>
                ))}
                {dup.hiddenCount > 0 && <div>{t('sales.customers.dupHidden')}</div>}
                {!dup.hard && manager && (
                  <label className="mt-1 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={confirmDup}
                      onChange={(e) => setConfirmDup(e.target.checked)}
                    />{' '}
                    {t('sales.customers.dupConfirm')}
                  </label>
                )}
              </div>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('sales.customers.kind')}>
              <Select {...form.register('kind')}>
                <option value="organization">{t('sales.customers.kinds.organization')}</option>
                <option value="individual">{t('sales.customers.kinds.individual')}</option>
              </Select>
            </Field>
            <Field label={t('sales.customers.source')} required>
              <Select {...form.register('source', { required })}>
                {CUSTOMER_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sales.sources.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('sales.customers.country')}>
              <Input {...form.register('country')} />
            </Field>
            <Field label={t('sales.customers.region')}>
              <Input {...form.register('region')} />
            </Field>
            <Field label={t('sales.customers.city')}>
              <Input {...form.register('city')} />
            </Field>
            <Field label={t('sales.customers.activity')}>
              <Input {...form.register('activity')} />
            </Field>
            <Field label={t('sales.customers.organizationType')}>
              <Select {...form.register('organizationType')}>
                <option value="">—</option>
                {meta.data?.organizationTypes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('sales.customers.facilitySize')} hint={t('sales.provisionalList')}>
              <Select {...form.register('facilitySize')}>
                <option value="">—</option>
                {meta.data?.facilitySizes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('sales.customers.phone')} error={err('phone')}>
              <Input {...form.register('phone')} inputMode="tel" dir="ltr" onBlur={checkDuplicate} />
            </Field>
            <Field label={t('sales.customers.email')} error={err('email')}>
              <Input {...form.register('email')} type="email" dir="ltr" />
            </Field>
            <Field label={t('sales.customers.status')}>
              <Select {...form.register('status')}>
                {CUSTOMER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sales.statuses.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {manager && (
              <Field label={t('sales.customers.owner')}>
                <Select {...form.register('ownerUserId')}>
                  <option value="">{t('sales.customers.ownerMe')}</option>
                  {team.data?.items.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.fullNameAr}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t('sales.customers.legalSection')}
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={t('sales.customers.crNumber')} error={err('crNumber')}>
                <Input {...form.register('crNumber')} dir="ltr" inputMode="numeric" onBlur={checkDuplicate} />
              </Field>
              <Field label={t('sales.customers.unifiedNumber')} error={err('unifiedNumber')}>
                <Input
                  {...form.register('unifiedNumber')}
                  dir="ltr"
                  inputMode="numeric"
                  onBlur={checkDuplicate}
                />
              </Field>
              <Field label={t('sales.customers.vatNumber')} error={err('vatNumber')}>
                <Input {...form.register('vatNumber')} dir="ltr" inputMode="numeric" />
              </Field>
              <Field label={t('sales.customers.nationalAddress')}>
                <Input {...form.register('nationalAddress')} />
              </Field>
            </div>
          </details>
          {!!tags.data?.items.length && (
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">{t('sales.tags.title')}</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.data.items.map((tag) => (
                  <button
                    key={tag._id}
                    type="button"
                    onClick={() => toggleTag(tag.name)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${picked.includes(tag.name) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{t('sales.customers.sectionContacts')}</h3>
            {contacts < 3 && (
              <Button type="button" variant="secondary" onClick={() => setContacts((c) => c + 1)}>
                {t('sales.contacts.add')}
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">{t('sales.contacts.maxHint')}</p>
          {Array.from({ length: contacts }, (_, i) => (
            <div key={i} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
              <Field label={t('sales.contacts.name')}>
                <Input {...form.register(`c${i}_name`)} />
              </Field>
              <Field label={t('sales.contacts.jobTitle')}>
                <Input {...form.register(`c${i}_title`)} />
              </Field>
              <Field label={t('sales.contacts.phone')}>
                <Input {...form.register(`c${i}_phone`)} inputMode="tel" dir="ltr" />
              </Field>
              <Field label={t('sales.contacts.email')}>
                <Input {...form.register(`c${i}_email`)} type="email" dir="ltr" />
              </Field>
              <div className="col-span-2">
                <Field label={t('sales.contacts.notes')}>
                  <Input {...form.register(`c${i}_notes`)} />
                </Field>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={withOpportunity}
              onChange={(e) => setWithOpportunity(e.target.checked)}
            />
            {t('sales.customers.sectionOpportunity')}
          </label>
          {withOpportunity && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label={t('sales.opportunities.title')} required error={err('oppTitle')}>
                  <Input {...form.register('oppTitle', { required })} />
                </Field>
              </div>
              <Field label={t('sales.opportunities.serviceType')}>
                <Select {...form.register('oppService')}>
                  <option value="">—</option>
                  {SALES_SERVICE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`sales.services.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('sales.opportunities.expectedValue')}>
                <Input {...form.register('oppValue')} type="number" min={0} step="0.01" dir="ltr" />
              </Field>
              <Field label={t('sales.opportunities.nextFollowUp')}>
                <Input {...form.register('oppFollowUp')} type="datetime-local" dir="ltr" />
              </Field>
            </div>
          )}
        </section>
        <Field label={t('sales.customers.notes')}>
          <Textarea {...form.register('notes')} rows={2} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!!dup?.hard}>
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
