import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { Badge, Button, Card, EmptyState, Input, PageHeader, QueryError, Select, Spinner, Table, Td } from '@/shared/ui';
import { NewReportDialog } from './NewReportDialog';
import { typeLabel, useReportRequests, useReportTypes, useReports, type ReportRequestRow } from './_data';

type View = 'mine' | 'team' | 'all';

/** My reports [EP §14] and, for managers / HR, the reports of my team; search by employee, period and type [EP §14.3]. */
export function ReportsListPage({ view: initial }: { view: View }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { user, can } = useAuth();
  const [view, setView] = useState<View>(initial);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<ReportRequestRow | null | false>(false);
  const types = useReportTypes();
  const requests = useReportRequests();
  const scope = user?.permissions.find((p) => p.resource === 'hr.reports')?.scope ?? 'own';
  const views: View[] = scope === 'own' ? ['mine'] : scope === 'all' ? ['mine', 'team', 'all'] : ['mine', 'team'];
  const list = useReports({ view, type: type || undefined, q: q || undefined, from: from ? `${from}T00:00:00+03:00` : undefined, to: to ? `${to}T23:59:59+03:00` : undefined, limit: 100 });
  return (
    <>
      <PageHeader
        title={t('reports.title')}
        actions={
          <>
            {views.length > 1 && (
              <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                {views.map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1.5 ${view === v ? 'bg-brand-700 text-white' : 'text-slate-600'}`}>
                    {t(`reports.views.${v}`)}
                  </button>
                ))}
              </div>
            )}
            {can('hr.reports', 'create') && <Button onClick={() => setOpen(null)}>{t('reports.new')}</Button>}
          </>
        }
      />
      {!!requests.data?.items.length && (
        <Card title={t('reports.requested')} className="mb-3">
          <ul className="divide-y divide-slate-100 text-sm">
            {requests.data.items.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{typeLabel(types.data?.items, r.type)}</strong>
                  {r.note && <span className="text-slate-600"> — {r.note}</span>}
                  <span className="ms-2 text-xs text-slate-500">
                    {r.managerName}
                    {r.dueDate ? ` · ${t('reports.due')} ${formatDate(r.dueDate)}` : ''}
                  </span>
                </span>
                <Button variant="secondary" onClick={() => setOpen(r)}>
                  {t('reports.answer')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('reports.type')}>
          <option value="">{t('tickets.allTypes')}</option>
          {types.data?.items.map((x) => (
            <option key={x.code} value={x.code}>
              {x.labelAr}
            </option>
          ))}
        </Select>
        <Input placeholder={t('actions.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('reports.periodFrom')} />
        <Input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('reports.periodTo')} />
      </div>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('reports.empty')} />
        ) : (
          <Table head={[t('common.number'), t('reports.reportTitle'), ...(view !== 'mine' ? [t('common.name')] : []), t('reports.type'), t('reports.period'), t('common.date'), t('common.status')]}>
            {list.data.items.map((r) => (
              <tr key={r._id}>
                <Td className="tabular text-xs text-slate-500">
                  <Link to={`/reports/${r._id}`} className="text-brand-800 hover:underline">
                    {r.number}
                  </Link>
                </Td>
                <Td className="font-medium">
                  <Link to={`/reports/${r._id}`} className="hover:underline">
                    {r.title}
                  </Link>
                </Td>
                {view !== 'mine' && <Td>{r.employee?.fullNameAr}</Td>}
                <Td>{typeLabel(types.data?.items, r.type)}</Td>
                <Td className="tabular text-xs">{r.periodFrom || r.periodTo ? `${formatDate(r.periodFrom)} – ${formatDate(r.periodTo)}` : '—'}</Td>
                <Td className="tabular text-xs">{formatDate(r.submittedAt)}</Td>
                <Td>
                  <Badge tone={r.state === 'reviewed' ? 'green' : 'blue'}>{t(`reports.states.${r.state}`)}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewReportDialog open={open !== false} onClose={() => setOpen(false)} answering={open === false ? null : open} />
    </>
  );
}
