import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  SALES_SERVICE_TYPES,
  SALES_TARGET_DIMENSIONS,
  SALES_TARGET_METRICS,
  type SalesTargetDimension,
  type SalesTargetMetric,
} from '@eayni/shared';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { sar } from '../../hr/_data';
import { useSalesTeam } from '../_data';
import { usePriceList } from '../pricing/_data';
import { currentPeriod, tons, useSalesTargets, type TargetRow, type TargetVersion } from './_data';
import { Progress } from './SalesDashboardPage';

const fmtValue = (metric: SalesTargetMetric, v: number | null | undefined) =>
  v === null || v === undefined ? '—' : metric === 'quantity' ? tons(v) : sar(v);

/**
 * إدارة المستهدفات [SAL §11.1]: monthly targets for the department and each rep, by service or material, with the
 * actual achievement from Finance invoices. A change or withdrawal is a new version (old value, new value, editor,
 * time, reason) — nothing is overwritten. Compare months with a range.
 */
export function SalesTargetsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const compare = !!(get('from') && get('to'));
  const period = get('period') || currentPeriod();
  const canEdit = can('sales.targets', 'edit');
  const q = useSalesTargets(compare ? { from: get('from'), to: get('to') } : { period });
  const [editing, setEditing] = useState<TargetRow | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<TargetRow | null>(null);
  const [history, setHistory] = useState<TargetVersion[] | null>(null);
  const label = (r: TargetVersion & { userName?: string; dimensionLabel?: string }) => {
    const who = r.scope === 'department' ? t('sales.targets.department') : (r.userName ?? '—');
    const dim =
      r.dimension === 'service' && r.dimensionKey
        ? t(`sales.services.${r.dimensionKey}`)
        : r.dimension === 'material'
          ? (r.dimensionLabel ?? r.dimensionKey)
          : t('sales.targets.dimensions.none');
    return { who, dim };
  };
  return (
    <>
      <PageHeader
        title={t('sales.targets.title')}
        subtitle={t('sales.targets.subtitle')}
        actions={canEdit && <Button onClick={() => setEditing('new')}>{t('sales.targets.new')}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {!compare ? (
          <label className="space-y-1 text-sm text-slate-600">
            <span>{t('sales.kpi.period')}</span>
            <Input
              type="month"
              dir="ltr"
              className="w-44"
              value={period}
              onChange={(e) => e.target.value && set({ period: e.target.value })}
            />
          </label>
        ) : (
          <>
            <label className="space-y-1 text-sm text-slate-600">
              <span>{t('sales.targets.from')}</span>
              <Input
                type="month"
                dir="ltr"
                className="w-44"
                value={get('from')}
                onChange={(e) => set({ from: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm text-slate-600">
              <span>{t('sales.targets.to')}</span>
              <Input
                type="month"
                dir="ltr"
                className="w-44"
                value={get('to')}
                onChange={(e) => set({ to: e.target.value })}
              />
            </label>
          </>
        )}
        <Button
          variant="secondary"
          onClick={() =>
            compare
              ? set({ from: '', to: '', period })
              : set({ from: period.slice(0, 5) + '01', to: period, period: '' })
          }
        >
          {compare ? t('sales.targets.singleMonth') : t('sales.targets.compareMonths')}
        </Button>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || !q.data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {!q.data.financeDataAvailable && <Alert kind="info">{t('sales.kpi.noFinanceData')}</Alert>}
          <Card>
            {!q.data.items.length ? (
              <EmptyState
                title={t('sales.targets.empty')}
                hint={canEdit ? t('sales.targets.emptyHint') : undefined}
              />
            ) : (
              <Table
                head={[
                  t('sales.kpi.period'),
                  t('sales.targets.for'),
                  t('sales.targets.dimension'),
                  t('sales.targets.target'),
                  t('sales.targets.achieved'),
                  t('sales.dashboard.achievementPct'),
                  t('sales.targets.met'),
                  '',
                ]}
              >
                {q.data.items.map((r) => {
                  const l = label(r);
                  return (
                    <tr key={r._id}>
                      <Td className="tabular whitespace-nowrap">{r.period}</Td>
                      <Td className="font-medium">{l.who}</Td>
                      <Td>
                        {l.dim}
                        <span className="ms-1 text-xs text-slate-500">
                          · {t(`sales.targets.metrics.${r.metric}`)}
                        </span>
                      </Td>
                      <Td className="tabular">
                        {fmtValue(r.metric, r.value)}
                        {r.version > 1 && (
                          <span className="ms-1">
                            <Badge>v{r.version}</Badge>
                          </span>
                        )}
                      </Td>
                      <Td className="tabular">{fmtValue(r.metric, r.achieved)}</Td>
                      <Td>
                        <Progress bp={r.achievementBp} />
                      </Td>
                      <Td>
                        {r.met === null ? (
                          '—'
                        ) : r.met ? (
                          <Badge tone="green">{t('sales.targets.yes')}</Badge>
                        ) : (
                          <Badge tone="red">{t('sales.targets.no')}</Badge>
                        )}
                      </Td>
                      <Td>
                        <div className="flex gap-1 whitespace-nowrap">
                          <Button
                            variant="ghost"
                            className="min-h-9 px-2 py-1"
                            onClick={() => setHistory(r.history)}
                          >
                            {t('sales.targets.history')}
                          </Button>
                          {canEdit && (
                            <>
                              <Button
                                variant="ghost"
                                className="min-h-9 px-2 py-1"
                                onClick={() => setEditing(r)}
                              >
                                {t('actions.edit')}
                              </Button>
                              <Button
                                variant="ghost"
                                className="min-h-9 px-2 py-1"
                                onClick={() => setWithdrawing(r)}
                              >
                                {t('sales.targets.withdraw')}
                              </Button>
                            </>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
          {q.data.withdrawn.length > 0 && (
            <Card title={t('sales.targets.withdrawnTitle')}>
              <ul className="divide-y divide-slate-100 text-sm">
                {q.data.withdrawn.map((h) => {
                  const last = h[0];
                  return (
                    <li key={last.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {last.period} — {fmtValue(last.metric, last.value)} — {last.reason}
                      </span>
                      <Button variant="ghost" className="min-h-9 px-2 py-1" onClick={() => setHistory(h)}>
                        {t('sales.targets.history')}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      )}
      {editing && (
        <TargetDialog
          row={editing === 'new' ? null : editing}
          period={compare ? get('to') || currentPeriod() : period}
          onClose={() => setEditing(null)}
        />
      )}
      {withdrawing && <WithdrawDialog row={withdrawing} onClose={() => setWithdrawing(null)} />}
      {history && <HistoryDialog versions={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function TargetDialog({
  row,
  period,
  onClose,
}: {
  row: TargetRow | null;
  period: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const team = useSalesTeam();
  const prices = usePriceList();
  const [f, setF] = useState({
    period: row?.period ?? period,
    scope: (row?.scope ?? 'user') as 'department' | 'user',
    userId: row?.userId ?? '',
    dimension: (row?.dimension ?? 'none') as SalesTargetDimension,
    dimensionKey: row?.dimensionKey ?? '',
    metric: (row?.metric ?? 'revenue') as SalesTargetMetric,
    value: row ? String(row.metric === 'quantity' ? row.value / 1000 : row.value / 100) : '',
    reason: '',
  });
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: () =>
      post('/sales/management/targets', {
        period: f.period,
        scope: f.scope,
        userId: f.scope === 'user' ? f.userId : undefined,
        dimension: f.dimension,
        dimensionKey: f.dimension === 'none' ? undefined : f.dimensionKey,
        metric: f.metric,
        value: Math.round(Number(f.value) * (f.metric === 'quantity' ? 1000 : 100)),
        reason: f.reason || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales', 'targets'] });
      qc.invalidateQueries({ queryKey: ['sales', 'kpi'] });
      qc.invalidateQueries({ queryKey: ['sales', 'dashboard'] });
      toast(t('sales.targets.saved'));
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const locked = !!row;
  const materials = prices.data?.items.filter((i) => i.kind === 'material') ?? [];
  return (
    <Dialog open onClose={onClose} title={row ? t('sales.targets.editTitle') : t('sales.targets.new')}>
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        {row && <Alert kind="info">{t('sales.targets.versionHint')}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.kpi.period')} required>
            <Input
              type="month"
              dir="ltr"
              disabled={locked}
              value={f.period}
              onChange={(e) => setF({ ...f, period: e.target.value })}
            />
          </Field>
          <Field label={t('sales.targets.for')} required>
            <Select
              disabled={locked}
              value={f.scope}
              onChange={(e) => setF({ ...f, scope: e.target.value as 'department' | 'user' })}
            >
              <option value="user">{t('sales.targets.employee')}</option>
              <option value="department">{t('sales.targets.department')}</option>
            </Select>
          </Field>
        </div>
        {f.scope === 'user' && (
          <Field label={t('sales.kpi.employee')} required>
            <Select
              disabled={locked}
              value={f.userId}
              onChange={(e) => setF({ ...f, userId: e.target.value })}
            >
              <option value="">—</option>
              {team.data?.items.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.fullNameAr}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.targets.dimension')}>
            <Select
              disabled={locked}
              value={f.dimension}
              onChange={(e) =>
                setF({ ...f, dimension: e.target.value as SalesTargetDimension, dimensionKey: '' })
              }
            >
              {SALES_TARGET_DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`sales.targets.dimensions.${d}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('sales.targets.metric')}>
            <Select
              disabled={locked}
              value={f.metric}
              onChange={(e) => setF({ ...f, metric: e.target.value as SalesTargetMetric })}
            >
              {SALES_TARGET_METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`sales.targets.metrics.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {f.dimension === 'service' && (
          <Field label={t('sales.kpi.service')} required>
            <Select
              disabled={locked}
              value={f.dimensionKey}
              onChange={(e) => setF({ ...f, dimensionKey: e.target.value })}
            >
              <option value="">—</option>
              {SALES_SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`sales.services.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {f.dimension === 'material' && (
          <Field label={t('sales.pricelist.item')} required>
            <Select
              disabled={locked}
              value={f.dimensionKey}
              onChange={(e) => setF({ ...f, dimensionKey: e.target.value })}
            >
              <option value="">—</option>
              {materials.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.nameAr}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label={f.metric === 'quantity' ? t('sales.targets.valueTons') : t('sales.targets.valueSar')}
          required
        >
          <Input
            type="number"
            min={0}
            step={f.metric === 'quantity' ? '0.001' : '0.01'}
            dir="ltr"
            value={f.value}
            onChange={(e) => setF({ ...f, value: e.target.value })}
          />
        </Field>
        <Field label={t('sales.targets.reason')} required={!!row} hint={t('sales.targets.reasonHint')}>
          <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={
              !f.value ||
              (f.scope === 'user' && !f.userId) ||
              (f.dimension !== 'none' && !f.dimensionKey) ||
              (!!row && !f.reason.trim())
            }
            onClick={() => save.mutate()}
          >
            {t('actions.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function WithdrawDialog({ row, onClose }: { row: TargetRow; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const go = useMutation({
    mutationFn: () => post(`/sales/management/targets/${row._id}/withdraw`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales', 'targets'] });
      toast(t('sales.targets.withdrawn'));
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={t('sales.targets.withdraw')}>
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm text-slate-600">{t('sales.targets.withdrawHint')}</p>
        <Field label={t('sales.targets.reason')} required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={go.isPending}
            onClick={() => go.mutate()}
          >
            {t('sales.targets.withdraw')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ versions, onClose }: { versions: TargetVersion[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  return (
    <Dialog open onClose={onClose} title={t('sales.targets.historyTitle')}>
      <ol className="space-y-2 text-sm">
        {versions.map((v) => (
          <li key={v._id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                v{v.version} {v.withdrawn && <Badge tone="red">{t('sales.targets.withdrawnBadge')}</Badge>}
              </span>
              <span className="text-xs text-slate-500 tabular">
                {formatDate(v.at, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </div>
            <div className="mt-1 tabular">
              {v.previousValue !== null && (
                <>
                  <span className="text-slate-500 line-through">{fmtValue(v.metric, v.previousValue)}</span>{' '}
                  ←{' '}
                </>
              )}
              <strong>{fmtValue(v.metric, v.value)}</strong>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {t('sales.targets.by')}: {v.byName ?? '—'}
              {v.reason ? ` — ${t('sales.targets.reason')}: ${v.reason}` : ''}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.close')}
        </Button>
      </div>
    </Dialog>
  );
}
