import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { REQUEST_HOLDERS, SALES_SERVICE_TYPES, type RequestHolder } from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
  cx,
} from '@/shared/ui';
import { holderTone, stateTone, useRequests, useRequestsMeta } from './_data';

/**
 * الطلبات البيعية [SAL §5, §18] for Sales, and «الطلبات الواردة من المبيعات» for Procurement / Finance / Operations
 * (`incoming` view: what the caller's department holds now; `history` adds what it held before).
 */
export function RequestsPage({ incoming = false }: { incoming?: boolean }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };
  const meta = useRequestsMeta();
  const holder = get('holder') as RequestHolder | '';
  const list = useRequests({
    view: incoming ? 'incoming' : get('view') || undefined,
    holder: holder || undefined,
    includeHistory: incoming && get('history') === 'true',
    type: get('type') || undefined,
    state: get('state') || undefined,
    open: get('open') === 'true',
    overdue: get('overdue') === 'true',
    q: get('q') || undefined,
    limit: 200,
  });
  return (
    <>
      <PageHeader
        title={incoming ? t('sales.requests.incomingTitle') : t('sales.requests.title')}
        subtitle={incoming ? t('sales.requests.incomingSubtitle') : undefined}
        actions={
          !incoming && can('sales.requests', 'create') ? (
            <div className="flex flex-wrap gap-2">
              <Select
                value=""
                onChange={(e) => e.target.value && nav(`/sales/requests/new/${e.target.value}`)}
                aria-label={t('sales.services.title')}
              >
                <option value="">{t('sales.requests.newByService')}</option>
                {SALES_SERVICE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sales.services.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input
          value={get('q')}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={t('actions.search')}
          aria-label={t('actions.search')}
        />
        <Select
          value={get('type')}
          onChange={(e) => setParam('type', e.target.value)}
          aria-label={t('sales.services.title')}
        >
          <option value="">{t('sales.services.all')}</option>
          {SALES_SERVICE_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.services.${s}`)}
            </option>
          ))}
        </Select>
        {incoming ? (
          (meta.data?.incomingHolders.length ?? 0) > 1 && (
            <Select
              value={holder}
              onChange={(e) => setParam('holder', e.target.value)}
              aria-label={t('sales.requests.holder')}
            >
              <option value="">{t('common.all')}</option>
              {meta.data!.incomingHolders.map((h) => (
                <option key={h} value={h}>
                  {t(`sales.requests.holders.${h}`)}
                </option>
              ))}
            </Select>
          )
        ) : (
          <Select
            value={holder}
            onChange={(e) => setParam('holder', e.target.value)}
            aria-label={t('sales.requests.holder')}
          >
            <option value="">{t('sales.requests.allHolders')}</option>
            {REQUEST_HOLDERS.map((h) => (
              <option key={h} value={h}>
                {t(`sales.requests.holders.${h}`)}
              </option>
            ))}
          </Select>
        )}
        {!incoming && (
          <Select
            value={get('view')}
            onChange={(e) => setParam('view', e.target.value)}
            aria-label={t('sales.requests.view')}
          >
            <option value="">{t('sales.requests.views.all')}</option>
            <option value="mine">{t('sales.requests.views.mine')}</option>
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('open') === 'true'}
            onChange={(e) => setParam('open', e.target.checked)}
          />{' '}
          {t('sales.requests.openOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('overdue') === 'true'}
            onChange={(e) => setParam('overdue', e.target.checked)}
          />{' '}
          {t('sales.requests.overdueOnly')}
        </label>
        {incoming && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={get('history') === 'true'}
              onChange={(e) => setParam('history', e.target.checked)}
            />{' '}
            {t('sales.requests.includeHistory')}
          </label>
        )}
      </div>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('sales.requests.empty')} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table
                head={[
                  t('common.number'),
                  t('sales.services.title'),
                  t('sales.customers.nameAr'),
                  t('sales.customers.owner'),
                  t('sales.requests.holder'),
                  t('common.status'),
                  t('sales.requests.dueAt'),
                ]}
              >
                {list.data.items.map((r) => (
                  <tr
                    key={r._id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => nav(`/sales/requests/${r._id}`)}
                  >
                    <Td className="tabular text-xs text-slate-500">{r.number}</Td>
                    <Td className="font-medium">{t(`sales.services.${r.type}`)}</Td>
                    <Td>{r.customerName}</Td>
                    <Td>{r.ownerName}</Td>
                    <Td>
                      <Badge tone={holderTone[r.holder]}>{t(`sales.requests.holders.${r.holder}`)}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={stateTone(r.state)}>{r.stateAr}</Badge>
                    </Td>
                    <Td className={cx('tabular', r.overdue && 'text-red-700')}>
                      {r.dueAt ? formatDate(r.dueAt) : '—'}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {list.data.items.map((r) => (
                <li key={r._id} className="py-3">
                  <Link to={`/sales/requests/${r._id}`} className="block">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t(`sales.services.${r.type}`)}</span>
                      <Badge tone={stateTone(r.state)}>{r.stateAr}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {r.number} · {r.customerName} · {t(`sales.requests.holders.${r.holder}`)}
                      {r.overdue && <span className="text-red-700"> · {t('sales.requests.overdue')}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {!incoming && can('sales.requests', 'create') && (
        <div className="mt-3 md:hidden">
          <Button className="w-full" onClick={() => nav('/sales')}>
            {t('sales.services.title')}
          </Button>
        </div>
      )}
    </>
  );
}
