import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HR_REQUEST_TYPES } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, Table, Td } from '@/shared/ui';
import { NewRequestDialog } from './NewRequestDialog';
import { stateTone, type HrRequestRow } from './_data';

type View = 'mine' | 'inbox' | 'queue' | 'all';

/** Requests list in three guises: my requests [HR §3.5], the direct manager's inbox, the HR/Finance queue. */
export function RequestsListPage({ view }: { view: View }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [open, setOpen] = useState(false);
  const params = new URLSearchParams({
    view,
    limit: '100',
    ...(type ? { type } : {}),
    ...(state ? { state } : {}),
  });
  const q = useQuery({
    queryKey: ['hr-requests', view, type, state],
    queryFn: () => get<Paged<HrRequestRow>>(`/hr/requests?${params}`),
  });
  const titles: Record<View, string> = {
    mine: t('requests.mine'),
    inbox: t('requests.inbox'),
    queue: t('requests.queue'),
    all: t('requests.all'),
  };
  const states = [
    'awaiting_manager',
    'awaiting_hr',
    'awaiting_final',
    'needs_completion',
    'approved',
    'rejected',
  ];
  return (
    <>
      <PageHeader
        title={titles[view]}
        subtitle={
          view === 'inbox' ? t('requests.inboxHint') : view === 'queue' ? t('requests.queueHint') : undefined
        }
        actions={view === 'mine' && <Button onClick={() => setOpen(true)}>{t('requests.new')}</Button>}
      />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">
              {t('requests.type')}: {t('common.all')}
            </option>
            {HR_REQUEST_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`requests.types.${x}`)}
              </option>
            ))}
          </Select>
          {view !== 'inbox' && (
            <Select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">
                {t('common.status')}: {t('common.all')}
              </option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {t(`requests.states.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </div>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('requests.empty')} />
        ) : (
          <Table
            head={[
              '#',
              t('requests.type'),
              ...(view !== 'mine' ? [t('hr.directory')] : []),
              t('common.date'),
              t('requests.dueAt'),
              t('common.status'),
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={r._id}>
                <Td className="tabular text-xs">
                  <Link to={`/me/requests/${r._id}`} className="text-brand-800 hover:underline">
                    {r.number}
                  </Link>
                </Td>
                <Td className="font-medium">
                  {t(`requests.types.${r.type}`)}
                  {r.flags?.length > 0 && <span className="ms-1 text-xs text-amber-700">⚑</span>}
                </Td>
                {view !== 'mine' && (
                  <Td>
                    {r.employee?.fullNameAr}
                    <div className="text-xs text-slate-500">{r.employee?.employeeNumber}</div>
                  </Td>
                )}
                <Td className="tabular text-xs">{formatDate(r.createdAt)}</Td>
                <Td className="tabular text-xs">
                  {r.dueAt && !r.closedAt ? (
                    <span className={new Date(r.dueAt) < new Date() ? 'font-semibold text-red-700' : ''}>
                      {formatDate(r.dueAt)}
                    </span>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  <Badge tone={stateTone[r.state] ?? 'slate'}>{t(`requests.states.${r.state}`)}</Badge>
                  {r.handoff?.status === 'waiting' && <Badge tone="brand">{t('requests.withFinance')}</Badge>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewRequestDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
