import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { usePositions, lookupName } from '@/lib/lookups';
import { Badge, Button, Card, EmptyState, PageHeader, QueryError, Spinner, Table, Td } from '@/shared/ui';
import { downloadAttachment } from '@/shared/files/FileUploader';

interface Report {
  _id: string;
  fullNameAr: string;
  employeeNumber: string;
  positionId?: string;
  status: string;
  workEmail: string;
  mobile?: string;
  secondment: null | {
    destination: string;
    startDate?: string;
    endDate?: string;
    reportedAt?: string;
    reportAttachmentId?: string;
  };
}

/** My direct reports [HR §6.2]: status and secondment reports; the target of the report notification (review C18). */
export function TeamPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const positions = usePositions();
  const q = useQuery({ queryKey: ['team'], queryFn: () => get<{ items: Report[] }>('/hr/team') });
  return (
    <>
      <PageHeader title={t('team.title')} subtitle={t('team.hint')} />
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('team.empty')} />
        ) : (
          <Table
            head={[
              t('common.name'),
              t('hr.position'),
              t('common.status'),
              t('team.secondment'),
              t('team.report'),
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={r._id}>
                <Td>
                  <div className="font-medium">{r.fullNameAr}</div>
                  <div className="break-all text-xs text-slate-500" dir="ltr">
                    {r.workEmail}
                  </div>
                </Td>
                <Td>{lookupName(positions.data?.items, r.positionId)}</Td>
                <Td>
                  <Badge>{t(`hr.status.${r.status}`, r.status)}</Badge>
                </Td>
                <Td className="text-xs">
                  {r.secondment
                    ? `${r.secondment.destination} · ${formatDate(r.secondment.startDate)} – ${formatDate(r.secondment.endDate)}`
                    : t('team.noSecondment')}
                </Td>
                <Td>
                  {r.secondment?.reportAttachmentId ? (
                    <Button
                      variant="secondary"
                      onClick={() => downloadAttachment(r.secondment!.reportAttachmentId!)}
                    >
                      {t('files.download')}
                    </Button>
                  ) : r.secondment ? (
                    <Badge tone="amber">{t('profile.notReported')}</Badge>
                  ) : (
                    '—'
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
