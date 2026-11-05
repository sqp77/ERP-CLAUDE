import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, QueryError } from '@/shared/ui';
import { downloadAttachment } from '@/shared/files/FileUploader';
import { useHrLookups } from './_data';

interface Row {
  employeeId: string;
  employeeNumber: string;
  fullNameAr: string;
  departmentId: string;
  destination: string;
  startDate: string;
  endDate: string;
  reportedAt?: string;
  reportAttachmentId?: string;
  remindersSent: number[];
  previous: number;
}

/** Secondments and their reports [EP §5.3]: HR sees which missions still have no report. */
export function SecondmentsPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const lk = useHrLookups();
  const [missingOnly, setMissingOnly] = useState(true);
  const q = useQuery({
    queryKey: ['secondments', missingOnly],
    queryFn: () => get<{ items: Row[] }>(`/hr/secondments${missingOnly ? '?missingReport=true' : ''}`),
  });
  return (
    <>
      <PageHeader
        title={t('secondments.title')}
        subtitle={t('secondments.hint')}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />{' '}
            {t('secondments.missingOnly')}
          </label>
        }
      />
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <Table
            head={[
              t('common.name'),
              t('admin.users.department'),
              t('secondments.destination'),
              t('calendar.start'),
              t('calendar.end'),
              t('secondments.reported'),
              t('secondments.reminders'),
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={r.employeeId}>
                <Td>
                  <Link
                    to={`/hr/employees/${r.employeeId}`}
                    className="font-medium text-brand-800 hover:underline"
                  >
                    {r.fullNameAr}
                  </Link>
                  <div className="text-xs text-slate-500">{r.employeeNumber}</div>
                </Td>
                <Td>{lk.deptName(r.departmentId)}</Td>
                <Td>
                  {r.destination}
                  {r.previous > 0 && <span className="ms-1 text-xs text-slate-400">(+{r.previous})</span>}
                </Td>
                <Td className="tabular">{formatDate(r.startDate)}</Td>
                <Td className="tabular">{formatDate(r.endDate)}</Td>
                <Td>
                  {r.reportedAt ? (
                    <button
                      className="text-brand-700 hover:underline"
                      onClick={() => r.reportAttachmentId && downloadAttachment(r.reportAttachmentId)}
                    >
                      {formatDate(r.reportedAt)}
                    </button>
                  ) : (
                    <Badge tone="amber">{t('secondments.noReport')}</Badge>
                  )}
                </Td>
                <Td className="tabular">{r.remindersSent.length}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
