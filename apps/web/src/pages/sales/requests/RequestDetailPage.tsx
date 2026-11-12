import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { RENTAL_INSPECTION_PHASES, REQUEST_HOLDERS } from '@eayni/shared';
import { patch, post } from '@/lib/api';
import { localInputToIso } from '@/lib/dates';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
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
  Textarea,
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
import { sar } from '../../hr/_data';
import { useSalesTeam } from '../_data';
import {
  SERVICE_FIELDS,
  SINGLE_FILE_KEYS,
  TRANSITION_FIELDS,
  TRANSITION_FILES,
  holderTone,
  stateTone,
  useRequest,
  type ActionDef,
  type RequestDetail,
} from './_data';

type Panel = 'inspection' | 'assessment' | 'task' | null;

/**
 * One request [SAL §5, §6, §19]: the service data, the department panels on the same record, the actions open to the
 * viewer (per department and state), the stage log with delay reasons, rental inspections, scrap assessments and tasks.
 */
export function RequestDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const qc = useQueryClient();
  const q = useRequest(id);
  const [action, setAction] = useState<ActionDef | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [delayRow, setDelayRow] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sales'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <Spinner />;
  const r = q.data;
  const fileName = (fid: string) => r.files.find((f) => f._id === fid)?.originalName ?? t('files.attachment');
  const files = (ids: string[] | undefined) =>
    ids?.length ? (
      <div className="flex flex-wrap gap-2">
        {ids.map((fid) => (
          <button
            key={fid}
            type="button"
            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
            onClick={() => downloadAttachment(fid)}
          >
            <Paperclip className="size-3" /> {fileName(fid)}
          </button>
        ))}
      </div>
    ) : (
      <span className="text-slate-400">—</span>
    );
  const detailValue = (key: string, v: unknown) => {
    const f = SERVICE_FIELDS[r.type].find((x) => x.key === key);
    if (v === undefined || v === null || v === '') return '—';
    if (Array.isArray(v)) return v.join(t('common.listSeparator'));
    if (f?.kind === 'money') return sar(v as number);
    if (f?.kind === 'kg')
      return `${(v as number).toLocaleString('ar-SA-u-nu-latn')} ${t('sales.requests.kg')}`;
    if (f?.kind === 'date') return formatDate(v as string);
    if (f?.kind === 'datetime') return formatDateTime(v as string);
    if (f?.kind === 'select') return t(`sales.${f.optionLabelKey}.${v}`);
    return String(v);
  };
  const isOps = r.relations.some((x) => x.startsWith('ops_'));
  const isSales = r.relations.includes('owner') || r.relations.includes('sales_manager');
  return (
    <>
      <PageHeader
        title={`${r.number} — ${t(`sales.services.${r.type}`)}`}
        subtitle={r.title}
        actions={
          <>
            <Badge tone={holderTone[r.holder]}>{t(`sales.requests.holders.${r.holder}`)}</Badge>
            <Badge tone={stateTone(r.state, r.states[r.state]?.category)}>{r.stateAr}</Badge>
            {r.overdue && <Badge tone="red">{t('sales.requests.overdue')}</Badge>}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Info
          label={t('sales.customers.nameAr')}
          value={
            <Link to={`/sales/customers/${r.customerId}`} className="text-brand-700 hover:underline">
              {r.customerName}
            </Link>
          }
        />
        <Info label={t('sales.customers.owner')} value={r.ownerName} />
        <Info
          label={t('sales.requests.dueAt')}
          value={r.dueAt ? formatDateTime(r.dueAt) : '—'}
          tone={r.overdue ? 'red' : undefined}
        />
        <Info
          label={t('sales.requests.lastActivity')}
          value={r.lastActivityAt ? formatDateTime(r.lastActivityAt) : '—'}
        />
      </div>

      {!!r.actions.length && (
        <Card title={t('sales.requests.actions')}>
          <div className="flex flex-wrap gap-2">
            {r.actions.map((a) => (
              <Button
                key={a.code}
                variant={
                  a.code.startsWith('close') ||
                  a.code === 'cancel' ||
                  a.code.endsWith('_reject') ||
                  a.code === 'decline'
                    ? 'secondary'
                    : 'primary'
                }
                onClick={() => setAction(a)}
              >
                {a.labelAr}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title={t('sales.requests.serviceData')}>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {SERVICE_FIELDS[r.type].map((f) => (
              <Row
                key={f.key}
                k={t(`sales.requestFields.${f.key}`)}
                v={detailValue(f.key, r.details[f.key])}
              />
            ))}
            {r.type === 'containerRental' && (
              <Row
                k={t('sales.requestFields.containerNumbers')}
                v={((r.details.containerNumbers as string[]) ?? []).join(t('common.listSeparator')) || '—'}
              />
            )}
            {r.tags.length > 0 && <Row k={t('sales.tags.title')} v={r.tags.join(' ')} />}
            <Row k={t('sales.requests.attachments')} v={files(r.attachmentIds)} />
            <Row k={t('sales.requests.photos')} v={files(r.photoIds)} />
          </dl>
          {r.closingOutcome && (
            <Alert kind="info">
              {r.stateAr}
              {r.closingNote ? ` — ${r.closingNote}` : ''}
            </Alert>
          )}
        </Card>
        <div className="space-y-3">
          {(r.holdersInvolved.includes('procurement') || r.procurement?.supplierName) && (
            <Card title={t('sales.requests.panels.procurement')}>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Row k={t('sales.requests.procurement.supplier')} v={r.procurement?.supplierName ?? '—'} />
                <Row
                  k={t('sales.requests.procurement.deliveryDate')}
                  v={r.procurement?.deliveryDate ? formatDate(r.procurement.deliveryDate) : '—'}
                />
                <Row
                  k={t('sales.requests.procurement.supplierQuotes')}
                  v={files(r.procurement?.supplierQuoteAttachmentIds)}
                />
                <Row
                  k={t('sales.requests.procurement.receiptForm')}
                  v={files(
                    r.procurement?.receiptFormAttachmentId ? [r.procurement.receiptFormAttachmentId] : [],
                  )}
                />
                <Row k={t('sales.requests.notes')} v={r.procurement?.notes ?? '—'} />
              </dl>
            </Card>
          )}
          {(r.holdersInvolved.includes('finance') || r.finance?.decision) && (
            <Card title={t('sales.requests.panels.finance')}>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Row
                  k={t('sales.requests.finance.decision')}
                  v={r.finance?.decision ? t(`sales.requests.finance.decisions.${r.finance.decision}`) : '—'}
                />
                <Row
                  k={t('common.date')}
                  v={r.finance?.decidedAt ? formatDateTime(r.finance.decidedAt) : '—'}
                />
                {r.finance?.rejectionReason && (
                  <Row k={t('sales.requests.finance.rejectionReason')} v={r.finance.rejectionReason} />
                )}
                {r.finance?.infoRequest && (
                  <Row k={t('sales.requests.finance.infoRequest')} v={r.finance.infoRequest} />
                )}
                <Row
                  k={t('sales.requests.finance.purchaseDocuments')}
                  v={files(r.finance?.purchaseDocumentAttachmentIds)}
                />
                <Row k={t('sales.requests.notes')} v={r.finance?.notes ?? '—'} />
              </dl>
            </Card>
          )}
          {(r.holdersInvolved.includes('ops') || r.type === 'scrap') && (
            <Card title={t('sales.requests.panels.ops')}>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Row
                  k={t('sales.requests.ops.scheduledVisitAt')}
                  v={r.operations?.scheduledVisitAt ? formatDateTime(r.operations.scheduledVisitAt) : '—'}
                />
                <Row
                  k={t('sales.requests.ops.estimatedWeightKg')}
                  v={
                    r.operations?.estimatedWeightKg != null
                      ? `${r.operations.estimatedWeightKg} ${t('sales.requests.kg')}`
                      : '—'
                  }
                />
                <Row
                  k={t('sales.requests.ops.estimatedQuantity')}
                  v={r.operations?.estimatedQuantity ?? '—'}
                />
                <Row
                  k={t('sales.requests.ops.quantitiesKg')}
                  v={
                    r.operations?.quantitiesKg != null
                      ? `${r.operations.quantitiesKg} ${t('sales.requests.kg')}`
                      : '—'
                  }
                />
                <Row
                  k={t('sales.requests.ops.weightsKg')}
                  v={
                    r.operations?.weightsKg != null
                      ? `${r.operations.weightsKg} ${t('sales.requests.kg')}`
                      : '—'
                  }
                />
                <Row
                  k={t('sales.requests.ops.receiptReports')}
                  v={files(r.operations?.receiptReportAttachmentIds)}
                />
                <Row
                  k={t('sales.requests.ops.deliveryReports')}
                  v={files(r.operations?.deliveryReportAttachmentIds)}
                />
                <Row k={t('sales.requests.notes')} v={r.operations?.notes ?? '—'} />
              </dl>
              {r.type === 'containerRental' && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">{t('sales.requests.inspections.title')}</span>
                    {(isOps || isSales) && (
                      <Button variant="secondary" onClick={() => setPanel('inspection')}>
                        {t('sales.requests.inspections.add')}
                      </Button>
                    )}
                  </div>
                  {!r.inspections.length ? (
                    <EmptyState title={t('sales.requests.inspections.empty')} />
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {r.inspections.map((i) => (
                        <li key={i._id} className="rounded-lg border border-slate-200 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge tone="brand">{t(`sales.requests.inspections.phases.${i.phase}`)}</Badge>
                            <span className="text-xs text-slate-500 tabular">
                              {i.byName} · {formatDateTime(i.at)}
                            </span>
                          </div>
                          <div className="mt-1">
                            {i.containerNumber && (
                              <span className="text-xs text-slate-500 tabular">{i.containerNumber} · </span>
                            )}
                            {i.containerCondition}
                            {i.notes && <span className="text-slate-500"> — {i.notes}</span>}
                          </div>
                          <div className="mt-1">
                            {files([
                              ...i.photoIds,
                              ...(i.signatureAttachmentId ? [i.signatureAttachmentId] : []),
                              ...(i.receiptProofAttachmentId ? [i.receiptProofAttachmentId] : []),
                            ])}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          )}
          {r.type === 'scrap' && (
            <Card title={t('sales.requests.panels.scrap')}>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Row k={t('sales.requests.scrap.proposedPrice')} v={sar(r.scrap?.proposedPriceHalalas)} />
                <Row k={t('sales.requests.scrap.agreedPrice')} v={sar(r.scrap?.agreedPriceHalalas)} />
                <Row
                  k={t('sales.requests.scrap.actualWeightKg')}
                  v={
                    r.scrap?.actualWeightKg != null
                      ? `${r.scrap.actualWeightKg} ${t('sales.requests.kg')}`
                      : '—'
                  }
                />
                <Row
                  k={t('sales.requests.scrap.receiptReports')}
                  v={files(r.scrap?.receiptReportAttachmentIds)}
                />
                <Row
                  k={t('sales.requests.scrap.transferStatus')}
                  v={
                    <Badge tone={r.scrap?.transferStatus === 'transferred' ? 'green' : 'amber'}>
                      {t(`sales.scrapTransfer.${r.scrap?.transferStatus ?? 'not_transferred'}`)}
                    </Badge>
                  }
                />
                <Row
                  k={t('sales.requests.scrap.transferProof')}
                  v={files(r.scrap?.transferProofAttachmentId ? [r.scrap.transferProofAttachmentId] : [])}
                />
              </dl>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{t('sales.requests.assessments.title')}</span>
                  {(isOps || isSales) && (
                    <Button variant="secondary" onClick={() => setPanel('assessment')}>
                      {t('sales.requests.assessments.add')}
                    </Button>
                  )}
                </div>
                {!r.assessments.length ? (
                  <EmptyState title={t('sales.requests.assessments.empty')} />
                ) : (
                  <ul className="space-y-2 text-sm">
                    {r.assessments.map((a) => (
                      <li key={a._id} className="rounded-lg border border-slate-200 p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{a.visitAt ? formatDateTime(a.visitAt) : ''}</span>
                          <span className="tabular">
                            {a.byName} · {formatDateTime(a.at)}
                          </span>
                        </div>
                        <div className="mt-1">{a.result}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          {a.estimatedWeightKg != null &&
                            `${t('sales.requests.ops.estimatedWeightKg')}: ${a.estimatedWeightKg} ${t('sales.requests.kg')} · `}
                          {a.categories.length > 0 && `${a.categories.join(t('common.listSeparator'))} · `}
                          {a.proposedPriceHalalas != null &&
                            `${t('sales.requests.scrap.proposedPrice')}: ${sar(a.proposedPriceHalalas)} · `}
                          {a.nextAction && `${t('sales.requests.assessments.nextAction')}: ${a.nextAction}`}
                        </div>
                        <div className="mt-1">{files(a.photoIds)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{t('sales.requests.tasks.title')}</span>
                  {(isOps || isSales) && (
                    <Button variant="secondary" onClick={() => setPanel('task')}>
                      {t('sales.requests.tasks.add')}
                    </Button>
                  )}
                </div>
                {!r.scrapTasks.length ? (
                  <EmptyState title={t('sales.requests.tasks.empty')} />
                ) : (
                  <ul className="space-y-2 text-sm">
                    {r.scrapTasks.map((x) => (
                      <ScrapTaskRow key={x._id} task={x} requestId={id} onDone={refresh} />
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card title={t('sales.requests.stageLog')} className="mt-3">
        <ol className="space-y-1 text-sm">
          {r.stageLog.map((s) => (
            <li
              key={s._id}
              className={cx(
                'flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2',
                s.overdue ? 'border-red-200 bg-red-50' : 'border-slate-200',
              )}
            >
              <span>
                {s.fromState ? (r.states[s.fromState]?.labelAr ?? s.fromState) : '—'} →{' '}
                <strong>{r.states[s.toState]?.labelAr ?? s.toState}</strong>
                {s.reason && <span className="text-slate-500"> ({s.reason})</span>}
                {s.overdue && (
                  <span className="ms-2 text-xs text-red-700">
                    {t('sales.requests.stageOverdue')}
                    {s.delayReason
                      ? `: ${s.delayReason}${s.responsibleDepartment ? ` — ${t(`sales.requests.holders.${s.responsibleDepartment}`)}` : ''}`
                      : ''}
                    <button type="button" className="ms-2 underline" onClick={() => setDelayRow(s._id)}>
                      {s.delayReason
                        ? t('sales.requests.updateDelayReason')
                        : t('sales.requests.addDelayReason')}
                    </button>
                    {(s.delayReasons?.length ?? 0) > 1 && (
                      <details className="mt-1 text-slate-600">
                        <summary className="cursor-pointer">
                          {t('sales.requests.delayReasonHistory', { count: s.delayReasons!.length })}
                        </summary>
                        <ul className="list-disc ps-4">
                          {s.delayReasons!.map((d) => (
                            <li key={d._id}>
                              {d.reason} — {t(`sales.requests.holders.${d.responsibleDepartment ?? 'sales'}`)}{' '}
                              · {d.byEmail} · {formatDateTime(d.at)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500 tabular">
                {s.actorEmail} · {formatDateTime(s.at)}
                {s.durationMs != null &&
                  ` · ${Math.round(s.durationMs / 3_600_000)} ${t('sales.requests.hours')}`}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <ActionDialog action={action} request={r} onClose={() => setAction(null)} onDone={refresh} />
      <InspectionDialog
        open={panel === 'inspection'}
        requestId={id}
        onClose={() => setPanel(null)}
        onDone={refresh}
      />
      <AssessmentDialog
        open={panel === 'assessment'}
        requestId={id}
        onClose={() => setPanel(null)}
        onDone={refresh}
      />
      <ScrapTaskDialog
        open={panel === 'task'}
        requestId={id}
        onClose={() => setPanel(null)}
        onDone={refresh}
      />
      <DelayReasonDialog rowId={delayRow} requestId={id} onClose={() => setDelayRow(null)} onDone={refresh} />
    </>
  );
}

function Info({ label, value, tone }: { label: string; value?: ReactNode; tone?: 'red' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cx('mt-0.5 font-medium', tone === 'red' && 'text-red-700')}>{value || '—'}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-500">{k}:</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
}

/** A transition with its payload fields and attachments [SAL §6.1]; reasons are required where the workflow says so. */
function ActionDialog({
  action,
  request,
  onClose,
  onDone,
}: {
  action: ActionDef | null;
  request: RequestDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [filesByKey, setFiles] = useState<Record<string, { attachmentId: string; fileName: string }[]>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const f of TRANSITION_FIELDS[action!.code] ?? []) {
        const v = values[f.key];
        if (!v) continue;
        if (f.kind === 'number' || f.kind === 'kg') payload[f.key] = Number(v);
        else if (f.kind === 'money') payload[f.key] = Math.round(Number(v) * 100);
        else if (f.kind === 'date') payload[f.key] = new Date(`${v}T09:00:00+03:00`).toISOString();
        else if (f.kind === 'datetime') payload[f.key] = localInputToIso(v);
        else payload[f.key] = v;
      }
      for (const f of TRANSITION_FILES[action!.code] ?? []) {
        const ids = (filesByKey[f.key] ?? []).map((x) => x.attachmentId);
        if (!ids.length) continue;
        payload[f.key] = SINGLE_FILE_KEYS.has(f.key) ? ids[0] : ids;
      }
      return post(`/sales/requests/${request._id}/transition`, {
        transition: action!.code,
        reason: reason || undefined,
        payload,
        attachmentIds: [],
      });
    },
    onSuccess: () => {
      toast(t('sales.requests.actionDone'));
      setValues({});
      setFiles({});
      setReason('');
      setError(undefined);
      onDone();
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrorsFrom(e));
      setError(errorMessage(e));
    },
  });
  if (!action) return null;
  const fields = TRANSITION_FIELDS[action.code] ?? [];
  const fileSlots = TRANSITION_FILES[action.code] ?? [];
  return (
    <Dialog open onClose={onClose} title={action.labelAr}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm text-slate-600">
          {t('sales.requests.willMoveTo')}{' '}
          <Badge tone={stateTone(action.to, request.states[action.to]?.category)}>
            {request.states[action.to]?.labelAr ?? action.to}
          </Badge>
        </p>
        {fields.map((f) => (
          <Field
            key={f.key}
            label={t(`sales.requestFields.${f.key}`)}
            required={f.required}
            error={errors[f.key]}
          >
            {f.kind === 'textarea' ? (
              <Textarea
                rows={2}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            ) : (
              <Input
                type={
                  f.kind === 'datetime'
                    ? 'datetime-local'
                    : f.kind === 'date'
                      ? 'date'
                      : f.kind === 'text'
                        ? 'text'
                        : 'number'
                }
                dir={f.kind === 'text' ? undefined : 'ltr'}
                step={f.kind === 'money' ? '0.01' : undefined}
                min={0}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </Field>
        ))}
        {fileSlots.map((f) => (
          <div key={f.key} className="space-y-1">
            <div className="text-sm font-medium text-slate-700">
              {t(`sales.requestFields.${f.key}`)}
              {f.required && <span className="text-red-500 ms-1">*</span>}
            </div>
            <FileUploader
              ownerType="sales_request"
              ownerId={request._id}
              onUploaded={(r) =>
                setFiles((s) => ({
                  ...s,
                  [f.key]: SINGLE_FILE_KEYS.has(f.key) ? [r] : [...(s[f.key] ?? []), r],
                }))
              }
            />
            {(filesByKey[f.key] ?? []).map((x) => (
              <div key={x.attachmentId} className="text-xs text-slate-600">
                {x.fileName}
              </div>
            ))}
          </div>
        ))}
        <Field
          label={action.requireReason ? t('sales.requests.reason') : t('sales.requests.note')}
          required={action.requireReason}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="submit"
            loading={m.isPending}
            disabled={action.requireReason && reason.trim().length < 2}
          >
            {t('actions.confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Rental inspection form [SAL §5.5]: phase, photos, container number, condition, signature / proof, notes. */
function InspectionDialog({
  open,
  requestId,
  onClose,
  onDone,
}: {
  open: boolean;
  requestId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [phase, setPhase] = useState<string>('before_delivery');
  const [containerNumber, setContainerNumber] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [signature, setSignature] = useState<{ attachmentId: string; fileName: string } | null>(null);
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post(`/sales/requests/${requestId}/inspections`, {
        phase,
        containerNumber: containerNumber || undefined,
        photoIds: photos.map((p) => p.attachmentId),
        signatureAttachmentId: signature?.attachmentId,
        containerCondition: condition,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast(t('actions.save'));
      setPhotos([]);
      setSignature(null);
      setCondition('');
      setNotes('');
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.requests.inspections.add')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('sales.requests.inspections.phase')} required>
          <Select value={phase} onChange={(e) => setPhase(e.target.value)}>
            {RENTAL_INSPECTION_PHASES.map((p) => (
              <option key={p} value={p}>
                {t(`sales.requests.inspections.phases.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('sales.requestFields.containerNumber')}
          hint={t('sales.requests.inspections.containerHint')}
        >
          <Input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('sales.requests.inspections.photos')} required>
          <FileUploader
            ownerType="sales_request"
            ownerId={requestId}
            onUploaded={(r) => setPhotos((p) => [...p, r])}
            label={t('sales.requests.photos')}
          />
          {photos.map((p) => (
            <div key={p.attachmentId} className="text-xs text-slate-600">
              {p.fileName}
            </div>
          ))}
        </Field>
        <Field label={t('sales.requests.inspections.condition')} required>
          <Textarea rows={2} value={condition} onChange={(e) => setCondition(e.target.value)} required />
        </Field>
        <Field label={t('sales.requests.inspections.signature')}>
          <FileUploader
            ownerType="sales_request"
            ownerId={requestId}
            onUploaded={setSignature}
            label={t('sales.requests.inspections.signatureUpload')}
          />
          {signature && <div className="text-xs text-slate-600">{signature.fileName}</div>}
        </Field>
        <Field label={t('sales.requests.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!photos.length || !condition.trim()}>
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Scrap assessment visit result [SAL §5.6 ثالثاً]. */
function AssessmentDialog({
  open,
  requestId,
  onClose,
  onDone,
}: {
  open: boolean;
  requestId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({
    visitAt: '',
    result: '',
    quantitiesKg: '',
    estimatedWeightKg: '',
    categories: '',
    proposedPriceHalalas: '',
    agreedPriceHalalas: '',
    nextAction: '',
  });
  const [photos, setPhotos] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post(`/sales/requests/${requestId}/assessments`, {
        visitAt: localInputToIso(v.visitAt),
        result: v.result,
        photoIds: photos.map((p) => p.attachmentId),
        quantitiesKg: v.quantitiesKg ? Number(v.quantitiesKg) : undefined,
        estimatedWeightKg: v.estimatedWeightKg ? Number(v.estimatedWeightKg) : undefined,
        categories: v.categories
          .split(new RegExp('[\\u060C,]'))
          .map((x) => x.trim())
          .filter(Boolean),
        proposedPriceHalalas: v.proposedPriceHalalas
          ? Math.round(Number(v.proposedPriceHalalas) * 100)
          : undefined,
        agreedPriceHalalas: v.agreedPriceHalalas ? Math.round(Number(v.agreedPriceHalalas) * 100) : undefined,
        nextAction: v.nextAction || undefined,
      }),
    onSuccess: () => {
      toast(t('actions.save'));
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const f = (k: keyof typeof v, label: string, type = 'text', hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        type={type}
        dir={type === 'text' ? undefined : 'ltr'}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
        step={type === 'number' ? '0.01' : undefined}
      />
    </Field>
  );
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.requests.assessments.add')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        {f('visitAt', t('sales.requests.assessments.visitAt'), 'datetime-local')}
        <Field label={t('sales.requests.assessments.result')} required>
          <Textarea
            rows={2}
            value={v.result}
            onChange={(e) => setV({ ...v, result: e.target.value })}
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {f('estimatedWeightKg', t('sales.requests.ops.estimatedWeightKg'), 'number')}
          {f('quantitiesKg', t('sales.requests.ops.quantitiesKg'), 'number')}
          {f('proposedPriceHalalas', t('sales.requests.scrap.proposedPrice'), 'number')}
          {f('agreedPriceHalalas', t('sales.requests.scrap.agreedPrice'), 'number')}
        </div>
        {f(
          'categories',
          t('sales.requests.assessments.categories'),
          'text',
          t('sales.requests.commaSeparated'),
        )}
        {f('nextAction', t('sales.requests.assessments.nextAction'))}
        <FileUploader
          ownerType="sales_request"
          ownerId={requestId}
          onUploaded={(r) => setPhotos((p) => [...p, r])}
          label={t('sales.requests.photos')}
        />
        {photos.map((p) => (
          <div key={p.attachmentId} className="text-xs text-slate-600">
            {p.fileName}
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!v.result.trim()}>
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** «رفع مهمة» [SAL §5.6 ثانياً]. */
function ScrapTaskDialog({
  open,
  requestId,
  onClose,
  onDone,
}: {
  open: boolean;
  requestId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const team = useSalesTeam(open);
  const [v, setV] = useState({
    assigneeUserId: '',
    taskType: '',
    customersToContact: '',
    assignedAt: '',
    visitAt: '',
    agreedPriceHalalas: '',
    notes: '',
  });
  const [people, setPeople] = useState<{ userId: string; fullNameAr: string }[]>([]);
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post(`/sales/requests/${requestId}/tasks`, {
        assigneeUserId: v.assigneeUserId,
        taskType: v.taskType,
        customersToContact: v.customersToContact ? Number(v.customersToContact) : undefined,
        assignedAt: localInputToIso(v.assignedAt),
        visitAt: localInputToIso(v.visitAt),
        agreedPriceHalalas: v.agreedPriceHalalas ? Math.round(Number(v.agreedPriceHalalas) * 100) : undefined,
        notes: v.notes || undefined,
        attachmentIds: [],
      }),
    onSuccess: () => {
      toast(t('actions.save'));
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.requests.tasks.add')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Field
          label={t('sales.requests.tasks.assignee')}
          required
          hint={t('sales.requests.tasks.assigneeHint')}
        >
          <PeoplePicker
            value={v.assigneeUserId}
            onChange={(id) => setV({ ...v, assigneeUserId: id })}
            people={[...(team.data?.items ?? []), ...people]}
            onSearch={setPeople}
          />
        </Field>
        <Field label={t('sales.requests.tasks.taskType')} required>
          <Input value={v.taskType} onChange={(e) => setV({ ...v, taskType: e.target.value })} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.requests.tasks.customersToContact')}>
            <Input
              type="number"
              min={0}
              dir="ltr"
              value={v.customersToContact}
              onChange={(e) => setV({ ...v, customersToContact: e.target.value })}
            />
          </Field>
          <Field label={t('sales.requests.scrap.agreedPrice')}>
            <Input
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              value={v.agreedPriceHalalas}
              onChange={(e) => setV({ ...v, agreedPriceHalalas: e.target.value })}
            />
          </Field>
          <Field label={t('sales.requests.tasks.assignedAt')}>
            <Input
              type="datetime-local"
              dir="ltr"
              value={v.assignedAt}
              onChange={(e) => setV({ ...v, assignedAt: e.target.value })}
            />
          </Field>
          <Field label={t('sales.requests.tasks.visitAt')}>
            <Input
              type="datetime-local"
              dir="ltr"
              value={v.visitAt}
              onChange={(e) => setV({ ...v, visitAt: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('sales.requests.notes')}>
          <Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!v.assigneeUserId || !v.taskType.trim()}>
            {t('sales.requests.tasks.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** People picker over the calendar people search (any on-duty employee), seeded with the Sales team. */
function PeoplePicker({
  value,
  onChange,
  people,
  onSearch,
}: {
  value: string;
  onChange: (id: string) => void;
  people: { userId: string; fullNameAr: string }[];
  onSearch: (p: { userId: string; fullNameAr: string }[]) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const search = useMutation({
    mutationFn: (term: string) =>
      import('@/lib/api').then(({ get }) =>
        get<{ items: { userId: string; fullNameAr: string }[] }>(
          `/calendar/people?q=${encodeURIComponent(term)}`,
        ),
      ),
    onSuccess: (r) => onSearch(r.items),
  });
  const unique = Array.from(new Map(people.map((p) => [p.userId, p])).values());
  return (
    <div className="space-y-1">
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (e.target.value.length >= 2) search.mutate(e.target.value);
        }}
        placeholder={t('actions.search')}
        aria-label={t('actions.search')}
      />
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('sales.requests.tasks.assignee')}
      >
        <option value="">—</option>
        {unique.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.fullNameAr}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ScrapTaskRow({
  task,
  requestId,
  onDone,
}: {
  task: RequestDetail['scrapTasks'][number];
  requestId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { formatDateTime } = usePrefs();
  const [proof, setProof] = useState<{ attachmentId: string; fileName: string } | null>(null);
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      patch(`/sales/requests/${requestId}/tasks/${task._id}`, body),
    onSuccess: () => {
      toast(t('actions.save'));
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <li className="rounded-lg border border-slate-200 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="text-xs text-slate-500 tabular">{task.task?.number}</span>{' '}
          <strong>{task.taskType}</strong> — {task.assigneeName}
        </span>
        <span className="flex gap-1">
          <Badge tone={task.taskStatus === 'done' ? 'green' : 'slate'}>
            {t('sales.requests.tasks.taskStatus')}: {t(`sales.scrapTaskStatus.${task.taskStatus}`)}
          </Badge>
          <Badge tone={task.transferStatus === 'transferred' ? 'green' : 'amber'}>
            {t('sales.requests.scrap.transferStatus')}: {t(`sales.scrapTransfer.${task.transferStatus}`)}
          </Badge>
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-600">
        {task.customersToContact != null &&
          `${t('sales.requests.tasks.customersToContact')}: ${task.customersToContact} · `}
        {task.visitAt && `${t('sales.requests.tasks.visitAt')}: ${formatDateTime(task.visitAt)} · `}
        {task.agreedPriceHalalas != null &&
          `${t('sales.requests.scrap.agreedPrice')}: ${sar(task.agreedPriceHalalas)}`}
        {task.notes && ` · ${task.notes}`}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {task.taskStatus !== 'done' ? (
          <Button variant="secondary" onClick={() => m.mutate({ taskStatus: 'done' })}>
            {t('sales.requests.tasks.markDone')}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => m.mutate({ taskStatus: 'not_done' })}>
            {t('sales.requests.tasks.markNotDone')}
          </Button>
        )}
        {task.transferStatus !== 'transferred' && (
          <>
            <FileUploader
              ownerType="sales_request"
              ownerId={requestId}
              onUploaded={setProof}
              label={t('sales.requests.scrap.transferProof')}
            />
            <Button
              variant="secondary"
              disabled={!proof}
              onClick={() =>
                m.mutate({ transferStatus: 'transferred', transferProofAttachmentId: proof?.attachmentId })
              }
            >
              {t('sales.requests.tasks.markTransferred')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Delay reason with the responsible department on an overdue stage [SAL §19]. */
function DelayReasonDialog({
  rowId,
  requestId,
  onClose,
  onDone,
}: {
  rowId: string | null;
  requestId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [dept, setDept] = useState<string>('sales');
  const m = useMutation({
    mutationFn: () =>
      post(`/sales/requests/${requestId}/stage-log/${rowId}/delay-reason`, {
        delayReason: reason,
        responsibleDepartment: dept,
      }),
    onSuccess: () => {
      toast(t('actions.save'));
      setReason('');
      onDone();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!rowId) return null;
  return (
    <Dialog open onClose={onClose} title={t('sales.requests.addDelayReason')}>
      <div className="space-y-3">
        <Field label={t('sales.requests.delayReason')} required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('sales.requests.responsibleDepartment')} required>
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            {REQUEST_HOLDERS.map((h) => (
              <option key={h} value={h}>
                {t(`sales.requests.holders.${h}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={reason.trim().length < 2}>
            {t('actions.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
