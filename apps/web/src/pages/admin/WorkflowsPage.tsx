import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkflowDefinition } from '@eayni/shared';
import { get } from '@/lib/api';
import { Badge, Card, PageHeader, Spinner, Table, Td, QueryError } from '@/shared/ui';

/** Workflow definitions (states, SLA, transitions). Read-only view; the JSON editor comes with phase 1 admin screens. */
export function WorkflowsPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['workflows'],
    queryFn: () => get<{ items: WorkflowDefinition[] }>('/workflows'),
  });
  const tone = { open: 'blue', waiting: 'amber', done: 'green', cancelled: 'slate' } as const;
  return (
    <>
      <PageHeader title={t('admin.workflows.title')} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {q.data?.items.map((w) => (
            <Card
              key={w.type}
              title={
                <span>
                  {w.nameAr}{' '}
                  <code className="ms-2 text-xs text-slate-400">
                    {w.type} v{w.version}
                  </code>
                </span>
              }
            >
              <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('admin.workflows.states')}</h3>
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(w.states).map(([code, s]) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  >
                    <Badge tone={tone[s.category]}>{s.labelAr}</Badge>
                    {s.slaBusinessDays && (
                      <span className="text-slate-500">
                        {t('admin.workflows.sla')}: {s.slaBusinessDays}
                      </span>
                    )}
                  </span>
                ))}
              </div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                {t('admin.workflows.transitions')}
              </h3>
              <Table
                head={[
                  t('admin.workflows.transition'),
                  t('admin.workflows.from'),
                  t('admin.workflows.to'),
                  t('admin.workflows.who'),
                  t('admin.workflows.requiredFields'),
                ]}
              >
                {w.transitions.map((tr) => (
                  <tr key={tr.code}>
                    <Td className="font-medium">
                      {tr.labelAr} <code className="text-xs text-slate-400">{tr.code}</code>
                    </Td>
                    <Td className="text-xs">
                      {tr.from.map((f) => w.states[f]?.labelAr ?? f).join(t('common.listSeparator'))}
                    </Td>
                    <Td className="text-xs">{w.states[tr.to]?.labelAr ?? tr.to}</Td>
                    <Td className="text-xs" dir="ltr">
                      {tr.allow.join(', ')}
                    </Td>
                    <Td className="text-xs" dir="ltr">
                      {tr.requiredFields.join(', ')}
                      {tr.requireReason ? ' + reason' : ''}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
