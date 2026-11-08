import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get, post, type Paged } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { useToast } from '@/shared/ui/Toast';
import { errorMessage } from '@/lib/errors';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  QueryError,
} from '@/shared/ui';

type Status = 'pending' | 'processing' | 'delivered' | 'failed' | 'unhandled' | 'expired';
interface Row {
  _id: string;
  type: string;
  aggregateType?: string;
  aggregateId?: string;
  status: Status;
  attempts: number;
  lastError?: string;
  createdAt: string;
}
type Resp = Paged<Row> & { counts: Partial<Record<Status, number>> };

const STATUSES: Status[] = ['failed', 'expired', 'unhandled', 'pending', 'processing', 'delivered'];
const TONE: Record<Status, 'red' | 'amber' | 'slate' | 'blue' | 'green'> = {
  failed: 'red',
  expired: 'amber',
  unhandled: 'amber',
  pending: 'blue',
  processing: 'blue',
  delivered: 'green',
};

/** Outbox admin (go-live review G8): events that gave up, expired or found no subscriber, with a manual requeue. */
export function OutboxPage() {
  const { t } = useTranslation();
  const { formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | Status>('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['outbox', status, page],
    queryFn: () => get<Resp>(`/outbox?limit=50&page=${page}${status ? `&status=${status}` : ''}`),
  });
  const requeue = useMutation({
    mutationFn: (id: string) => post(`/outbox/${id}/requeue`),
    onSuccess: () => {
      toast(t('admin.outbox.requeued'), 'success');
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));
  return (
    <>
      <PageHeader title={t('admin.outbox.title')} subtitle={t('admin.outbox.hint')} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="w-48">
            <Select
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value as '' | Status);
              }}
            >
              <option value="">{t('common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.outbox.statuses.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          {q.data &&
            STATUSES.filter((s) => q.data.counts[s]).map((s) => (
              <Badge key={s} tone={TONE[s]}>
                {t(`admin.outbox.statuses.${s}`)} {q.data.counts[s]}
              </Badge>
            ))}
        </div>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('admin.outbox.empty')} />
        ) : (
          <Table
            head={[
              t('admin.outbox.created'),
              t('admin.outbox.type'),
              t('admin.outbox.record'),
              t('admin.outbox.status'),
              t('admin.outbox.attempts'),
              t('admin.outbox.lastError'),
              '',
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={r._id}>
                <Td className="tabular text-xs">{formatDateTime(r.createdAt)}</Td>
                <Td dir="ltr" className="text-xs">
                  <code>{r.type}</code>
                </Td>
                <Td dir="ltr" className="text-xs text-slate-500">
                  {r.aggregateType} {r.aggregateId}
                </Td>
                <Td>
                  <Badge tone={TONE[r.status]}>{t(`admin.outbox.statuses.${r.status}`)}</Badge>
                </Td>
                <Td className="tabular text-xs">{r.attempts}</Td>
                <Td dir="ltr" className="max-w-xs truncate text-xs text-red-700" title={r.lastError}>
                  {r.lastError}
                </Td>
                <Td>
                  {(r.status === 'failed' || r.status === 'expired') && (
                    <Button
                      variant="secondary"
                      disabled={requeue.isPending}
                      onClick={() => requeue.mutate(r._id)}
                    >
                      {t('admin.outbox.requeue')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{t('common.page', { page, pages })}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('common.prev')}
            </Button>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
