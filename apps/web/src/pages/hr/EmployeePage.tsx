import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { CONTRACT_TYPES, EMPLOYEE_DOCUMENT_TYPES, EMPLOYEE_STATUSES } from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, patch, post } from '@/lib/api';
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
  cx,
  QueryError,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
import { sar, useHrLookups, type EmployeeFull } from './_data';
import { riyadhToday } from '@/lib/dates';
import { typeLabel, useReportTypes, useReports } from '../reports/_data';

const CUSTODY_CONDITIONS = ['good', 'damaged', 'lost'] as const;
import { statusTone } from './EmployeesPage';

type Tab = 'data' | 'job' | 'contracts' | 'documents' | 'custody' | 'reports';

/** Employee file [HR §3.3]: data, job + history [HR §3.1], contracts [HR §3.9], documents, custody. */
export function EmployeePage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const lk = useHrLookups();
  const [tab, setTab] = useState<Tab>('data');
  const emp = useQuery({
    queryKey: ['employee', id],
    queryFn: () => get<EmployeeFull>(`/hr/employees/${id}`),
  });
  const canEdit = can('hr.employees', 'edit');

  if (emp.isLoading) return <Spinner />;
  if (!emp.data) return <Alert kind="error">{t('common.error')}</Alert>;
  const e = emp.data;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'data', label: t('hr.tabs.data') },
    { key: 'job', label: t('hr.tabs.job') },
    { key: 'contracts', label: t('hr.tabs.contracts') },
    { key: 'documents', label: t('hr.tabs.documents') },
    { key: 'custody', label: t('hr.tabs.custody') },
    { key: 'reports', label: t('hr.tabs.reports') },
  ];
  return (
    <>
      <PageHeader
        title={e.fullNameAr}
        subtitle={`${e.employeeNumber} · ${lk.positionName(e.positionId) || '—'} · ${lk.deptName(e.departmentId)}`}
        actions={
          <>
            <Badge tone={statusTone[e.status]}>{t(`hr.status.${e.status}`)}</Badge>
            <Link to="/hr/employees" className="text-sm text-brand-700 hover:underline">
              {t('actions.back')}
            </Link>
          </>
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setTab(x.key)}
            className={cx(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
              tab === x.key
                ? 'border-brand-700 text-brand-800'
                : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'data' && <DataTab e={e} canEdit={canEdit} />}
      {tab === 'job' && <JobTab e={e} canEdit={canEdit} />}
      {tab === 'contracts' && <ContractsTab e={e} />}
      {tab === 'documents' && <DocumentsTab e={e} />}
      {tab === 'custody' && <CustodyTab e={e} />}
      {tab === 'reports' && <ReportsTab e={e} />}
    </>
  );
}

function Row({ label, value, dir }: { label: string; value?: ReactNode; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd dir={dir} className={cx('text-slate-900', dir === 'ltr' && 'break-all text-start')}>
        {value || '—'}
      </dd>
    </div>
  );
}

