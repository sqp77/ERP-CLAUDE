import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get, post } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { errorMessage } from '@/lib/errors';
import { Alert, Badge, Button, Card, Dialog, Field, PageHeader, Spinner, Textarea, cx } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { downloadAttachment } from '@/shared/files/FileUploader';
import { sar } from '../hr/_data';
import { stateTone, type HrRequestDetail } from './_data';

/** Request details: fields, action log and stage log [HR §3.5 "سجل الإجراءات"], and the actions open to me. */
export function RequestDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['hr-request', id],
    queryFn: () => get<HrRequestDetail>(`/hr/requests/${id}`),
  });
  const [dialog, setDialog] = useState<'reject' | 'return' | null>(null);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: (body: { transition: string; reason?: string }) =>
      post(`/hr/requests/${id}/transition`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-request', id] });
      qc.invalidateQueries({ queryKey: ['hr-requests'] });
      setDialog(null);
      setReason('');
      toast(t('actions.save'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const cert = async () => {
    const r = await get<{ url: string }>(`/hr/requests/${id}/certificate`);
    window.open(r.url, '_blank', 'noopener');
  };

  if (q.isLoading) return <Spinner />;
  if (!q.data) return <Alert kind="error">{t('common.error')}</Alert>;
  const r = q.data;
  const d = r.details as Record<
    string,
    string | number | boolean | { field: string; currentValue?: string; newValue: string }[]
  >;
  const fieldLabel = (k: string) => t(`requests.fields.${k}`, k);
  const fieldValue = (k: string, v: unknown): string => {
    if (k === 'amountHalalas') return sar(Number(v));
    if (k === 'leaveType') return t(`requests.leaveTypes.${v}`);
    if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
    if (k.endsWith('Date') || k === 'date') return formatDate(String(v));
    return String(v ?? '');
  };

  return (
    <>
      <PageHeader
        title={`${t(`requests.types.${r.type}`)} ${r.number}`}
        subtitle={r.employee ? `${r.employee.fullNameAr} · ${r.employee.employeeNumber}` : undefined}
        actions={
          <>
            <Badge tone={stateTone[r.state] ?? 'slate'}>{t(`requests.states.${r.state}`)}</Badge>
            {r.handoff?.status === 'waiting' && <Badge tone="brand">{t('requests.withFinance')}</Badge>}
            <Link to="/me/requests" className="text-sm text-brand-700 hover:underline">
              {t('actions.back')}
            </Link>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <Card title={t('requests.details')}>
            <dl>
              {Object.entries(d).map(([k, v]) =>
                k === 'changes' && Array.isArray(v) ? (
                  <div key={k} className="py-1.5 text-sm">
                    <dt className="text-slate-500">{t('requests.fields.changes')}</dt>
                    <dd>
                      <ul className="list-disc ps-5">
                        {v.map((c, i) => (
                          <li key={i}>
                            {c.field}: {c.currentValue ?? '—'} ← <strong>{c.newValue}</strong>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : (
                  <div key={k} className="grid grid-cols-[150px_1fr] gap-2 py-1.5 text-sm">
                    <dt className="text-slate-500">{fieldLabel(k)}</dt>
                    <dd className="text-slate-900">{fieldValue(k, v)}</dd>
                  </div>
                ),
              )}
              {r.notes && (
                <div className="grid grid-cols-[150px_1fr] gap-2 py-1.5 text-sm">
                  <dt className="text-slate-500">{t('hr.notes')}</dt>
                  <dd>{r.notes}</dd>
                </div>
              )}
              <div className="grid grid-cols-[150px_1fr] gap-2 py-1.5 text-sm">
                <dt className="text-slate-500">{t('hr.directManager')}</dt>
                <dd>{r.directManager?.displayNameAr ?? '—'}</dd>
              </div>
              <div className="grid grid-cols-[150px_1fr] gap-2 py-1.5 text-sm">
                <dt className="text-slate-500">{t('requests.dueAt')}</dt>
                <dd className="tabular">{r.dueAt && !r.closedAt ? formatDateTime(r.dueAt) : '—'}</dd>
              </div>
            </dl>
            {r.flags?.length > 0 && (
              <Alert kind="warning">{r.flags.map((f) => t(`requests.flags.${f}`, f)).join(' · ')}</Alert>
            )}
            {r.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.attachments.map((a) => (
                  <Button key={a._id} variant="secondary" onClick={() => downloadAttachment(a._id)}>
                    📎 {a.originalName}
                  </Button>
                ))}
              </div>
            )}
            {r.decision?.reason && (
              <p className="mt-3 text-sm text-slate-700">
                <strong>{t('requests.decisionReason')}:</strong> {r.decision.reason}
              </p>
            )}
            {r.certificate && (
              <div className="mt-3 flex items-center gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                <span>{t('requests.certificateIssued', { number: r.certificate.number })}</span>
                <Button variant="secondary" onClick={cert}>
                  {t('requests.openCertificate')}
                </Button>
              </div>
            )}
          </Card>

          {r.actions.length > 0 && (
            <Card title={t('requests.actions')}>
              <div className="flex flex-wrap gap-2">
                {r.actions.includes('approve') && (
                  <Button onClick={() => act.mutate({ transition: 'approve' })} loading={act.isPending}>
                    {t('requests.approve')}
                  </Button>
                )}
                {r.actions.includes('reject') && (
                  <Button variant="danger" onClick={() => setDialog('reject')}>
                    {t('requests.reject')}
                  </Button>
                )}
                {r.actions.includes('return') && (
                  <Button variant="secondary" onClick={() => setDialog('return')}>
                    {t('requests.return')}
                  </Button>
                )}
                {r.actions.includes('resubmit') && (
                  <Button onClick={() => act.mutate({ transition: 'resubmit' })} loading={act.isPending}>
                    {t('requests.resubmit')}
                  </Button>
                )}
                {r.actions.includes('close') && (
                  <Button variant="secondary" onClick={() => act.mutate({ transition: 'close' })}>
                    {t('requests.close')}
                  </Button>
                )}
              </div>
              {r.actions.includes('resubmit') && (
                <p className="mt-2 text-xs text-slate-500">{t('requests.resubmitHint')}</p>
              )}
            </Card>
          )}
        </div>

        <Card title={t('requests.log')}>
          <ol className="relative space-y-4 border-s border-slate-200 ps-4">
            {r.history.actions.map((a) => (
              <li key={a._id} className="relative">
                <span
                  className={cx(
                    'absolute -start-[21px] top-1.5 size-2.5 rounded-full',
                    a.toState === 'rejected'
                      ? 'bg-red-500'
                      : a.toState === 'approved'
                        ? 'bg-emerald-500'
                        : 'bg-brand-600',
                  )}
                  aria-hidden
                />
                <div className="text-sm font-medium">
                  {t(`requests.actionsLog.${a.action}`, a.action)}
                  {a.toState && a.toState !== a.fromState && (
                    <span className="ms-2 text-xs text-slate-500">← {t(`requests.states.${a.toState}`)}</span>
                  )}
                </div>
                {a.note && <div className="text-xs text-slate-600">{a.note}</div>}
                <div className="text-xs text-slate-400 tabular">
                  {formatDateTime(a.at)} · {a.actorEmail}
                  {a.actorRole ? ` · ${t(`requests.roles.${a.actorRole}`, a.actorRole)}` : ''}
                </div>
              </li>
            ))}
          </ol>
          {r.history.stages.some((s) => s.overdue) && (
            <p className="mt-3 text-xs text-red-700">{t('requests.hadOverdueStage')}</p>
          )}
        </Card>
      </div>

      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'reject' ? t('requests.reject') : t('requests.return')}
      >
        <div className="space-y-3">
          <Field label={t('requests.reasonRequired')} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant={dialog === 'reject' ? 'danger' : 'primary'}
              disabled={reason.trim().length < 2}
              loading={act.isPending}
              onClick={() => act.mutate({ transition: dialog!, reason })}
            >
              {dialog === 'reject' ? t('requests.reject') : t('requests.return')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
