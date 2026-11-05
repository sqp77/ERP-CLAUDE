import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { del, get, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
import { Button, Card, Field, Input, PageHeader, Spinner, Table, Td, QueryError } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';

interface H {
  _id: string;
  date: string;
  nameAr: string;
}

/** Holidays feed every SLA computation (CLAUDE.md "Business days"). */
export function HolidaysPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { formatDate } = usePrefs();
  const q = useQuery({ queryKey: ['holidays'], queryFn: () => get<{ items: H[] }>('/holidays') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['holidays'] });
  const remove = useMutation({ mutationFn: (id: string) => del(`/holidays/${id}`), onSuccess: invalidate });
  const form = useForm<{ date: string; nameAr: string }>();
  const add = form.handleSubmit(async (v) => {
    try {
      await post('/holidays', v);
      form.reset();
      invalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  });
  return (
    <>
      <PageHeader title={t('admin.holidays.title')} subtitle={t('admin.holidays.hint')} />
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card title={t('admin.holidays.new')}>
          <form onSubmit={add} className="space-y-3" noValidate>
            <Field label={t('common.date')} required>
              <Input type="date" dir="ltr" {...form.register('date', { required: true })} />
            </Field>
            <Field label={t('common.name')} required>
              <Input {...form.register('nameAr', { required: true })} />
            </Field>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('actions.create')}
            </Button>
          </form>
        </Card>
        <Card>
          {q.isError ? (
            <QueryError error={q.error} onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <Spinner />
          ) : (
            <Table head={[t('common.date'), t('common.calendarH'), t('common.name'), '']}>
              {q.data?.items.map((h) => (
                <tr key={h._id}>
                  <Td className="tabular" dir="ltr">
                    {h.date}
                  </Td>
                  <Td>{formatDate(h.date + 'T09:00:00Z')}</Td>
                  <Td className="font-medium">{h.nameAr}</Td>
                  <Td>
                    <Button variant="ghost" onClick={() => remove.mutate(h._id)}>
                      {t('actions.delete')}
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
