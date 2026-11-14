import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SALES_REPORTS, SALES_REPORT_GROUPS, SALES_SERVICE_TYPES } from '@eayni/shared';
import { api, get } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { useSalesTeam } from '../_data';
import { currentPeriod } from './_data';

interface Resource {
  resource: string;
  labelAr: string;
  scope: string;
  fields: { key: string; labelAr: string; sensitive: boolean }[];
}
interface Preview {
  header: string[];
  columns: { key: string; kind?: 'date' | 'datetime' | 'money' }[];
  rows: unknown[][];
  total: number;
}
const PREFIX = 'sales.report.';

function monthBounds(period: string) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/**
 * التقارير والمخرجات [SAL §12]: the five report groups for the Sales manager and the executive. Choose a report, the
 * period, the employee, the service and the report's own variant; pick the fields; preview; export to Excel or PDF.
 * The server applies the caller's permissions to every row (SAL §12 «مراعاة صلاحيات المستخدم»).
 */
export function SalesReportsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { formatDate, formatDateTime } = usePrefs();
  const resources = useQuery({
    queryKey: ['export', 'resources'],
    queryFn: () => get<{ items: Resource[] }>('/export/resources'),
  });
  const team = useSalesTeam();
  const available = useMemo(
    () =>
      new Map(
        (resources.data?.items ?? [])
          .filter((r) => r.resource.startsWith(PREFIX))
          .map((r) => [r.resource, r]),
      ),
    [resources.data],
  );
  const [code, setCode] = useState(SALES_REPORTS[0].code);
  const def = SALES_REPORTS.find((r) => r.code === code)!;
  const current = available.get(PREFIX + code);
  const month = monthBounds(currentPeriod());
  const [filters, setFilters] = useState<Record<string, string>>({ from: month.from, to: month.to });
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    setFields(current?.fields.map((f) => f.key) ?? []);
    setFilters((s) => ({
      from: s.from,
      to: s.to,
      ownerUserId: s.ownerUserId ?? '',
      serviceType: s.serviceType ?? '',
      ...(def.segments ? { segment: def.segments[0] } : {}),
      ...(def.granularity ? { granularity: 'day' } : {}),
    }));
  }, [current, def.segments, def.granularity]);
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const body = (format: 'preview' | 'xlsx' | 'pdf') => ({
    resource: PREFIX + code,
    fields,
    filters: clean,
    format,
    limit: 5000,
  });
  const preview = useMutation({
    mutationFn: () => api<Preview>('/export', { method: 'POST', body: body('preview') }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const download = useMutation({
    mutationFn: async (format: 'xlsx' | 'pdf') => {
      const res = await api<Response>('/export', { method: 'POST', body: body(format), raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(format === 'pdf' ? new Blob([blob], { type: 'text/html' }) : blob);
      if (format === 'pdf') window.open(url, '_blank', 'noopener');
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${code}-${filters.from ?? ''}-${filters.to ?? ''}.xlsx`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  useEffect(() => preview.reset(), [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const cell = (v: unknown, kind?: 'date' | 'datetime' | 'money') => {
    if (v === null || v === undefined || v === '') return '—';
    if (kind === 'date') return formatDate(v as string);
    if (kind === 'datetime') return formatDateTime(v as string);
    if (kind === 'money' && typeof v === 'number')
      return `${v.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('common.currency')}`;
    if (typeof v === 'number') return v.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 3 });
    return String(v);
  };
  const set = (k: string, v: string) => setFilters((s) => ({ ...s, [k]: v }));
  const toggle = (k: string) => setFields((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <>
      <PageHeader title={t('sales.reports.title')} subtitle={t('sales.reports.subtitle')} />
      {resources.isError ? (
        <QueryError error={resources.error} onRetry={() => resources.refetch()} />
      ) : resources.isLoading ? (
        <Spinner />
      ) : !available.size ? (
        <Alert kind="info">{t('sales.reports.none')}</Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <Card title={t('sales.reports.choose')}>
              <div className="space-y-3">
                {SALES_REPORT_GROUPS.map((g) => (
                  <div key={g}>
                    <h3 className="mb-1 text-xs font-semibold text-slate-500">
                      {t(`sales.reports.groups.${g}`)}
                    </h3>
                    <ul className="space-y-1">
                      {SALES_REPORTS.filter((r) => r.group === g && available.has(PREFIX + r.code)).map(
                        (r) => (
                          <li key={r.code}>
                            <button
                              type="button"
                              onClick={() => setCode(r.code)}
                              aria-pressed={code === r.code}
                              className={cx(
                                'w-full rounded-md px-2 py-1.5 text-start text-sm',
                                code === r.code
                                  ? 'bg-brand-700 text-white'
                                  : 'text-slate-700 hover:bg-slate-50',
                              )}
                            >
                              {available.get(PREFIX + r.code)?.labelAr}
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
            <Card title={t('sales.reports.filters')}>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('sales.targets.from')}>
                    <Input
                      type="date"
                      dir="ltr"
                      value={filters.from ?? ''}
                      onChange={(e) => set('from', e.target.value)}
                    />
                  </Field>
                  <Field label={t('sales.targets.to')}>
                    <Input
                      type="date"
                      dir="ltr"
                      value={filters.to ?? ''}
                      onChange={(e) => set('to', e.target.value)}
                    />
                  </Field>
                </div>
                {def.granularity && (
                  <Field label={t('sales.reports.granularity')}>
                    <Select
                      value={filters.granularity ?? 'day'}
                      onChange={(e) => set('granularity', e.target.value)}
                    >
                      {(['day', 'week', 'month'] as const).map((g) => (
                        <option key={g} value={g}>
                          {t(`sales.reports.granularities.${g}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {def.segments && (
                  <Field label={t('sales.reports.segment')}>
                    <Select
                      value={filters.segment ?? def.segments[0]}
                      onChange={(e) => set('segment', e.target.value)}
                    >
                      {def.segments.map((s) => (
                        <option key={s} value={s}>
                          {t(`sales.reports.segments.${code}.${s}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label={t('sales.kpi.employee')}>
                  <Select
                    value={filters.ownerUserId ?? ''}
                    onChange={(e) => set('ownerUserId', e.target.value)}
                  >
                    <option value="">{t('sales.kpi.wholeDepartment')}</option>
                    {team.data?.items.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.fullNameAr}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('sales.kpi.service')}>
                  <Select
                    value={filters.serviceType ?? ''}
                    onChange={(e) => set('serviceType', e.target.value)}
                  >
                    <option value="">{t('sales.kpi.allServices')}</option>
                    {SALES_SERVICE_TYPES.map((s) => (
                      <option key={s} value={s}>
                        {t(`sales.services.${s}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Card>
            <Card title={t('export.fields')}>
              <ul className="space-y-1 text-sm">
                {current?.fields.map((f) => (
                  <li key={f.key}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={fields.includes(f.key)}
                        onChange={() => toggle(f.key)}
                      />
                      <span>{f.labelAr}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => preview.mutate()} disabled={!fields.length} loading={preview.isPending}>
                {t('export.preview')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => download.mutate('xlsx')}
                disabled={!fields.length}
                loading={download.isPending && download.variables === 'xlsx'}
              >
                {t('export.excel')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => download.mutate('pdf')}
                disabled={!fields.length}
                loading={download.isPending && download.variables === 'pdf'}
              >
                {t('sales.reports.pdf')}
              </Button>
            </div>
          </div>
          <Card
            title={
              preview.data
                ? t('export.previewOf', { shown: preview.data.rows.length, total: preview.data.total })
                : current?.labelAr
            }
          >
            {preview.isPending ? (
              <Spinner />
            ) : preview.data ? (
              preview.data.rows.length ? (
                <Table head={preview.data.header}>
                  {preview.data.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((v, j) => (
                        <Td key={j} className="text-xs tabular">
                          {cell(v, preview.data!.columns[j]?.kind)}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </Table>
              ) : (
                <EmptyState title={t('sales.reports.noRows')} />
              )
            ) : (
              <p className="text-sm text-slate-500">{t('sales.reports.previewHint')}</p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
