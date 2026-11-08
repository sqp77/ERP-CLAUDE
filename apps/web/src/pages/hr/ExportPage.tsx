import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, get } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { useHrLookups } from './_data';

interface Resource {
  resource: string;
  labelAr: string;
  scope: string;
  fields: { key: string; labelAr: string; sensitive: boolean }[];
}

/** Field-picker export [HR §4]: resource → fields the viewer may see → filters → preview → Excel. Sensitive fields are flagged and audited. */
export function ExportPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const lk = useHrLookups();
  const resources = useQuery({
    queryKey: ['export', 'resources'],
    queryFn: () => get<{ items: Resource[] }>('/export/resources'),
  });
  const [resource, setResource] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const current = useMemo(
    () => resources.data?.items.find((r) => r.resource === resource),
    [resources.data, resource],
  );
  useEffect(() => {
    if (!resource && resources.data?.items.length) setResource(resources.data.items[0].resource);
  }, [resources.data, resource]);
  useEffect(() => {
    setFields(
      current?.fields
        .filter((f) => !f.sensitive)
        .slice(0, 6)
        .map((f) => f.key) ?? [],
    );
    setFilters({});
  }, [current]);
  const cleanFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const preview = useMutation({
    mutationFn: () =>
      api<{ header: string[]; rows: unknown[][]; total: number }>('/export', {
        method: 'POST',
        body: { resource, fields, filters: cleanFilters, format: 'preview' },
      }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const download = useMutation({
    mutationFn: async () => {
      const res = await api<Response>('/export', {
        method: 'POST',
        body: { resource, fields, filters: cleanFilters, format: 'xlsx', limit: 5000 },
        raw: true,
      });
      if (!res.ok) throw new Error(t('common.error'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${resource}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const toggle = (k: string) => setFields((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const hasSensitive = fields.some((k) => current?.fields.find((f) => f.key === k)?.sensitive);
  return (
    <>
      <PageHeader title={t('export.title')} subtitle={t('export.hint')} />
      {resources.isError ? (
        <QueryError error={resources.error} onRetry={() => resources.refetch()} />
      ) : resources.isLoading ? (
        <Spinner />
      ) : !resources.data?.items.length ? (
        <Alert kind="info">{t('export.none')}</Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <Card title={t('export.resource')}>
              <Select value={resource} onChange={(e) => setResource(e.target.value)}>
                {resources.data.items.map((r) => (
                  <option key={r.resource} value={r.resource}>
                    {r.labelAr}
                  </option>
                ))}
              </Select>
              {current && (
                <p className="mt-2 text-xs text-slate-500">
                  {t(`export.scopes.${current.scope}`, current.scope)}
                </p>
              )}
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
                      {f.sensitive && <Badge tone="amber">{t('export.sensitive')}</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
              {hasSensitive && <Alert kind="warning">{t('export.sensitiveHint')}</Alert>}
            </Card>
            {resource === 'employees' && (
              <Card title={t('export.filters')}>
                <div className="space-y-2">
                  <Field label={t('hr.department')}>
                    <Select
                      value={filters.departmentId ?? ''}
                      onChange={(e) => setFilters((s) => ({ ...s, departmentId: e.target.value }))}
                    >
                      <option value="">{t('common.all')}</option>
                      {lk.departments.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.nameAr}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('hr.branch')}>
                    <Select
                      value={filters.branchId ?? ''}
                      onChange={(e) => setFilters((s) => ({ ...s, branchId: e.target.value }))}
                    >
                      <option value="">{t('common.all')}</option>
                      {lk.branches.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.nameAr}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('common.status')}>
                    <Select
                      value={filters.status ?? ''}
                      onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))}
                    >
                      <option value="">{t('common.all')}</option>
                      {[
                        'active',
                        'on_leave',
                        'field_work',
                        'seconded',
                        'suspended',
                        'resigned',
                        'terminated',
                      ].map((s) => (
                        <option key={s} value={s}>
                          {t(`hr.status.${s}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('hr.nationality')}>
                    <Input
                      value={filters.nationality ?? ''}
                      onChange={(e) => setFilters((s) => ({ ...s, nationality: e.target.value }))}
                    />
                  </Field>
                </div>
              </Card>
            )}
            {resource === 'employee_reports' && (
              <Card title={t('export.filters')}>
                <Field label={t('reports.type')}>
                  <Input
                    value={filters.type ?? ''}
                    onChange={(e) => setFilters((s) => ({ ...s, type: e.target.value }))}
                    placeholder="weekly"
                    dir="ltr"
                  />
                </Field>
              </Card>
            )}
            <div className="flex gap-2">
              <Button onClick={() => preview.mutate()} disabled={!fields.length} loading={preview.isPending}>
                {t('export.preview')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => download.mutate()}
                disabled={!fields.length}
                loading={download.isPending}
              >
                {t('export.excel')}
              </Button>
            </div>
          </div>
          <Card
            title={
              preview.data
                ? t('export.previewOf', { shown: preview.data.rows.length, total: preview.data.total })
                : t('export.preview')
            }
          >
            {preview.data ? (
              <Table head={preview.data.header}>
                {preview.data.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <Td key={j} className="text-xs">
                        {v instanceof Object && 'toISOString' in (v as object)
                          ? String(v)
                          : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)
                            ? v.slice(0, 10)
                            : String(v ?? '')}
                      </Td>
                    ))}
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="text-sm text-slate-500">{t('export.previewHint')}</p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
