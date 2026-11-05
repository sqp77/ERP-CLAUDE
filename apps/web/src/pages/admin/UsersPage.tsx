import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { grantableRolesFor } from '@eayni/shared';
import { usePrefs } from '@/lib/preferences';
import { get, patch, post, type Paged } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
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
import { useDepartments, useRoles } from './_shared';

interface UserRow {
  _id: string;
  email: string;
  displayNameAr: string;
  status: 'active' | 'disabled';
  roles: { role: string; departmentId?: string }[];
  departmentId?: string;
  totpEnabled: boolean;
  lastLoginAt?: string;
}

/** Users administration [HR §6, EP §3.10]. Employee files themselves arrive with HR in phase 1. */
export function UsersPage() {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const { formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<{ email: string; password: string }>();
  const users = useQuery({
    queryKey: ['users', q],
    queryFn: () => get<Paged<UserRow>>(`/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
  const depts = useDepartments();
  const roles = useRoles();
  // The API refuses roles outside the grantable matrix (security review A5); the form shows only those.
  const grantable = grantableRolesFor(user?.roles.map((r) => r.role) ?? []);
  const roleOptions = roles.data?.items.filter((r) => grantable === '*' || grantable.has(r.code)) ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const toggle = useMutation({
    mutationFn: (u: UserRow) =>
      patch(`/users/${u._id}`, { status: u.status === 'active' ? 'disabled' : 'active' }),
    onSuccess: invalidate,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const reset = useMutation({
    mutationFn: (u: UserRow) =>
      post<{ temporaryPassword: string }>(`/users/${u._id}/reset-password`).then((r) => ({
        email: u.email,
        password: r.temporaryPassword,
      })),
    onSuccess: (r) => setTemp(r),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const resetMfa = useMutation({
    mutationFn: (u: UserRow) => post(`/users/${u._id}/mfa/reset`),
    onSuccess: () => {
      invalidate();
      toast(t('admin.users.mfaResetDone'), 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const form = useForm<{ email: string; displayNameAr: string; role: string; departmentId?: string }>({
    defaultValues: { role: 'employee' },
  });
  const create = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      const roleDef = roles.data?.items.find((r) => r.code === v.role);
      const rolesPayload: { role: string; departmentId?: string }[] = [{ role: 'employee' }];
      if (v.role !== 'employee')
        rolesPayload.push(
          roleDef?.departmentScoped && v.departmentId
            ? { role: v.role, departmentId: v.departmentId }
            : { role: v.role },
        );
      const r = await post<UserRow & { temporaryPassword?: string }>('/users', {
        email: v.email,
        displayNameAr: v.displayNameAr,
        roles: rolesPayload,
        departmentId: v.departmentId || undefined,
      });
      setOpen(false);
      form.reset();
      invalidate();
      if (r.temporaryPassword) setTemp({ email: r.email, password: r.temporaryPassword });
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  const deptName = (id?: string) => depts.data?.items.find((d) => d._id === id)?.nameAr ?? '';

  return (
    <>
      <PageHeader
        title={t('admin.users.title')}
        actions={
          can('users', 'create') && <Button onClick={() => setOpen(true)}>{t('admin.users.new')}</Button>
        }
      />
      <Card>
        <div className="mb-3 max-w-sm">
          <Input placeholder={t('actions.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {users.isError ? (
          <QueryError error={users.error} onRetry={() => users.refetch()} />
        ) : users.isLoading ? (
          <Spinner />
        ) : (
          <Table
            head={[
              t('admin.users.displayName'),
              t('auth.email'),
              t('admin.users.roles'),
              t('admin.users.department'),
              t('admin.users.mfa'),
              t('admin.users.lastLogin'),
              t('common.status'),
              '',
            ]}
          >
            {users.data?.items.map((u) => (
              <tr key={u._id}>
                <Td className="font-medium">{u.displayNameAr}</Td>
                <Td dir="ltr" className="text-start">
                  {u.email}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r, i) => (
                      <Badge key={i}>
                        {roles.data?.items.find((x) => x.code === r.role)?.nameAr ?? r.role}
                        {r.departmentId ? ` · ${deptName(r.departmentId)}` : ''}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td>{deptName(u.departmentId)}</Td>
                <Td>
                  {u.totpEnabled ? (
                    <Badge tone="green">{t('common.yes')}</Badge>
                  ) : (
                    <Badge tone="slate">{t('common.no')}</Badge>
                  )}
                </Td>
                <Td className="tabular text-xs text-slate-500">{formatDateTime(u.lastLoginAt)}</Td>
                <Td>
                  {u.status === 'active' ? (
                    <Badge tone="green">{t('common.active')}</Badge>
                  ) : (
                    <Badge tone="red">{t('common.disabled')}</Badge>
                  )}
                </Td>
                <Td>
                  {can('users', 'edit') && (
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => toggle.mutate(u)}>
                        {u.status === 'active' ? t('admin.users.disable') : t('admin.users.enable')}
                      </Button>
                      <Button variant="ghost" onClick={() => reset.mutate(u)}>
                        {t('admin.users.resetPassword')}
                      </Button>
                      {u.totpEnabled && can('users.security', 'edit') && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            window.confirm(t('admin.users.mfaResetConfirm')) && resetMfa.mutate(u)
                          }
                        >
                          {t('admin.users.mfaReset')}
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={t('admin.users.new')}>
        <form onSubmit={create} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('admin.users.displayName')} required>
            <Input {...form.register('displayNameAr', { required: true })} />
          </Field>
          <Field label={t('auth.email')} required>
            <Input type="email" dir="ltr" {...form.register('email', { required: true })} />
          </Field>
          <Field label={t('admin.users.roles')}>
            <Select {...form.register('role')}>
              {roleOptions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.nameAr}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.users.department')}>
            <Select {...form.register('departmentId')}>
              <option value="">—</option>
              {depts.data?.items.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.nameAr}
                </option>
              ))}
            </Select>
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

      <Dialog open={!!temp} onClose={() => setTemp(undefined)} title={t('admin.users.tempPassword')}>
        <div className="space-y-3">
          <div className="text-sm text-slate-700" dir="ltr">
            {temp?.email}
          </div>
          <code dir="ltr" className="block rounded bg-slate-100 px-3 py-2 text-lg tracking-wider">
            {temp?.password}
          </code>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(temp?.password ?? '')}>
              {t('actions.copy')}
            </Button>
            <Button onClick={() => setTemp(undefined)}>{t('actions.close')}</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
