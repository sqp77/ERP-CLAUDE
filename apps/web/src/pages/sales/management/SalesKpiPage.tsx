import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SALES_SERVICE_TYPES } from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
} from '@/shared/ui';
import { sar } from '../../hr/_data';
import { useSalesTeam } from '../_data';
import { currentPeriod, days, formatKpi, kpiTone, pct, tons, useSalesKpi, type BoardCard } from './_data';
import { Progress } from './SalesDashboardPage';

/**
 * لوحة متابعة مؤشرات الأداء [SAL §11, §11.2]: the five KPIs with target, status and pace, the §11.2 board, and the
 * average price per ton against the weekly market average per material. Filters: employee, service, period.
 */
export function SalesKpiPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const period = get('period') || currentPeriod();
  const managerView = !!user?.permissions.some(
    (p) =>
      p.resource === 'sales.kpi' && p.actions.includes('view') && p.scope !== 'own' && p.scope !== 'team',
  );
  const team = useSalesTeam(managerView);
  const q = useSalesKpi({
    period,
    userId: get('userId') || undefined,
    serviceType: get('serviceType') || undefined,
  });
  const d = q.data;
  const b = d?.board;
  return (
    <>
      <PageHeader title={t('sales.kpi.title')} subtitle={t('sales.kpi.subtitle')} />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-sm text-slate-600">
          <span>{t('sales.kpi.period')}</span>
          <Input
            type="month"
            dir="ltr"
            value={period}
            onChange={(e) => e.target.value && set('period', e.target.value)}
          />
        </label>
        {managerView && (
          <label className="space-y-1 text-sm text-slate-600">
            <span>{t('sales.kpi.employee')}</span>
            <Select value={get('userId')} onChange={(e) => set('userId', e.target.value)}>
              <option value="">{t('sales.kpi.wholeDepartment')}</option>
              {team.data?.items.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.fullNameAr}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="space-y-1 text-sm text-slate-600">
          <span>{t('sales.kpi.service')}</span>
          <Select value={get('serviceType')} onChange={(e) => set('serviceType', e.target.value)}>
            <option value="">{t('sales.kpi.allServices')}</option>
            {SALES_SERVICE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`sales.services.${s}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || !d || !b ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {!d.financeDataAvailable && <Alert kind="info">{t('sales.kpi.noFinanceData')}</Alert>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {d.kpis.map((k) => (
              <div key={k.code} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">{k.nameAr}</span>
                  <Badge tone={kpiTone[k.status]}>{t(`sales.kpi.statuses.${k.status}`)}</Badge>
                </div>
                <div className="mt-2 text-2xl font-bold tabular">{formatKpi(k.unit, k.actual)}</div>
                <div className="mt-1 text-xs text-slate-500 tabular">
                  {t('sales.kpi.target')}: {formatKpi(k.unit, k.target)}
                  {k.direction === 'lower' && k.target !== null ? ` ${t('sales.kpi.orLess')}` : ''}
                </div>
                {k.pace && (
                  <div className="mt-1 text-xs tabular">
                    <span className={k.pace === 'ahead' ? 'text-emerald-700' : 'text-amber-700'}>
                      {t(`sales.kpi.pace.${k.pace}`)}
                    </span>{' '}
                    <span className="text-slate-500">
                      ({t('sales.kpi.expectedNow')}: {formatKpi(k.unit, k.expectedNow)})
                    </span>
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-4 text-slate-500">
                  {t(`sales.kpi.how.${k.code.split('.')[1]}`)}
                </p>
              </div>
            ))}
          </div>

          <Card title={t('sales.kpi.board')}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Cell label={t('sales.dashboard.monthlyTarget')} c={b.monthlyTarget} f={(v) => sar(v)} />
              <Cell label={t('sales.kpi.achievedSales')} c={b.achieved} f={(v) => sar(v)} />
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-600">{t('sales.dashboard.achievementPct')}</div>
                <div className="mt-2">
                  <Progress bp={b.achievementBp.value} />
                </div>
              </div>
              <Cell label={t('sales.dashboard.remaining')} c={b.remaining} f={(v) => sar(v)} />
              <Cell label={t('sales.dashboard.customersNew')} c={b.newCustomers} />
              <Cell label={t('sales.kpi.opportunities')} c={b.opportunities} />
              <Cell label={t('sales.dashboard.quotesSent')} c={b.quotesSent} />
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-600">{t('sales.kpi.acceptedRejected')}</div>
                <div className="mt-1 text-lg font-semibold tabular">
                  <LinkOr c={b.quotesAccepted} className="text-emerald-700" /> /{' '}
                  <LinkOr c={b.quotesRejected} className="text-red-700" />
                </div>
              </div>
              <Cell label={t('sales.dashboard.revenue')} c={b.revenue} f={(v) => sar(v)} />
              <Cell
                label={t('sales.kpi.unpaid')}
                c={b.unpaidInvoices}
                extra={
                  b.unpaidInvoices.amountHalalas != null ? sar(b.unpaidInvoices.amountHalalas) : undefined
                }
              />
              <Cell label={t('sales.dashboard.avgCollection')} c={b.avgCollectionDays} f={(v) => days(v)} />
            </div>
            {get('serviceType') && (
              <p className="mt-3 text-xs text-slate-500">{t('sales.kpi.serviceFilterNote')}</p>
            )}
          </Card>

          <Card title={t('sales.kpi.materials')}>
            {!d.materials.length ? (
              <EmptyState title={t('sales.kpi.noMaterials')} />
            ) : (
              <Table
                head={[
                  t('sales.pricelist.item'),
                  t('sales.kpi.quantity'),
                  t('sales.kpi.revenueBeforeVat'),
                  t('sales.kpi.pricePerTon'),
                  t('sales.kpi.marketPerTon'),
                  t('sales.kpi.vsMarket'),
                ]}
              >
                {d.materials.map((m) => {
                  const diff =
                    m.pricePerTonHalalas !== null && m.marketPerTonHalalas
                      ? Math.round(
                          ((m.pricePerTonHalalas - m.marketPerTonHalalas) * 10_000) / m.marketPerTonHalalas,
                        )
                      : null;
                  return (
                    <tr key={m.itemId ?? m.nameAr}>
                      <Td className="font-medium">{m.nameAr}</Td>
                      <Td className="tabular">{tons(m.kg)}</Td>
                      <Td className="tabular">{sar(m.revenueHalalas)}</Td>
                      <Td className="tabular">
                        {m.pricePerTonHalalas === null ? '—' : sar(m.pricePerTonHalalas)}
                      </Td>
                      <Td className="tabular">
                        {m.marketPerTonHalalas === null ? (
                          <span className="text-xs text-slate-500">{t('sales.kpi.noMarketPrice')}</span>
                        ) : (
                          sar(m.marketPerTonHalalas)
                        )}
                      </Td>
                      <Td>
                        {diff === null ? (
                          '—'
                        ) : (
                          <Badge tone={diff >= 0 ? 'green' : 'red'}>
                            {diff >= 0 ? '+' : ''}
                            {pct(diff)}
                          </Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function LinkOr({ c, className }: { c: BoardCard; className?: string }) {
  const v = c.value === null ? '—' : c.value.toLocaleString('ar-SA-u-nu-latn');
  return c.link ? (
    <Link to={c.link} className={`${className ?? ''} hover:underline`}>
      {v}
    </Link>
  ) : (
    <span className={className}>{v}</span>
  );
}

function Cell({
  label,
  c,
  f,
  extra,
}: {
  label: string;
  c: BoardCard;
  f?: (v: number) => string;
  extra?: string;
}) {
  const v = c.value === null ? '—' : f ? f(c.value) : c.value.toLocaleString('ar-SA-u-nu-latn');
  const inner = (
    <>
      <div className="text-xs text-slate-600">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular">{v}</div>
      {extra && <div className="text-xs text-slate-500 tabular">{extra}</div>}
    </>
  );
  return c.link ? (
    <Link to={c.link} className="block rounded-lg bg-slate-50 p-3 hover:bg-brand-50">
      {inner}
    </Link>
  ) : (
    <div className="rounded-lg bg-slate-50 p-3">{inner}</div>
  );
}
