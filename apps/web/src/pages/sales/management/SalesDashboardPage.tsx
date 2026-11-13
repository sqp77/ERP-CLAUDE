import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Alert, Badge, Card, Input, PageHeader, QueryError, Spinner, Table, Td, cx } from '@/shared/ui';
import { sar } from '../../hr/_data';
import {
  currentPeriod,
  days,
  formatKpi,
  kpiTone,
  pct,
  useSalesDashboard,
  type BoardCard,
  type KpiValue,
} from './_data';

/**
 * لوحة التحكم الرئيسية لقسم المبيعات [SAL §13]: five groups, contents by permission (a rep sees his own), every card
 * opens the list it was counted from. Budget figures are read-only from Finance [SAL §8.3].
 */
export function SalesDashboardPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || currentPeriod();
  const q = useSalesDashboard(period);
  const d = q.data;
  return (
    <>
      <PageHeader
        title={t('sales.dashboard.title')}
        subtitle={d?.scope === 'own' ? t('sales.dashboard.subtitleOwn') : t('sales.dashboard.subtitle')}
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600">
            {t('sales.kpi.period')}
            <Input
              type="month"
              dir="ltr"
              className="w-40"
              value={period}
              onChange={(e) => e.target.value && setParams({ period: e.target.value }, { replace: true })}
            />
          </label>
        }
      />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || !d ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {!d.financeDataAvailable && <Alert kind="info">{t('sales.kpi.noFinanceData')}</Alert>}
          <KpiStrip kpis={d.kpis} />

          <Group title={t('sales.dashboard.groups.sales')}>
            <Stat label={t('sales.dashboard.revenue')} card={d.sales.revenue} money />
            <Stat label={t('sales.dashboard.achieved')} card={d.sales.achieved} money />
            <Stat label={t('sales.dashboard.monthlyTarget')} card={d.sales.monthlyTarget} money />
            <Stat
              label={t('sales.dashboard.achievementPct')}
              card={d.sales.achievementBp}
              format={(v) => pct(v)}
            />
            <Stat label={t('sales.dashboard.remaining')} card={d.sales.remaining} money />
            <Stat label={t('sales.dashboard.openDealsValue')} card={d.sales.openDealsValue} money />
            <Stat label={t('sales.dashboard.won')} card={d.sales.won} tone="green" />
            <Stat label={t('sales.dashboard.lost')} card={d.sales.lost} tone="red" />
          </Group>

          <Group title={t('sales.dashboard.groups.customers')}>
            <Stat label={t('sales.dashboard.customersTotal')} card={d.customers.total} />
            <Stat label={t('sales.dashboard.customersNew')} card={d.customers.new} />
            <Stat label={t('sales.dashboard.customersPotential')} card={d.customers.potential} />
            <Stat label={t('sales.dashboard.customersActive')} card={d.customers.active} />
            <Stat
              label={t('sales.dashboard.customersFollowUp')}
              card={d.customers.followUpDue}
              tone="amber"
            />
            <Stat label={t('sales.dashboard.customersFromCs')} card={d.customers.referredFromCs} />
          </Group>

          <Group title={t('sales.dashboard.groups.opportunities')}>
            <Stat label={t('sales.dashboard.oppNew')} card={d.opportunities.new} />
            <Stat label={t('sales.dashboard.oppInProgress')} card={d.opportunities.inProgress} />
            <Stat label={t('sales.dashboard.quotesSent')} card={d.opportunities.quotesSent} />
            <Stat
              label={t('sales.dashboard.quotesAccepted')}
              card={d.opportunities.quotesAccepted}
              tone="green"
            />
            <Stat
              label={t('sales.dashboard.quotesRejected')}
              card={d.opportunities.quotesRejected}
              tone="red"
            />
            <Stat
              label={t('sales.dashboard.oppFollowUpOverdue')}
              card={d.opportunities.followUpOverdue}
              tone="amber"
            />
          </Group>

          <Card title={t('sales.dashboard.groups.employees')}>
            <Table
              head={[
                t('sales.customers.owner'),
                t('sales.dashboard.monthlyTarget'),
                t('sales.dashboard.achieved'),
                t('sales.dashboard.achievementPct'),
                t('sales.dashboard.openTasks'),
                t('sales.dashboard.scheduledMeetings'),
              ]}
            >
              {d.employees.map((e) => (
                <tr key={e.userId}>
                  <Td className="font-medium">
                    <Link to={e.links.customers} className="text-brand-700 hover:underline">
                      {e.name}
                    </Link>
                  </Td>
                  <Td className="tabular">{e.target === null ? '—' : sar(e.target)}</Td>
                  <Td className="tabular">
                    <Link to={e.links.invoices} className="hover:underline">
                      {e.achieved === null ? '—' : sar(e.achieved)}
                    </Link>
                  </Td>
                  <Td>
                    <Progress bp={e.achievementBp} />
                  </Td>
                  <Td className="tabular">
                    <Link to={e.links.tasks} className="hover:underline">
                      {e.openTasks}
                    </Link>
                  </Td>
                  <Td className="tabular">{e.scheduledMeetings}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Group title={t('sales.dashboard.groups.collection')}>
            <Stat label={t('sales.dashboard.invoicesTotal')} card={d.collection.invoices} withAmount />
            <Stat
              label={t('sales.dashboard.invoicesPaid')}
              card={d.collection.paid}
              withAmount
              tone="green"
            />
            <Stat
              label={t('sales.dashboard.invoicesUnpaid')}
              card={d.collection.unpaid}
              withAmount
              tone="amber"
            />
            <Stat
              label={t('sales.dashboard.invoicesOverdue')}
              card={d.collection.overdue}
              withAmount
              tone="red"
            />
            <Stat
              label={t('sales.dashboard.avgCollection')}
              card={d.collection.avgCollectionDays}
              format={(v) => days(v)}
            />
          </Group>

          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <Lock className="size-4 text-slate-400" aria-hidden /> {t('sales.dashboard.groups.budget')}
              </span>
            }
          >
            <p className="mb-3 text-xs text-slate-500">{t('sales.dashboard.budgetReadOnly')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ReadOnly label={t('sales.dashboard.deptRevenue')} value={d.budget.revenueHalalas} />
              <ReadOnly label={t('sales.dashboard.spent')} value={d.budget.spentHalalas} />
              <ReadOnly
                label={t('sales.dashboard.budgetRemaining')}
                value={d.budget.remainingBudgetHalalas}
              />
            </div>
            {!d.budget.budgetsAvailable && (
              <p className="mt-3 text-xs text-slate-500">{t('sales.dashboard.noBudgetYet')}</p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
    </section>
  );
}

function Stat({
  label,
  card,
  money,
  withAmount,
  tone,
  format,
}: {
  label: string;
  card: BoardCard;
  money?: boolean;
  withAmount?: boolean;
  tone?: 'green' | 'red' | 'amber';
  format?: (v: number | null) => string;
}) {
  const value =
    card.value === null
      ? '—'
      : format
        ? format(card.value)
        : money
          ? sar(card.value)
          : card.value.toLocaleString('ar-SA-u-nu-latn');
  const body = (
    <>
      <div className="text-xs text-slate-600">{label}</div>
      <div
        className={cx(
          'mt-1 text-lg font-bold tabular sm:text-xl',
          tone === 'green' && 'text-emerald-700',
          tone === 'red' && 'text-red-700',
          tone === 'amber' && 'text-amber-700',
        )}
      >
        {value}
      </div>
      {withAmount && card.amountHalalas !== undefined && (
        <div className="mt-0.5 text-xs text-slate-500 tabular">{sar(card.amountHalalas ?? undefined)}</div>
      )}
    </>
  );
  return card.link ? (
    <Link
      to={card.link}
      className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:border-brand-300 hover:bg-brand-50/40"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">{body}</div>
  );
}

function ReadOnly({ label, value }: { label: string; value: number | null }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular text-slate-800">
        {value === null ? (
          <span className="text-sm font-normal text-slate-500">{t('sales.dashboard.noFinancialData')}</span>
        ) : (
          sar(value)
        )}
      </div>
    </div>
  );
}

export function Progress({ bp }: { bp: number | null }) {
  if (bp === null) return <span className="text-slate-400">—</span>;
  const w = Math.min(100, Math.max(0, bp / 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div
          className={cx(
            'h-full rounded-full',
            bp >= 10_000 ? 'bg-emerald-500' : bp >= 7_000 ? 'bg-amber-500' : 'bg-red-500',
          )}
          style={{ width: `${w}%` }}
        />
      </div>
      <span className="text-xs tabular">{pct(bp)}</span>
    </div>
  );
}

/** The five SAL §11 KPIs as a compact strip; the full board is on /sales/kpi. */
export function KpiStrip({ kpis }: { kpis: KpiValue[] }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {kpis.map((k) => (
        <Link
          key={k.code}
          to="/sales/kpi"
          className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:bg-slate-50"
        >
          <div className="flex flex-wrap items-start justify-between gap-1">
            <span className="text-xs text-slate-600">{k.nameAr}</span>
            <span className="shrink-0 whitespace-nowrap">
              <Badge tone={kpiTone[k.status]}>{t(`sales.kpi.statuses.${k.status}`)}</Badge>
            </span>
          </div>
          <div className="mt-1 text-lg font-bold tabular">{formatKpi(k.unit, k.actual)}</div>
          <div className="text-xs text-slate-500 tabular">
            {t('sales.kpi.target')}: {formatKpi(k.unit, k.target)}
            {k.direction === 'lower' && k.target !== null ? ` ${t('sales.kpi.orLess')}` : ''}
          </div>
        </Link>
      ))}
    </div>
  );
}
