import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  GENDERS,
  IDENTITY_TYPES,
  type EmployeeStatus,
} from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, post, type Paged } from '@/lib/api';
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
  QueryError,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { useHrLookups, type EmployeeRow } from './_data';

export const statusTone: Record<EmployeeStatus, 'green' | 'blue' | 'amber' | 'red' | 'slate' | 'brand'> = {
  active: 'green',
  on_leave: 'amber',
  field_work: 'brand',
  seconded: 'blue',
  suspended: 'red',
  resigned: 'slate',
  terminated: 'slate',
};

type NewEmployee = {
  firstNameAr: string;
  lastNameAr: string;
  gender: 'male' | 'female';
  nationality: string;
  identityType: string;
  identityNumber: string;
  identityExpiry?: string;
  birthDate?: string;
  workEmail: string;
  mobile?: string;
  departmentId: string;
  positionId?: string;
  directManagerId?: string;
  branchId?: string;
  employmentType: string;
  hireDate: string;
  basicSalary?: string;
  createAccount: boolean;
};

/** Employee directory [HR §3.3]: search, filters, create. Scope is enforced by the API (own/team/department/all). */
export function EmployeesPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const { can } = useAuth();
  const { formatDate } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const lk = useHrLookups();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState(search.get('departmentId') ?? '');
  const [status, setStatus] = useState(search.get('status') ?? '');
  const probation = search.get('probation'); // review H5: HR dashboard drill-down
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<{ email: string; password: string }>();
  const params = new URLSearchParams({
    limit: '100',
    ...(q ? { q } : {}),
    ...(dept ? { departmentId: dept } : {}),
    ...(status ? { status } : {}),
    ...(probation ? { probationWithinDays: probation } : {}),
  });
  const list = useQuery({
    queryKey: ['employees', q, dept, status, probation],
    queryFn: () => get<Paged<EmployeeRow>>(`/hr/employees?${params}`),
  });
  const form = useForm<NewEmployee>({
    defaultValues: {
      gender: 'male',
      nationality: t('hr.defaults.nationality'),
      identityType: 'national_id',
      employmentType: 'full_time',
      createAccount: true,
    },
  });
  const create = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      const r = await post<{ _id: string; workEmail: string; temporaryPassword?: string }>('/hr/employees', {
        firstNameAr: v.firstNameAr,
        lastNameAr: v.lastNameAr,
        gender: v.gender,
        nationality: v.nationality,
        identity: {
          type: v.identityType,
          number: v.identityNumber,
          expiryDate: v.identityExpiry || undefined,
        },
        birthDate: v.birthDate || undefined,
        workEmail: v.workEmail,
        mobile: v.mobile || undefined,
        departmentId: v.departmentId,
        positionId: v.positionId || undefined,
        directManagerId: v.directManagerId || undefined,
        branchId: v.branchId || undefined,
        employmentType: v.employmentType,
        hireDate: v.hireDate,
        basicSalaryHalalas: v.basicSalary ? Math.round(Number(v.basicSalary) * 100) : undefined,
        createAccount: v.createAccount,
      });
      setOpen(false);
      form.reset();
      qc.invalidateQueries({ queryKey: ['employees'] });
      toast(t('actions.save'));
      if (r.temporaryPassword) setTemp({ email: r.workEmail, password: r.temporaryPassword });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <>
      <PageHeader
        title={t('hr.directory')}
        actions={
          can('hr.employees', 'create') && (
            <Button onClick={() => setOpen(true)}>{t('hr.newEmployee')}</Button>
          )
        }
      />
      <Card>
        {probation && (
          <Alert kind="info">
            {t('hr.probationFilter', { days: probation })}{' '}
            <Link to="/hr/employees" className="underline">
              {t('actions.clear')}
            </Link>
          </Alert>
        )}
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <Input placeholder={t('hr.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">
              {t('admin.users.department')}: {t('common.all')}
            </option>
            {lk.departments.map((d) => (
              <option key={d._id} value={d._id}>
                {d.nameAr}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">
              {t('common.status')}: {t('common.all')}
            </option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`hr.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <Table
            head={[
              t('hr.employeeNumber'),
              t('common.name'),
              t('admin.users.department'),
              t('hr.position'),
              t('hr.directManager'),
              t('hr.hireDate'),
              t('common.status'),
            ]}
          >
            {list.data.items.map((e) => (
              <tr key={e._id}>
                <Td className="tabular text-xs text-slate-500">{e.employeeNumber}</Td>
                <Td>
                  <Link to={`/hr/employees/${e._id}`} className="font-medium text-brand-800 hover:underline">
                    {e.fullNameAr}
                  </Link>
                  <div className="break-all text-xs text-slate-500" dir="ltr">
                    {e.workEmail}
                  </div>
                </Td>
                <Td>{lk.deptName(e.departmentId)}</Td>
                <Td>{lk.positionName(e.positionId)}</Td>
                <Td>{lk.employeeName(e.directManagerId) || '—'}</Td>
                <Td className="tabular">{formatDate(e.hireDate)}</Td>
                <Td>
                  <Badge tone={statusTone[e.status]}>{t(`hr.status.${e.status}`)}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <div className="mt-2 text-xs text-slate-500">{t('hr.count', { count: list.data?.total ?? 0 })}</div>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={t('hr.newEmployee')}>
        <form onSubmit={create} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hr.firstName')} required>
              <Input {...form.register('firstNameAr', { required: true })} />
            </Field>
            <Field label={t('hr.lastName')} required>
              <Input {...form.register('lastNameAr', { required: true })} />
            </Field>
            <Field label={t('hr.gender')}>
              <Select {...form.register('gender')}>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {t(`hr.genders.${g}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hr.nationality')} required>
              <Input {...form.register('nationality', { required: true })} />
            </Field>
            <Field label={t('hr.identityType')}>
              <Select {...form.register('identityType')}>
                {IDENTITY_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`hr.identityTypes.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hr.identityNumber')} required>
              <Input dir="ltr" {...form.register('identityNumber', { required: true })} />
            </Field>
            <Field label={t('hr.identityExpiry')}>
              <Input type="date" dir="ltr" {...form.register('identityExpiry')} />
            </Field>
            <Field label={t('hr.birthDate')}>
              <Input type="date" dir="ltr" {...form.register('birthDate')} />
            </Field>
            <Field label={t('auth.email')} required>
              <Input type="email" dir="ltr" {...form.register('workEmail', { required: true })} />
            </Field>
            <Field label={t('hr.mobile')}>
              <Input dir="ltr" inputMode="tel" placeholder="+9665xxxxxxxx" {...form.register('mobile')} />
            </Field>
            <Field label={t('admin.users.department')} required>
              <Select {...form.register('departmentId', { required: true })}>
                <option value="">—</option>
                {lk.departments.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hr.position')}>
              <Select {...form.register('positionId')}>
                <option value="">—</option>
                {lk.positions.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.titleAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hr.directManager')}>
              <Select {...form.register('directManagerId')}>
                <option value="">—</option>
                {lk.employees.map((e) => (
                  <option key={e._id} value={e._id}>
                    {e.fullNameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.org.branch')}>
              <Select {...form.register('branchId')}>
                <option value="">—</option>
                {lk.branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hr.employmentType')}>
              <Select {...form.register('employmentType')}>
                {EMPLOYMENT_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`hr.employmentTypes.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hr.hireDate')} required>
              <Input type="date" dir="ltr" {...form.register('hireDate', { required: true })} />
            </Field>
            <Field label={t('hr.basicSalary')}>
              <Input dir="ltr" inputMode="decimal" {...form.register('basicSalary')} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('createAccount')} /> {t('hr.createAccount')}
          </label>
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

      <Dialog open={!!temp} onClose={() => setTemp(undefined)} title={t('admin.users.tempPassword')}>
        <div className="space-y-3">
          <div dir="ltr" className="text-sm">
            {temp?.email}
          </div>
          <code dir="ltr" className="block rounded bg-slate-100 px-3 py-2 text-lg tracking-wider">
            {temp?.password}
          </code>
          <div className="flex justify-end">
            <Button onClick={() => setTemp(undefined)}>{t('actions.close')}</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
