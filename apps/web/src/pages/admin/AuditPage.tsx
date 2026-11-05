import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get, type Paged } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { Badge, Button, Card, Input, PageHeader, Spinner, Table, Td, QueryError } from '@/shared/ui';

interface Row {
  _id: string;
  at: string;
  actorEmail?: string;
  system: boolean;
  action: string;
  resource: string;
  resourceId?: string;
  changedFields: string[];
  sensitive: boolean;
}

/** Audit log viewer (golden rule 4). Append-only on the server; read-only here. */
export function AuditPage() {
  const { t } = useTranslation();
  const { formatDateTime } = usePrefs();
  const [resource, setResource] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['audit', resource, page],
    queryFn: () =>
      get<Paged<Row>>(
        `/audit?limit=50&page=${page}${resource ? `&resource=${encodeURIComponent(resource)}` : ''}`,
      ),
  });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));
  return (
    <>
      <PageHeader title={t('admin.audit.title')} />
      <Card>
        <div className="mb-3 max-w-xs">
          <Input
            dir="ltr"
            placeholder={t('admin.audit.resource')}
            value={resource}
            onChange={(e) => {
              setPage(1);
              setResource(e.target.value);
            }}
          />
        </div>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : (
          <Table
            head={[
              t('admin.audit.when'),
              t('admin.audit.who'),
              t('admin.audit.action'),
              t('admin.audit.resource'),
              t('admin.audit.changed'),
            ]}
          >
            {q.data?.items.map((r) => (
              <tr key={r._id}>
                <Td className="tabular text-xs">{formatDateTime(r.at)}</Td>
                <Td dir="ltr" className="text-xs">
                  {r.system ? 'system' : r.actorEmail}
                </Td>
                <Td>
                  <Badge tone={r.action === 'delete' ? 'red' : r.action === 'create' ? 'green' : 'blue'}>
                    {r.action}
                  </Badge>
                  {r.sensitive && <Badge tone="amber">{t('audit.sensitive')}</Badge>}
                </Td>
                <Td dir="ltr" className="text-xs">
                  <code>{r.resource}</code> <span className="text-slate-400">{r.resourceId}</span>
                </Td>
                <Td className="text-xs text-slate-600" dir="ltr">
                  {r.changedFields.join(', ')}
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
