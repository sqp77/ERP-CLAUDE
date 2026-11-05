import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { del, get, patch, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { lookupKeys } from '@/lib/lookups';
import { Alert, Badge, Button, Card, Dialog, PageHeader, Spinner, Table, Td, QueryError } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
}

interface Props<T extends { _id: string; active?: boolean }, F extends FieldValues> {
  title: string;
  newLabel: string;
  endpoint: string;
  lookup: 'units' | 'positions';
  columns: Column<T>[];
  toForm: (row: T | null) => F;
  toBody: (values: F, isNew: boolean) => Record<string, unknown>;
  fields: (form: UseFormReturn<F>, isNew: boolean) => ReactNode;
}

/** Simple audited CRUD screen for master data (units, positions …). */
export function MasterDataPage<T extends { _id: string; active?: boolean }, F extends FieldValues>({
  title,
  newLabel,
  endpoint,
  lookup,
  columns,
  toForm,
  toBody,
  fields,
}: Props<T, F>) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: lookupKeys[lookup],
    queryFn: () => get<{ items: T[] }>(`${endpoint}?all=true`),
  });
  const [editing, setEditing] = useState<T | null | 'new'>(null);
  const [error, setError] = useState<string>();
  const form = useForm<F>();
  const invalidate = () => qc.invalidateQueries({ queryKey: lookupKeys[lookup] });
  const remove = useMutation({
    mutationFn: (id: string) => del(`${endpoint}/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const open = (row: T | 'new') => {
    form.reset(toForm(row === 'new' ? null : row));
    setError(undefined);
    setEditing(row);
  };
  const submit = form.handleSubmit(async (v) => {
    try {
      if (editing === 'new') await post(endpoint, toBody(v, true));
      else if (editing) await patch(`${endpoint}/${editing._id}`, toBody(v, false));
      setEditing(null);
      invalidate();
      toast(t('actions.save'));
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <>
      <PageHeader title={title} actions={<Button onClick={() => open('new')}>{newLabel}</Button>} />
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : (
          <Table head={[...columns.map((c) => c.label), t('common.status'), '']}>
            {q.data?.items.map((row) => (
              <tr key={row._id}>
                {columns.map((c, i) => (
                  <Td key={i}>{c.render(row)}</Td>
                ))}
                <Td>
                  {row.active === false ? (
                    <Badge>{t('common.inactive')}</Badge>
                  ) : (
                    <Badge tone="green">{t('common.active')}</Badge>
                  )}
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => open(row)}>
                      {t('actions.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => confirm(t('common.deleteConfirm')) && remove.mutate(row._id)}
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
        title={editing === 'new' ? newLabel : t('actions.edit')}
      >
        <form onSubmit={submit} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          {fields(form, editing === 'new')}
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
