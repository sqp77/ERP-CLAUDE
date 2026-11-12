import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
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
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
import { openSignedUrl } from '@/lib/download';
import { sar } from '../../hr/_data';
import { quoteTone, useQuote } from './_data';

type Mode = 'send' | 'respond' | 'approve' | 'cancel' | null;

/** One quote [SAL §3 م2–م3, §7.2, §7.3]: lines (internal fields for Sales management and the owner), approval, send, customer reply, versions, order. */
export function QuotePage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuote(id);
  const [mode, setMode] = useState<Mode>(null);
  const [v, setV] = useState({
    to: '',
    cc: '',
    subject: '',
    body: '',
    response: 'accepted',
    reason: '',
    note: '',
    signed: '' as string,
    mailto: '',
  });
  const [error, setError] = useState<string>();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sales'] });
    qc.invalidateQueries({ queryKey: ['finance'] });
  };
  const act = useMutation({
    mutationFn: (p: { path: string; body?: Record<string, unknown> }) =>
      post<Record<string, unknown>>(`/sales/quotes/${id}/${p.path}`, p.body),
    onSuccess: (r) => {
      refresh();
      setError(undefined);
      if (typeof r.mailto === 'string' && r.emailState === 'draft_unsent') {
        setV((s) => ({ ...s, mailto: r.mailto as string }));
        toast(t('sales.quotes.draftSaved'));
      } else {
        setMode(null);
        toast(t('actions.save'));
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revise = useMutation({
    mutationFn: () => post<{ _id: string }>(`/sales/quotes/${id}/revise`),
    onSuccess: (r) => {
      refresh();
      nav(`/sales/quotes/${r._id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  const internal = d.maxDiscountBp !== undefined;
  return (
    <>
      <PageHeader
        title={`${d.number}${d.version > 1 ? ` (v${d.version})` : ''}`}
        subtitle={d.customerName}
        actions={
          <>
            <Badge tone={quoteTone[d.state]}>{d.stateAr}</Badge>
            {d.approval?.limitsUnset && ['draft', 'pending_approval'].includes(d.state) && (
              <Badge tone="amber">{t('sales.quotes.limitsUnset')}</Badge>
            )}
          </>
        }
      />
      {d.approval?.approvedByName && (
        <Alert kind="success">
          {t('sales.quotes.approvedBy', {
            name: d.approval.approvedByName,
            at: formatDateTime(d.approval.approvedAt!),
          })}
          {d.approval.note ? ` — ${d.approval.note}` : ''}
        </Alert>
      )}
      {d.customerResponse?.state && (
        <Alert
          kind={
            d.customerResponse.state === 'accepted'
              ? 'success'
              : d.customerResponse.state === 'rejected'
                ? 'error'
                : 'info'
          }
        >
          {t('sales.quotes.customerSaid', {
            state: t(`sales.quoteStates.${d.customerResponse.state}`),
            at: formatDateTime(d.customerResponse.at),
          })}
          {d.customerResponse.reason ? ` — ${d.customerResponse.reason}` : ''}
          {d.customerResponse.note ? ` — ${d.customerResponse.note}` : ''}
        </Alert>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {d.canSubmit && (
          <Button onClick={() => act.mutate({ path: 'submit' })} loading={act.isPending}>
            {t('sales.quotes.submit')}
          </Button>
        )}
        {d.canApprove && <Button onClick={() => setMode('approve')}>{t('sales.quotes.approve')}</Button>}
        {d.canSend && <Button onClick={() => setMode('send')}>{t('sales.quotes.send')}</Button>}
        {d.canRespond && (
          <Button onClick={() => setMode('respond')}>{t('sales.quotes.recordResponse')}</Button>
        )}
        {d.canRevise && (
          <Button variant="secondary" onClick={() => revise.mutate()} loading={revise.isPending}>
            {t('sales.quotes.revise')}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => openSignedUrl(() => Promise.resolve(`/api/v1/sales/quotes/${id}/document`))}
        >
          {t('sales.quotes.customerDocument')}
        </Button>
        {!['accepted', 'cancelled'].includes(d.state) && (d.canEdit || d.canSend || d.canRespond) && (
          <Button variant="secondary" onClick={() => setMode('cancel')}>
            {t('sales.quotes.cancel')}
          </Button>
        )}
      </div>
      <Card title={t('sales.quotes.lines')} className="mt-3">
        <Table
          head={[
            t('sales.pricelist.item'),
            t('sales.pricelist.unit'),
            t('sales.quotes.quantity'),
            ...(internal ? [t('sales.pricelist.price'), t('sales.quotes.discount')] : []),
            t('sales.quotes.netUnitPrice'),
            t('sales.quotes.lineTotal'),
            t('sales.quotes.vat'),
          ]}
        >
          {d.lines.map((l, i) => (
            <tr key={i}>
              <Td className="font-medium">{l.descriptionAr}</Td>
              <Td>{t(`sales.pricelist.units.${l.unit}`, { defaultValue: l.unit })}</Td>
              <Td className="tabular">{l.quantity}</Td>
              {internal && (
                <Td className="tabular">{l.listPriceHalalas != null ? sar(l.listPriceHalalas) : '—'}</Td>
              )}
              {internal && (
                <Td className="tabular">
                  {l.discountPercentBp ? `${(l.discountPercentBp / 100).toFixed(1)}%` : '—'}
                </Td>
              )}
              <Td className="tabular">{sar(l.netUnitPriceHalalas)}</Td>
              <Td className="tabular">{sar(l.lineTotalHalalas)}</Td>
              <Td className="tabular">{sar(l.vatHalalas)}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Stat k={t('sales.quotes.subtotal')} v={sar(d.subtotalHalalas)} />
          {internal && <Stat k={t('sales.quotes.discountTotal')} v={sar(d.discountTotalHalalas ?? 0)} />}
          <Stat k={t('sales.quotes.vat')} v={sar(d.vatTotalHalalas)} />
          <Stat k={t('sales.quotes.total')} v={sar(d.totalHalalas)} strong />
        </div>
        <p className="mt-2 text-xs text-slate-500">{t('sales.quotes.netOnlyHint')}</p>
      </Card>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title={t('sales.quotes.details')}>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Row k={t('sales.customers.owner')} v={d.ownerName} />
            <Row
              k={t('sales.quotes.validUntil')}
              v={
                d.validUntil
                  ? formatDate(d.validUntil)
                  : t('sales.quotes.validityDays', { days: d.validityDays })
              }
            />
            <Row k={t('sales.quotes.sentAt')} v={d.sentAt ? formatDateTime(d.sentAt) : '—'} />
            {internal && d.approval && (
              <Row
                k={t('sales.quotes.requiredApproval')}
                v={
                  <span>
                    {t(`sales.quotes.levels.${d.approval.requiredLevel}`)}
                    {d.approval.escalatedFrom && (
                      <span className="block text-xs text-amber-700">
                        {t('sales.quotes.escalated', {
                          from: t(`sales.quotes.levels.${d.approval.escalatedFrom}`),
                        })}
                      </span>
                    )}
                    {d.approval.approvedLevel && d.approval.approvedByName && (
                      <span className="block text-xs text-slate-500">
                        {t('sales.quotes.approvedAtLevel', {
                          level: t(`sales.quotes.levels.${d.approval.approvedLevel}`),
                        })}
                      </span>
                    )}
                  </span>
                }
              />
            )}
            {d.notesForCustomer && <Row k={t('sales.quotes.notesForCustomer')} v={d.notesForCustomer} />}
            {internal && d.internalNotes && <Row k={t('sales.quotes.internalNotes')} v={d.internalNotes} />}
            {d.salesOrder && (
              <Row
                k={t('sales.quotes.salesOrder')}
                v={
                  <span>
                    {d.salesOrder.number} · {t(`sales.orderStates.${d.salesOrder.state}`)}
                    {d.salesOrder.invoiceIds.length > 0 && (
                      <>
                        {' · '}
                        <Link
                          to={`/sales/invoices?salesOrderId=${d.salesOrder._id}`}
                          className="text-brand-700 hover:underline"
                        >
                          {t('sales.invoices.title')}
                        </Link>
                      </>
                    )}
                  </span>
                }
              />
            )}
          </dl>
          {!!d.files.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {d.files.map((f) => (
                <button
                  key={f._id}
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                  onClick={() => downloadAttachment(f._id)}
                >
                  <Paperclip className="size-3" /> {f.originalName}
                </button>
              ))}
            </div>
          )}
        </Card>
        {internal && d.events && (
          <Card title={t('sales.quotes.history')}>
            <ol className="space-y-1 text-xs">
              {d.events.map((e) => (
                <li key={e._id} className="flex justify-between gap-2 rounded border border-slate-100 p-1.5">
                  <span>
                    {t(`sales.quotes.events.${e.type}`, { defaultValue: e.type })}
                    {e.note && <span className="text-slate-500"> ({e.note})</span>}
                  </span>
                  <span className="shrink-0 text-slate-500 tabular">
                    {e.byName} · {formatDateTime(e.at)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>

      <Dialog open={mode === 'approve'} onClose={() => setMode(null)} title={t('sales.quotes.approve')}>
        {error && <Alert kind="error">{error}</Alert>}
        {internal && (
          <p className="text-sm text-slate-700">
            {t('sales.quotes.maxDiscount', { pct: ((d.maxDiscountBp ?? 0) / 100).toFixed(1) })}
            {d.approval?.limitsUnset && ` — ${t('sales.quotes.limitsUnset')}`}
          </p>
        )}
        <Field label={t('sales.requests.note')}>
          <Textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => act.mutate({ path: 'reject-approval', body: { note: v.note } })}
            disabled={!v.note.trim()}
          >
            {t('sales.quotes.refuseApproval')}
          </Button>
          <Button
            onClick={() => act.mutate({ path: 'approve', body: { note: v.note || undefined } })}
            loading={act.isPending}
          >
            {t('sales.quotes.approve')}
          </Button>
        </div>
      </Dialog>

      <Dialog open={mode === 'send'} onClose={() => setMode(null)} title={t('sales.quotes.send')}>
        {error && <Alert kind="error">{error}</Alert>}
        {v.mailto ? (
          <div className="space-y-3 text-sm">
            <Alert kind="warning">{t('sales.quotes.mailboxDisabled')}</Alert>
            <a
              href={v.mailto}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-white"
              onClick={() => setTimeout(() => setMode(null), 500)}
            >
              {t('sales.quotes.openMailClient')}
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={t('sales.quotes.to')} required hint={t('sales.quotes.toHint')}>
              <Input value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('sales.quotes.cc')}>
              <Input value={v.cc} onChange={(e) => setV({ ...v, cc: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('sales.quotes.subject')}>
              <Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
            </Field>
            <Field label={t('sales.quotes.body')}>
              <Textarea rows={4} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMode(null)}>
                {t('actions.cancel')}
              </Button>
              <Button
                onClick={() =>
                  act.mutate({
                    path: 'send',
                    body: {
                      to: v.to.split(/[,;\s]+/).filter(Boolean),
                      cc: v.cc.split(/[,;\s]+/).filter(Boolean),
                      subject: v.subject || undefined,
                      body: v.body || undefined,
                      attachmentIds: [],
                    },
                  })
                }
                loading={act.isPending}
                disabled={!v.to.trim()}
              >
                {t('actions.send')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={mode === 'respond'}
        onClose={() => setMode(null)}
        title={t('sales.quotes.recordResponse')}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <div className="space-y-3">
          <Field label={t('sales.quotes.response')}>
            <Select value={v.response} onChange={(e) => setV({ ...v, response: e.target.value })}>
              <option value="accepted">{t('sales.quoteStates.accepted')}</option>
              <option value="rejected">{t('sales.quoteStates.rejected')}</option>
              <option value="negotiating">{t('sales.quoteStates.negotiating')}</option>
            </Select>
          </Field>
          {v.response === 'rejected' && (
            <Field label={t('sales.quotes.rejectionReason')} required>
              <Select value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>
                <option value="">—</option>
                {d.rejectionReasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {v.response === 'accepted' && (
            <Field label={t('sales.quotes.signedFile')} hint={t('sales.quotes.signedFileHint')}>
              <FileUploader
                ownerType="quote"
                ownerId={id}
                onUploaded={(r) => setV({ ...v, signed: r.attachmentId })}
              />
            </Field>
          )}
          <Field label={t('sales.requests.note')}>
            <Textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>
              {t('actions.cancel')}
            </Button>
            <Button
              onClick={() =>
                act.mutate({
                  path: 'respond',
                  body: {
                    response: v.response,
                    reason: v.reason || undefined,
                    note: v.note || undefined,
                    signedFileAttachmentId: v.signed || undefined,
                  },
                })
              }
              loading={act.isPending}
              disabled={v.response === 'rejected' && !v.reason}
            >
              {t('actions.save')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={mode === 'cancel'} onClose={() => setMode(null)} title={t('sales.quotes.cancel')}>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('sales.requests.reason')} required>
          <Textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setMode(null)}>
            {t('actions.cancel')}
          </Button>
          <Button
            onClick={() => act.mutate({ path: 'cancel', body: { reason: v.note } })}
            disabled={v.note.trim().length < 2}
            loading={act.isPending}
          >
            {t('actions.confirm')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
function Stat({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <div className="text-xs text-slate-500">{k}</div>
      <div className={strong ? 'font-bold tabular' : 'tabular'}>{v}</div>
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
