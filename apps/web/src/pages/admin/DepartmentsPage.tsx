import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { del, patch, post } from '@/lib/api';
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
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { useDepartments, type Dept } from './_shared';

/** Departments and sub-departments [HR §3.1.1–3.1.2]. */
export function DepartmentsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const depts = useDepartments();
  const [editing, setEditing] = useState<Dept | null | 'new'>(null);
  const [error, setError] = useState<string>();
  const form = useForm<{ code: string; nameAr: string; parentId?: string; active: boolean }>();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['departments'] });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/org/departments/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const openNew = () => {
    form.reset({ code: '', nameAr: '', parentId: '', active: true });
    setEditing('new');
  };
  const openEdit = (d: Dept) => {
    form.reset({ code: d.code, nameAr: d.nameAr, parentId: d.parentId ?? '', active: d.active });
    setEditing(d);
  };
  const submit = form.handleSubmit(async (v) => {
    setError(undefined);
    const body = { ...v, parentId: v.parentId || null };
    try {
      if (editing === 'new') await post('/org/departments', body);
      else if (editing)
        await patch(`/org/departments/${editing._id}`, {
          nameAr: body.nameAr,
          parentId: body.parentId,
          active: body.active,
        });
      setEditing(null);
      invalidate();
      toast(t('actions.save'));
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  const name = (id?: string | null) => depts.data?.items.find((d) => d._id === id)?.nameAr ?? '';

  return (
    <>
      <PageHeader
        title={t('admin.org.departments')}
        actions={<Button onClick={openNew}>{t('admin.org.newDepartment')}</Button>}
      />
      <Card>
        {depts.isLoading ? (
          <Spinner />
        ) : (
          <Table head={[t('common.code'), t('common.name'), t('admin.org.parent'), t('common.status'), '']}>
            {depts.data?.items.map((d) => (
              <tr key={d._id}>
                <Td>
                  <code className="text-xs">{d.code}</code>
                </Td>
                <Td className="font-medium">{d.nameAr}</Td>
                <Td>{name(d.parentId)}</Td>
                <Td>
                  {d.active ? (
                    <Badge tone="green">{t('common.active')}</Badge>
                  ) : (
                    <Badge>{t('common.inactive')}</Badge>
                  )}
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => openEdit(d)}>
                      {t('actions.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => confirm(t('actions.delete') + '؟') && remove.mutate(d._id)}
                    >
                      {t('actions.delete')}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('admin.org.newDepartment') : t('actions.edit')}
      >
        <form onSubmit={submit} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('common.code')} required hint="أحرف إنجليزية صغيرة وأرقام و _">
            <Input dir="ltr" disabled={editing !== 'new'} {...form.register('code', { required: true })} />
          </Field>
          <Field label={t('common.name')} required>
            <Input {...form.register('nameAr', { required: true })} />
          </Field>
          <Field label={t('admin.org.parent')}>
            <Select {...form.register('parentId')}>
              <option value="">—</option>
              {depts.data?.items
                .filter((d) => editing === 'new' || d._id !== (editing as Dept)._id)
                .map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.nameAr}
                  </option>
                ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('active')} /> {t('common.active')}
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
