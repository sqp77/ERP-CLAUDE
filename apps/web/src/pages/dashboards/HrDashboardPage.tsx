import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { get } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { Card, PageHeader, QueryError, Spinner } from '@/shared/ui';
import { useHrLookups } from '../hr/_data';
import { Bars, Kpi } from './_ui';

interface Count {
  key: string;
  count: number;
  departmentId?: string;
}
interface Buckets {
  d30: number;
  d60: number;
  d90: number;
}
interface Data {
  headcount: { total: number; byDepartment: Count[]; byBranch: Count[]; byNationality: Count[]; byContractType: Count[]; byStatus: Count[] };
  expiring: { contracts: Buckets; identities: Buckets; documents: Buckets };
  requests: { open: number; byType: Count[]; byPendingWith: Count[]; byAge: { d0_2: number; d3_7: number; d8plus: number } };
  secondmentsWithoutReport: number;
  probationEnding30: number;
  recentChanges: { _id: string; employeeId: string; type: string; at: string; effectiveDate?: string }[];
}

/** HR dashboard [HR §5]: only cards whose data exists in phase 1; attendance, appraisals and training come with their modules. */
export function HrDashboardPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const lk = useHrLookups();
  const q = useQuery({ queryKey: ['dashboard', 'hr'], queryFn: () => get<Data>('/hr/dashboard/hr') });
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const b = (x: Buckets) => `${x.d30} / ${x.d60} / ${x.d90}`;
  return (
    <>
      <PageHeader title={t('dash.hr.title')} subtitle={t('dash.hr.hint')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi to="/hr/employees" label={t('dash.hr.headcount')} value={d.headcount.total} />
        <Kpi to="/hr/requests" label={t('dash.hr.openRequests')} value={d.requests.open} tone={d.requests.open ? 'amber' : 'slate'} hint={`${t('dash.hr.age8')}: ${d.requests.byAge.d8plus}`} />
        <Kpi to="/hr/secondments" label={t('dash.hr.secondmentsNoReport')} value={d.secondmentsWithoutReport} tone={d.secondmentsWithoutReport ? 'red' : 'green'} />
        <Kpi to="/hr/employees" label={t('dash.hr.probation30')} value={d.probationEnding30} tone="blue" />
        <Kpi to="/hr/employees" label={t('dash.hr.contractsExpiring')} value={b(d.expiring.contracts)} hint={t('dash.hr.bucketsHint')} tone="amber" />
        <Kpi to="/hr/employees" label={t('dash.hr.identitiesExpiring')} value={b(d.expiring.identities)} hint={t('dash.hr.bucketsHint')} tone="amber" />
        <Kpi to="/hr/employees" label={t('dash.hr.documentsExpiring')} value={b(d.expiring.documents)} hint={t('dash.hr.bucketsHint')} tone="amber" />
        <Kpi to="/hr/export" label={t('dash.hr.export')} value="↧" hint={t('dash.hr.exportHint')} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={t('dash.hr.byDepartment')}>
          <Bars items={d.headcount.byDepartment} linkFor={(k) => { const id = d.headcount.byDepartment.find((x) => x.key === k.key)?.departmentId; return id ? `/hr/employees?departmentId=${id}` : undefined; }} />
        </Card>
        <Card title={t('dash.hr.byBranch')}>
          <Bars items={d.headcount.byBranch} />
        </Card>
        <Card title={t('dash.hr.byNationality')}>
          <Bars items={d.headcount.byNationality} />
        </Card>
        <Card title={t('dash.hr.byContractType')}>
          <Bars items={d.headcount.byContractType.map((x) => ({ ...x, key: t(`hr.contractTypes.${x.key}`, x.key) }))} />
        </Card>
        <Card title={t('dash.hr.byStatus')}>
          <Bars items={d.headcount.byStatus.map((x) => ({ key: t(`hr.status.${x.key}`, x.key), count: x.count, to: `/hr/employees?status=${x.key}` }))} />
        </Card>
        <Card title={t('dash.hr.requestsByType')}>
          <Bars items={d.requests.byType.map((x) => ({ key: t(`requests.types.${x.key}`, x.key), count: x.count, to: `/hr/requests?type=${x.key}` }))} />
          <div className="mt-3 text-xs text-slate-500">
            {t('dash.hr.pendingWith')}: {d.requests.byPendingWith.map((x) => `${t(`requests.pendingWith.${x.key}`, x.key)} ${x.count}`).join(' · ') || '—'}
            <br />
            {t('dash.hr.age')}: 0–2: {d.requests.byAge.d0_2} · 3–7: {d.requests.byAge.d3_7} · 8+: {d.requests.byAge.d8plus}
          </div>
        </Card>
        <Card title={t('dash.hr.recentChanges')}>
          {d.recentChanges.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.recentChanges.map((c) => (
                <li key={c._id} className="flex items-center justify-between py-1.5">
                  <Link to={`/hr/employees/${c.employeeId}`} className="text-brand-800 hover:underline">
                    {lk.employeeName(c.employeeId) || t(`hr.events.${c.type}`, c.type)}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {t(`hr.events.${c.type}`, c.type)} · {formatDate(c.effectiveDate ?? c.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{t('common.empty')}</p>
          )}
        </Card>
      </div>
    </>
  );
}
