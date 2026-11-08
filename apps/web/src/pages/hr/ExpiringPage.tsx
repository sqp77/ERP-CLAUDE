import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { Badge, Card, EmptyState, PageHeader, QueryError, Spinner, Table, Td } from '@/shared/ui';
import { useHrLookups } from './_data';

type Kind = 'contracts' | 'identities' | 'documents';
interface Row {
  employeeId: string;
  fullNameAr: string;
  employeeNumber: string;
  departmentId?: string;
  titleAr: string;
  expiryDate: string;
  daysLeft: number;
}
const KINDS: Kind[] = ['contracts', 'identities', 'documents'];
const WINDOWS = [30, 60, 90];

/** Drill-down behind the HR expiry cards (go-live review H5): what expires, for whom, and when. */
export function ExpiringPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const lk = useHrLookups();
  const [params, setParams] = useSearchParams();
  const kind = (KINDS.includes(params.get('kind') as Kind) ? params.get('kind') : 'contracts') as Kind;
  const within = WINDOWS.includes(Number(params.get('within'))) ? Number(params.get('within')) : 90;
  const q = useQuery({
    queryKey: ['hr', 'expiring', kind, within],
    queryFn: () =>
      get<{ items: Row[]; total: number }>(`/hr/dashboard/expiring?kind=${kind}&within=${within}`),
  });
  const set = (k: Kind, w: number) => setParams({ kind: k, within: String(w) });
  const tone = (days: number) => (days <= 30 ? 'red' : days <= 60 ? 'amber' : 'slate');
  return (
    <>
      <PageHeader
        title={t('hr.expiring.title')}
        subtitle={t('hr.expiring.hint')}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => set(k, within)}
                  className={`rounded-md px-2.5 py-1.5 ${kind === k ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
                >
                  {t(`hr.expiring.kinds.${k}`)}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => set(kind, w)}
                  className={`rounded-md px-2.5 py-1.5 tabular ${within === w ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
                >
                  {t('hr.expiring.withinDays', { days: w })}
                </button>
              ))}
            </div>
          </>
        }
      />
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('hr.expiring.empty')} />
        ) : (
          <Table
            head={[
              t('hr.employee'),
              t('admin.users.department'),
              t('hr.expiring.item'),
              t('hr.expiring.expiryDate'),
              t('hr.expiring.daysLeft'),
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={`${r.employeeId}-${r.titleAr}-${r.expiryDate}`}>
                <Td>
                  <Link
                    to={`/hr/employees/${r.employeeId}`}
                    className="font-medium text-brand-800 hover:underline"
                  >
                    {r.fullNameAr}
                  </Link>
                  <div className="text-xs tabular text-slate-500">{r.employeeNumber}</div>
                </Td>
                <Td className="text-xs">{lk.deptName(r.departmentId)}</Td>
                <Td dir="auto" className="text-xs">
                  {kind === 'identities' ? t(`hr.identityTypes.${r.titleAr}`, r.titleAr) : r.titleAr}
                </Td>
                <Td className="tabular text-xs">{formatDate(r.expiryDate)}</Td>
                <Td>
                  <Badge tone={tone(r.daysLeft)}>
                    {t('hr.expiring.inDays', { days: Math.max(r.daysLeft, 0) })}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