/* ---------------- data tab ---------------- */
function DataTab({ e, canEdit }: { e: EmployeeFull; canEdit: boolean }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<string>();
  const form = useForm<Record<string, string>>();
  const openEdit = () => {
    form.reset({
      firstNameAr: e.firstNameAr,
      lastNameAr: e.lastNameAr,
      fullNameEn: e.fullNameEn ?? '',
      nationality: e.nationality,
      religion: e.religion ?? '',
      birthDate: e.birthDate?.slice(0, 10) ?? '',
      identityType: e.identity.type,
      identityNumber: e.identity.number ?? '',
      identityExpiry: e.identity.expiryDate?.slice(0, 10) ?? '',
      workEmail: e.workEmail,
      mobile: e.mobile ?? '',
      extension: e.extension ?? '',
      buildingNo: e.address?.buildingNo ?? '',
      street: e.address?.street ?? '',
      district: e.address?.district ?? '',
      city: e.address?.city ?? '',
      postalCode: e.address?.postalCode ?? '',
      basicSalary: e.basicSalaryHalalas !== undefined ? String(e.basicSalaryHalalas / 100) : '',
      bankName: e.bank?.bankName ?? '',
      iban: e.bank?.iban ?? '',
    });
    setError(undefined);
    setEdit(true);
  };
  const save = form.handleSubmit(async (v) => {
    try {
      const body: Record<string, unknown> = {
        firstNameAr: v.firstNameAr,
        lastNameAr: v.lastNameAr,
        fullNameEn: v.fullNameEn || undefined,
        nationality: v.nationality,
        religion: v.religion || undefined,
        birthDate: v.birthDate || undefined,
        workEmail: v.workEmail,
        mobile: v.mobile || undefined,
        extension: v.extension || undefined,
        address: {
          buildingNo: v.buildingNo,
          street: v.street,
          district: v.district,
          city: v.city,
          postalCode: v.postalCode,
        },
        basicSalaryHalalas: v.basicSalary ? Math.round(Number(v.basicSalary) * 100) : undefined,
      };
      if (v.identityNumber)
        body.identity = {
          type: v.identityType,
          number: v.identityNumber,
          expiryDate: v.identityExpiry || undefined,
        };
      if (v.bankName && v.iban) body.bank = { bankName: v.bankName, iban: v.iban };
      await patch(`/hr/employees/${e._id}`, body);
      qc.invalidateQueries({ queryKey: ['employee', e._id] });
      toast(t('actions.save'));
      setEdit(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title={t('hr.sections.personal')}
        actions={
          canEdit && (
            <Button variant="secondary" onClick={openEdit}>
              {t('actions.edit')}
            </Button>
          )
        }
      >
        <dl>
          <Row label={t('common.name')} value={e.fullNameAr} />
          <Row label="Name (EN)" value={e.fullNameEn} dir="ltr" />
          <Row label={t('hr.gender')} value={t(`hr.genders.${e.gender}`)} />
          <Row label={t('hr.birthDate')} value={e.birthDate ? formatDate(e.birthDate) : undefined} />
          <Row label={t('hr.nationality')} value={e.nationality} />
          <Row label={t('hr.religion')} value={e.religion} />
        </dl>
      </Card>
      <Card title={t('hr.sections.identity')}>
        <dl>
          <Row label={t('hr.identityType')} value={t(`hr.identityTypes.${e.identity.type}`)} />
          <Row
            label={t('hr.identityNumber')}
            value={e.identity.number ?? e.identity.numberMasked}
            dir="ltr"
          />
          <Row
            label={t('hr.identityExpiry')}
            value={e.identity.expiryDate ? formatDate(e.identity.expiryDate) : undefined}
          />
        </dl>
      </Card>
      <Card title={t('hr.sections.contact')}>
        <dl>
          <Row label={t('auth.email')} value={e.workEmail} dir="ltr" />
          <Row label={t('hr.extension')} value={e.extension} dir="ltr" />
          <Row label={t('hr.mobile')} value={e.mobile} dir="ltr" />
          <Row
            label={t('hr.address')}
            value={
              e.address
                ? [
                    e.address.buildingNo,
                    e.address.street,
                    e.address.district,
                    e.address.city,
                    e.address.postalCode,
                  ]
                    .filter(Boolean)
                    .join(t('common.listSeparator'))
                : undefined
            }
          />
        </dl>
      </Card>
      <Card title={t('hr.sections.financial')}>
        <dl>
          <Row
            label={t('hr.basicSalary')}
            value={e.basicSalaryHalalas !== undefined ? sar(e.basicSalaryHalalas) : t('hr.restricted')}
          />
          <Row
            label={t('hr.allowances')}
            value={
              e.allowances?.length
                ? e.allowances
                    .map((a) => `${a.type}: ${sar(a.amountHalalas)}`)
                    .join(t('common.listSeparator'))
                : undefined
            }
          />
          <Row label={t('hr.bank')} value={e.bank?.bankName} />
          <Row label={t('hr.iban')} value={e.bank?.iban ?? e.bank?.ibanMasked} dir="ltr" />
          <Row
            label={t('hr.medicalInsurance')}
            value={e.medicalInsurance ? t('common.yes') : t('common.no')}
          />
        </dl>
      </Card>
      <Dialog open={edit} onClose={() => setEdit(false)} title={t('actions.edit')}>
        <form onSubmit={save} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hr.firstName')}>
              <Input {...form.register('firstNameAr')} />
            </Field>
            <Field label={t('hr.lastName')}>
              <Input {...form.register('lastNameAr')} />
            </Field>
            <Field label="Name (EN)">
              <Input dir="ltr" {...form.register('fullNameEn')} />
            </Field>
            <Field label={t('hr.nationality')}>
              <Input {...form.register('nationality')} />
            </Field>
            <Field label={t('hr.religion')}>
              <Input {...form.register('religion')} />
            </Field>
            <Field label={t('hr.birthDate')}>
              <Input type="date" dir="ltr" {...form.register('birthDate')} />
            </Field>
            <Field label={t('hr.identityNumber')}>
              <Input dir="ltr" {...form.register('identityNumber')} />
            </Field>
            <Field label={t('hr.identityExpiry')}>
              <Input type="date" dir="ltr" {...form.register('identityExpiry')} />
            </Field>
            <Field label={t('auth.email')}>
              <Input type="email" dir="ltr" {...form.register('workEmail')} />
            </Field>
            <Field label={t('hr.mobile')}>
              <Input dir="ltr" {...form.register('mobile')} />
            </Field>
            <Field label={t('hr.extension')}>
              <Input dir="ltr" {...form.register('extension')} />
            </Field>
            <Field label={t('hr.basicSalary')}>
              <Input dir="ltr" inputMode="decimal" {...form.register('basicSalary')} />
            </Field>
            <Field label={t('hr.bank')}>
              <Input {...form.register('bankName')} />
            </Field>
            <Field label={t('hr.iban')}>
              <Input dir="ltr" {...form.register('iban')} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('hr.addressFields.buildingNo')}>
              <Input dir="ltr" {...form.register('buildingNo')} />
            </Field>
            <Field label={t('hr.addressFields.street')}>
              <Input {...form.register('street')} />
            </Field>
            <Field label={t('hr.addressFields.district')}>
              <Input {...form.register('district')} />
            </Field>
            <Field label={t('hr.addressFields.city')}>
              <Input {...form.register('city')} />
            </Field>
            <Field label={t('hr.addressFields.postalCode')}>
              <Input dir="ltr" {...form.register('postalCode')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEdit(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/* ---------------- job tab ---------------- */
interface HistoryRow {
  _id: string;
  type: string;
  from?: Record<string, unknown>;
  to?: Record<string, unknown>;
  changedFields: string[];
  effectiveDate?: string;
  reason?: string;
  actorEmail?: string;
  at: string;
}

function JobTab({ e, canEdit }: { e: EmployeeFull; canEdit: boolean }) {
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const lk = useHrLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const history = useQuery({
    queryKey: ['employee', e._id, 'history'],
    queryFn: () => get<{ items: HistoryRow[] }>(`/hr/employees/${e._id}/history`),
  });
  const [dialog, setDialog] = useState<'transfer' | 'promote' | 'manager' | 'status' | null>(null);
  const [error, setError] = useState<string>();
  const form = useForm<Record<string, string>>();
  const act = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      const body: Record<string, unknown> = { effectiveDate: v.effectiveDate, reason: v.reason };
      if (dialog === 'transfer')
        Object.assign(body, {
          departmentId: v.departmentId,
          unitId: v.unitId || null,
          branchId: v.branchId || null,
          directManagerId: v.directManagerId || null,
        });
      if (dialog === 'promote')
        Object.assign(body, {
          positionId: v.positionId,
          grade: v.grade || undefined,
          basicSalaryHalalas: v.basicSalary ? Math.round(Number(v.basicSalary) * 100) : undefined,
        });
      if (dialog === 'manager') Object.assign(body, { directManagerId: v.directManagerId || null });
      if (dialog === 'status')
        Object.assign(body, {
          status: v.status,
          secondment:
            v.status === 'seconded'
              ? { destination: v.destination, startDate: v.startDate, endDate: v.endDate }
              : undefined,
        });
      await post(`/hr/employees/${e._id}/${dialog}`, body);
      qc.invalidateQueries({ queryKey: ['employee', e._id] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      toast(t('actions.save'));
      setDialog(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  const open = (d: typeof dialog) => {
    form.reset({
      effectiveDate: riyadhToday(),
      departmentId: e.departmentId,
      unitId: e.unitId ?? '',
      branchId: e.branchId ?? '',
      directManagerId: e.directManagerId ?? '',
      positionId: e.positionId ?? '',
      grade: e.grade ?? '',
      status: e.status,
    });
    setError(undefined);
    setDialog(d);
  };
  const describe = (h: HistoryRow) => {
    const name = (k: string, v: unknown) =>
      k === 'departmentId'
        ? lk.deptName(String(v))
        : k === 'positionId'
          ? lk.positionName(String(v))
          : k === 'directManagerId'
            ? lk.employeeName(String(v))
            : k === 'status'
              ? t(`hr.status.${v}`)
              : k === 'basicSalaryHalalas'
                ? sar(Number(v))
                : String(v ?? '—');
    const keys = ['departmentId', 'positionId', 'directManagerId', 'status', 'grade', 'basicSalaryHalalas'];
    return keys
      .filter((k) => h.from?.[k] !== undefined || h.to?.[k] !== undefined)
      .filter((k) => JSON.stringify(h.from?.[k]) !== JSON.stringify(h.to?.[k]))
      .map((k) => `${t(`hr.fields.${k}`)}: ${name(k, h.from?.[k])} ← ${name(k, h.to?.[k])}`)
      .join(' · ');
  };
  const selectOf = (
    field: string,
    items: { _id: string; nameAr?: string; titleAr?: string; fullNameAr?: string }[],
    required = false,
  ) => (
    <Select {...form.register(field, { required })}>
      <option value="">—</option>
      {items.map((i) => (
        <option key={i._id} value={i._id}>
          {i.nameAr ?? i.titleAr ?? i.fullNameAr}
        </option>
      ))}
    </Select>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card
        title={t('hr.sections.job')}
        actions={
          canEdit && (
            <div className="flex flex-wrap gap-1">
              <Button variant="secondary" onClick={() => open('transfer')}>
                {t('hr.actions.transfer')}
              </Button>
              <Button variant="secondary" onClick={() => open('promote')}>
                {t('hr.actions.promote')}
              </Button>
              <Button variant="secondary" onClick={() => open('manager')}>
                {t('hr.actions.manager')}
              </Button>
              <Button variant="secondary" onClick={() => open('status')}>
                {t('hr.actions.status')}
              </Button>
            </div>
          )
        }
      >
        <dl>
          <Row label={t('hr.employeeNumber')} value={e.employeeNumber} dir="ltr" />
          <Row label={t('admin.users.department')} value={lk.deptName(e.departmentId)} />
          <Row label={t('hr.unit')} value={lk.unitName(e.unitId)} />
          <Row label={t('hr.position')} value={lk.positionName(e.positionId)} />
          <Row label={t('hr.grade')} value={e.grade} />
          <Row
            label={t('hr.directManager')}
            value={
              e.directManagerId ? (
                <Link className="text-brand-700 hover:underline" to={`/hr/employees/${e.directManagerId}`}>
                  {lk.employeeName(e.directManagerId)}
                </Link>
              ) : undefined
            }
          />
          <Row label={t('admin.org.branch')} value={lk.branchName(e.branchId)} />
          <Row label={t('admin.org.sites')} value={lk.siteName(e.siteId)} />
          <Row label={t('hr.employmentType')} value={t(`hr.employmentTypes.${e.employmentType}`)} />
          <Row label={t('hr.hireDate')} value={formatDate(e.hireDate)} />
          <Row label={t('hr.endDate')} value={e.endDate ? formatDate(e.endDate) : undefined} />
          <Row
            label={t('common.status')}
            value={<Badge tone={statusTone[e.status]}>{t(`hr.status.${e.status}`)}</Badge>}
          />
          {e.status === 'seconded' && e.secondment && (
            <Row
              label={t('hr.secondment')}
              value={`${e.secondment.destination} (${formatDate(e.secondment.startDate)} – ${formatDate(e.secondment.endDate)})`}
            />
          )}
        </dl>
      </Card>
      <Card title={t('hr.history')}>
        {history.isError ? (
          <QueryError error={history.error} onRetry={() => history.refetch()} />
        ) : history.isLoading ? (
          <Spinner />
        ) : !history.data?.items.length ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <ol className="relative space-y-4 border-s border-slate-200 ps-4">
            {history.data.items.map((h) => (
              <li key={h._id} className="relative">
                <span
                  className="absolute -start-[21px] top-1.5 size-2.5 rounded-full bg-brand-600"
                  aria-hidden
                />
                <div className="text-sm font-medium">{t(`hr.events.${h.type}`)}</div>
                <div className="text-xs text-slate-600">
                  {h.type === 'updated'
                    ? h.changedFields.map((f) => t(`hr.fields.${f}`, f)).join(t('common.listSeparator'))
                    : describe(h)}
                </div>
                {h.reason && (
                  <div className="text-xs text-slate-500">
                    {t('hr.reason')}: {h.reason}
                  </div>
                )}
                <div className="text-xs text-slate-400 tabular">
                  {h.effectiveDate ? `${t('hr.effectiveDate')}: ${formatDate(h.effectiveDate)} · ` : ''}
                  {formatDateTime(h.at)} · {h.actorEmail}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog ? t(`hr.actions.${dialog}`) : ''}>
        <form onSubmit={act} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          {dialog === 'transfer' && (
            <>
              <Field label={t('admin.users.department')} required>
                {selectOf('departmentId', lk.departments, true)}
              </Field>
              <Field label={t('hr.unit')}>{selectOf('unitId', lk.units)}</Field>
              <Field label={t('admin.org.branch')}>{selectOf('branchId', lk.branches)}</Field>
              <Field label={t('hr.directManager')} required>
                {selectOf(
                  'directManagerId',
                  lk.employees.filter((x) => x._id !== e._id),
                  true,
                )}
              </Field>
            </>
          )}
          {dialog === 'promote' && (
            <>
              <Field label={t('hr.position')} required>
                {selectOf('positionId', lk.positions, true)}
              </Field>
              <Field label={t('hr.grade')}>
                <Input dir="ltr" {...form.register('grade')} />
              </Field>
              <Field label={t('hr.basicSalary')}>
                <Input dir="ltr" inputMode="decimal" {...form.register('basicSalary')} />
              </Field>
            </>
          )}
          {dialog === 'manager' && (
            <Field label={t('hr.directManager')}>
              {selectOf(
                'directManagerId',
                lk.employees.filter((x) => x._id !== e._id),
              )}
            </Field>
          )}
          {dialog === 'status' && (
            <>
              <Field label={t('common.status')} required>
                <Select {...form.register('status', { required: true })}>
                  {EMPLOYEE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`hr.status.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.watch('status') === 'seconded' && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t('hr.secondmentDestination')} required>
                    <Input {...form.register('destination', { required: true })} />
                  </Field>
                  <Field label={t('calendar.start')} required>
                    <Input type="date" dir="ltr" {...form.register('startDate', { required: true })} />
                  </Field>
                  <Field label={t('calendar.end')} required>
                    <Input type="date" dir="ltr" {...form.register('endDate', { required: true })} />
                  </Field>
                </div>
              )}
              {(form.watch('status') === 'terminated' || form.watch('status') === 'resigned') && (
                <Alert kind="warning">{t('hr.endOfServiceWarning')}</Alert>
              )}
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hr.effectiveDate')} required>
              <Input type="date" dir="ltr" {...form.register('effectiveDate', { required: true })} />
            </Field>
            <Field label={t('hr.reason')} required>
              <Input {...form.register('reason', { required: true })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/* ---------------- contracts tab ---------------- */
interface ContractRow {
  _id: string;
  number: string;
  type: string;
  status: string;
  startDate: string;
  endDate?: string;
  probationEndDate?: string;
  attachmentId?: string;
  version: number;
  addenda: { titleAr: string; attachmentId?: string; addedAt: string }[];
}
function ContractsTab({ e }: { e: EmployeeFull }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { formatDate } = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['employee', e._id, 'contracts'],
    queryFn: () => get<{ items: ContractRow[] }>(`/hr/employees/${e._id}/contracts`),
  });
  const [open, setOpen] = useState<'new' | string | null>(null);
  const [error, setError] = useState<string>();
  const [attachmentId, setAttachmentId] = useState<string>();
  const form = useForm<Record<string, string>>({ defaultValues: { type: 'fixed_term' } });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['employee', e._id, 'contracts'] });
  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      if (open === 'new')
        await post(`/hr/employees/${e._id}/contracts`, {
          type: v.type,
          startDate: v.startDate,
          endDate: v.endDate || null,
          probationEndDate: v.probationEndDate || null,
          durationMonths: v.durationMonths ? Number(v.durationMonths) : undefined,
          attachmentId,
          notes: v.notes || undefined,
        });
      else if (open)
        await post(`/hr/employees/${e._id}/contracts/${open}/addenda`, {
          titleAr: v.titleAr,
          attachmentId,
          notes: v.notes || undefined,
        });
      invalidate();
      toast(t('actions.save'));
      setOpen(null);
      setAttachmentId(undefined);
      form.reset({ type: 'fixed_term' });
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      patch(`/hr/employees/${e._id}/contracts/${id}/status`, { status }),
    onSuccess: invalidate,
  });
  const tone: Record<string, 'green' | 'slate' | 'amber' | 'red'> = {
    active: 'green',
    expired: 'slate',
    renewing: 'amber',
    terminated: 'red',
  };
  return (
    <Card
      title={t('hr.tabs.contracts')}
      actions={
        can('hr.contracts', 'create') && <Button onClick={() => setOpen('new')}>{t('hr.newContract')}</Button>
      }
    >
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <EmptyState title={t('common.empty')} />
      ) : (
        <Table
          head={[
            '#',
            t('hr.contractType'),
            t('calendar.start'),
            t('calendar.end'),
            t('hr.probationEnd'),
            t('common.status'),
            '',
          ]}
        >
          {q.data.items.map((c) => (
            <tr key={c._id}>
              <Td className="tabular text-xs">
                {c.number} <span className="text-slate-400">v{c.version}</span>
              </Td>
              <Td>{t(`hr.contractTypes.${c.type}`)}</Td>
              <Td className="tabular">{formatDate(c.startDate)}</Td>
              <Td className="tabular">{c.endDate ? formatDate(c.endDate) : '—'}</Td>
              <Td className="tabular">{c.probationEndDate ? formatDate(c.probationEndDate) : '—'}</Td>
              <Td>
                <Badge tone={tone[c.status] ?? 'slate'}>{t(`hr.contractStatuses.${c.status}`)}</Badge>
                {c.addenda.length > 0 && (
                  <span className="ms-1 text-xs text-slate-500">
                    +{c.addenda.length} {t('hr.addenda')}
                  </span>
                )}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {c.attachmentId && (
                    <Button variant="ghost" onClick={() => downloadAttachment(c.attachmentId!)}>
                      {t('files.download')}
                    </Button>
                  )}
                  {can('hr.contracts', 'edit') && c.status !== 'expired' && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setOpen(c._id);
                        setError(undefined);
                      }}
                    >
                      {t('hr.addAddendum')}
                    </Button>
                  )}
                  {can('hr.contracts', 'edit') && c.status === 'active' && (
                    <Button
                      variant="ghost"
                      onClick={() => setStatus.mutate({ id: c._id, status: 'renewing' })}
                    >
                      {t('hr.contractStatuses.renewing')}
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open === 'new' ? t('hr.newContract') : t('hr.addAddendum')}
      >
        <form onSubmit={submit} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          {open === 'new' ? (
            <>
              <Field label={t('hr.contractType')}>
                <Select {...form.register('type')}>
                  {CONTRACT_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`hr.contractTypes.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('calendar.start')} required>
                  <Input type="date" dir="ltr" {...form.register('startDate', { required: true })} />
                </Field>
                <Field label={t('calendar.end')}>
                  <Input type="date" dir="ltr" {...form.register('endDate')} />
                </Field>
                <Field label={t('hr.probationEnd')}>
                  <Input type="date" dir="ltr" {...form.register('probationEndDate')} />
                </Field>
                <Field label={t('hr.durationMonths')}>
                  <Input dir="ltr" inputMode="numeric" {...form.register('durationMonths')} />
                </Field>
              </div>
            </>
          ) : (
            <Field label={t('hr.addendumTitle')} required>
              <Input {...form.register('titleAr', { required: true })} />
            </Field>
          )}
          <Field label={t('files.attachment')}>
            <FileUploader
              ownerType="employee"
              ownerId={e._id}
              sensitive
              onUploaded={(a) => setAttachmentId(a.attachmentId)}
            />
          </Field>
          <Field label={t('hr.notes')}>
            <Textarea rows={2} {...form.register('notes')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

/* ---------------- documents tab ---------------- */
interface DocRow {
  _id: string;
  type: string;
  titleAr: string;
  attachmentId: string;
  issueDate?: string;
  expiryDate?: string;
  version: number;
  createdAt: string;
}
function DocumentsTab({ e }: { e: EmployeeFull }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { formatDate } = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const [includeOld, setIncludeOld] = useState(false);
  const q = useQuery({
    queryKey: ['documents', 'employee', e._id, includeOld],
    queryFn: () =>
      get<{ items: DocRow[] }>(
        `/documents?ownerType=employee&ownerId=${e._id}${includeOld ? '&includeOld=true' : ''}`,
      ),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [att, setAtt] = useState<{ attachmentId: string; fileName: string }>();
  const form = useForm<Record<string, string>>({ defaultValues: { type: 'identity' } });
  const submit = form.handleSubmit(async (v) => {
    if (!att) return setError(t('files.required'));
    try {
      await post('/documents', {
        ownerType: 'employee',
        ownerId: e._id,
        type: v.type,
        titleAr: v.titleAr || t(`hr.documentTypes.${v.type}`),
        attachmentId: att.attachmentId,
        issueDate: v.issueDate || undefined,
        expiryDate: v.expiryDate || null,
        sensitive: true,
      });
      qc.invalidateQueries({ queryKey: ['documents', 'employee', e._id] });
      toast(t('actions.save'));
      setOpen(false);
      setAtt(undefined);
      form.reset({ type: 'identity' });
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  const expiring = (d?: string) => d && new Date(d).getTime() - Date.now() < 90 * 86_400_000;
  return (
    <Card
      title={t('hr.tabs.documents')}
      actions={
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeOld} onChange={(ev) => setIncludeOld(ev.target.checked)} />{' '}
            {t('hr.showOldVersions')}
          </label>
          {can('documents', 'create') && (
            <Button onClick={() => setOpen(true)}>{t('hr.uploadDocument')}</Button>
          )}
        </>
      }
    >
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <EmptyState title={t('common.empty')} />
      ) : (
        <Table head={[t('hr.documentType'), t('common.name'), t('hr.issueDate'), t('hr.expiryDate'), '']}>
          {q.data.items.map((d) => (
            <tr key={d._id}>
              <Td>
                {t(`hr.documentTypes.${d.type}`, d.type)}{' '}
                <span className="text-xs text-slate-400">v{d.version}</span>
              </Td>
              <Td className="font-medium">{d.titleAr}</Td>
              <Td className="tabular">{d.issueDate ? formatDate(d.issueDate) : '—'}</Td>
              <Td className="tabular">
                {d.expiryDate ? (
                  <span className={cx(expiring(d.expiryDate) && 'font-semibold text-amber-700')}>
                    {formatDate(d.expiryDate)}
                  </span>
                ) : (
                  '—'
                )}
              </Td>
              <Td>
                <Button variant="ghost" onClick={() => downloadAttachment(d.attachmentId)}>
                  {t('files.download')}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('hr.uploadDocument')}>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('hr.documentType')}>
            <Select {...form.register('type')}>
              {EMPLOYEE_DOCUMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`hr.documentTypes.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.name')}>
            <Input {...form.register('titleAr')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hr.issueDate')}>
              <Input type="date" dir="ltr" {...form.register('issueDate')} />
            </Field>
            <Field label={t('hr.expiryDate')}>
              <Input type="date" dir="ltr" {...form.register('expiryDate')} />
            </Field>
          </div>
          <Field label={t('files.attachment')} required>
            <FileUploader ownerType="employee" ownerId={e._id} sensitive onUploaded={setAtt} />
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
    </Card>
  );
}

/* ---------------- custody tab ---------------- */
interface CustodyRow {
  _id: string;
  itemName: string;
  assetTag?: string;
  serialNumber?: string;
  issuedAt: string;
  returnedAt?: string;
  condition?: string;
}
function CustodyTab({ e }: { e: EmployeeFull }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { formatDate } = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['employee', e._id, 'custody'],
    queryFn: () => get<{ items: CustodyRow[] }>(`/hr/employees/${e._id}/custody`),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const form = useForm<Record<string, string>>({
    defaultValues: { issuedAt: riyadhToday() },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['employee', e._id, 'custody'] });
  // Return with a selectable condition (review C19); the code is stored, the label translated.
  const [returning, setReturning] = useState<string | null>(null);
  const [condition, setCondition] = useState<string>('good');
  const ret = useMutation({
    mutationFn: (id: string) =>
      post(`/hr/employees/${e._id}/custody/${id}/return`, {
        returnedAt: new Date().toISOString(),
        condition,
      }),
    onSuccess: () => {
      invalidate();
      setReturning(null);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      await post(`/hr/employees/${e._id}/custody`, {
        itemName: v.itemName,
        assetTag: v.assetTag || undefined,
        serialNumber: v.serialNumber || undefined,
        issuedAt: v.issuedAt,
        notes: v.notes || undefined,
      });
      invalidate();
      toast(t('actions.save'));
      setOpen(false);
      form.reset({ issuedAt: riyadhToday() });
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <Card
      title={t('hr.tabs.custody')}
      actions={
        can('hr.custody', 'create') && <Button onClick={() => setOpen(true)}>{t('hr.newCustody')}</Button>
      }
    >
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <EmptyState title={t('common.empty')} />
      ) : (
        <Table head={[t('hr.custodyItem'), t('hr.assetTag'), t('hr.issuedAt'), t('hr.returnedAt'), '']}>
          {q.data.items.map((c) => (
            <tr key={c._id}>
              <Td className="font-medium">{c.itemName}</Td>
              <Td dir="ltr" className="tabular text-xs">
                {c.assetTag} {c.serialNumber && <span className="text-slate-400">{c.serialNumber}</span>}
              </Td>
              <Td className="tabular">{formatDate(c.issuedAt)}</Td>
              <Td className="tabular">
                {c.returnedAt ? (
                  `${formatDate(c.returnedAt)} (${t(`hr.custodyConditions.${c.condition}`, c.condition ?? '')})`
                ) : (
                  <Badge tone="amber">{t('hr.inCustody')}</Badge>
                )}
              </Td>
              <Td>
                {!c.returnedAt && can('hr.custody', 'edit') && (
                  <Button variant="ghost" onClick={() => setReturning(c._id)}>
                    {t('hr.returnItem')}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('hr.newCustody')}>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('hr.custodyItem')} required>
            <Input {...form.register('itemName', { required: true })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('hr.assetTag')}>
              <Input dir="ltr" {...form.register('assetTag')} />
            </Field>
            <Field label={t('hr.serialNumber')}>
              <Input dir="ltr" {...form.register('serialNumber')} />
            </Field>
            <Field label={t('hr.issuedAt')} required>
              <Input type="date" dir="ltr" {...form.register('issuedAt', { required: true })} />
            </Field>
          </div>
          <Field label={t('hr.notes')}>
            <Textarea rows={2} {...form.register('notes')} />
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
      <Dialog open={!!returning} onClose={() => setReturning(null)} title={t('hr.returnCustody')}>
        <div className="space-y-3">
          <Field label={t('hr.custodyCondition')} required>
            <Select value={condition} onChange={(ev) => setCondition(ev.target.value)}>
              {CUSTODY_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`hr.custodyConditions.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReturning(null)}>
              {t('actions.cancel')}
            </Button>
            <Button loading={ret.isPending} onClick={() => returning && ret.mutate(returning)}>
              {t('actions.confirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

/* ---------------- reports tab [EP §14.2.9: reports stay in the employee's record] ---------------- */
function ReportsTab({ e }: { e: EmployeeFull }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const types = useReportTypes();
  const q = useReports({ view: 'all', employeeId: e._id, limit: 100 });
  return (
    <Card title={t('hr.tabs.reports')}>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <EmptyState title={t('reports.empty')} />
      ) : (
        <Table
          head={[
            t('common.number'),
            t('reports.reportTitle'),
            t('reports.type'),
            t('common.date'),
            t('common.status'),
          ]}
        >
          {q.data.items.map((r) => (
            <tr key={r._id}>
              <Td className="tabular text-xs text-slate-500">
                <Link to={`/reports/${r._id}`} className="text-brand-800 hover:underline">
                  {r.number}
                </Link>
              </Td>
              <Td className="font-medium">{r.title}</Td>
              <Td>{typeLabel(types.data?.items, r.type)}</Td>
              <Td className="tabular text-xs">{formatDate(r.submittedAt)}</Td>
              <Td>
                <Badge tone={r.state === 'reviewed' ? 'green' : 'blue'}>
                  {t(`reports.states.${r.state}`)}
                </Badge>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
