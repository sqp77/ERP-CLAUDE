import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { COLLECTION_STATES, PAYMENT_METHODS } from '@eayni/shared';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localInputToIso } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
import { openSignedUrl } from '@/lib/download';
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
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader } from '@/shared/files/FileUploader';
import { sar } from '../../hr/_data';
import {
  collectionTone,
  useInvoices,
  type InvoicePrefill,
  type InvoiceRow,
  type InvoiceTotals,
} from './_data';

/**
 * الفواتير والتحصيل [SAL §7.3, §18; FIN §7]: Finance registers the invoice issued in the current system against a sales
 * order (Q4 option A) and records payments; Sales sees invoice and collection status read-only [SAL §19].
 */
export function InvoicesPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };
  const finance = can('finance.invoices', 'create');
  const list = useInvoices({
    collectionState: get('collectionState') || undefined,
    overdue: get('overdue') === 'true',
    customerId: get('customerId') || undefined,
    salesOrderId: get('salesOrderId') || undefined,
    contractId: get('contractId') || undefined,
    q: get('q') || undefined,
    limit: 200,
  });
  const [registerOpen, setRegisterOpen] = useState(false);
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['finance'] });
    qc.invalidateQueries({ queryKey: ['sales'] });
  };
  return (
    <>
      <PageHeader
        title={t('sales.invoices.title')}
        subtitle={finance ? t('sales.invoices.financeSubtitle') : t('sales.invoices.readOnly')}
        actions={
          finance ? (
            <Button onClick={() => setRegisterOpen(true)}>{t('sales.invoices.register')}</Button>
          ) : undefined
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input
          value={get('q')}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={t('common.number')}
          aria-label={t('actions.search')}
        />
        <Select
          value={get('collectionState')}
          onChange={(e) => setParam('collectionState', e.target.value)}
          aria-label={t('common.status')}
        >
          <option value="">{t('sales.invoices.allStates')}</option>
          {COLLECTION_STATES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.collectionStates.${s}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('overdue') === 'true'}
            onChange={(e) => setParam('overdue', e.target.checked)}
          />{' '}
          {t('sales.invoices.overdueOnly')}
        </label>
      </div>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState
            title={t('sales.invoices.empty')}
            hint={finance ? undefined : t('sales.invoices.emptyHint')}
          />
        ) : (
          <Table
            head={[
              t('common.number'),
              t('sales.invoices.externalNumber'),
              t('sales.customers.nameAr'),
              t('sales.invoices.source'),
              t('sales.invoices.issueDate'),
              t('sales.invoices.dueDate'),
              t('sales.quotes.total'),
              t('sales.invoices.collected'),
              t('sales.invoices.remaining'),
              t('common.status'),
              t('sales.invoices.zatca'),
              t('common.actions'),
            ]}
          >
            {list.data.items.map((inv) => (
              <tr key={inv._id} className="hover:bg-slate-50">
                <Td className="tabular text-xs text-slate-500">{inv.number}</Td>
                <Td className="tabular">{inv.externalNumber}</Td>
                <Td className="font-medium">{inv.customer?.nameAr}</Td>
                <Td className="text-xs">
                  {t(`sales.invoices.sources.${inv.source}`)}
                  {inv.sourceNumber ? ` ${inv.sourceNumber}` : ''}
                  {inv.periodFrom && inv.periodTo && (
                    <span className="block text-slate-500">
                      {formatDate(inv.periodFrom)} – {formatDate(inv.periodTo)}
                    </span>
                  )}
                  {inv.difference && (
                    <span className="block text-amber-700" title={inv.difference.reason}>
                      {t('sales.invoices.differsFromSource', { reason: inv.difference.reason })}
                    </span>
                  )}
                </Td>
                <Td className="tabular">{formatDate(inv.issueDateTime)}</Td>
                <Td className={cx('tabular', inv.collectionState === 'overdue' && 'text-red-700')}>
                  {formatDate(inv.dueDate)}
                </Td>
                <Td className="tabular">{sar(inv.totalHalalas)}</Td>
                <Td className="tabular">{sar(inv.collectedHalalas)}</Td>
                <Td className="tabular">{sar(inv.remainingHalalas)}</Td>
                <Td>
                  <Badge tone={collectionTone[inv.collectionState]}>{inv.collectionStateAr}</Badge>
                </Td>
                <Td className="text-xs text-slate-500">{inv.zatcaStateAr}</Td>
                <Td>
                  <span className="flex gap-1">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        openSignedUrl(() => Promise.resolve(`/api/v1/finance/invoices/${inv._id}/document`))
                      }
                    >
                      {t('sales.invoices.document')}
                    </Button>
                    {finance && inv.remainingHalalas > 0 && (
                      <Button variant="secondary" onClick={() => setPayFor(inv)}>
                        {t('sales.invoices.recordPayment')}
                      </Button>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <RegisterDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onDone={refresh}
        salesOrderId={get('salesOrderId') || undefined}
        contractId={get('contractId') || undefined}
      />
      <PaymentDialog
        invoice={payFor}
        onClose={() => setPayFor(null)}
        onDone={() => {
          refresh();
          toast(t('actions.save'));
        }}
      />
    </>
  );
}

const halfUp = (n: number) => Math.floor(n + 0.5);
const VAT_BP = 1500;
type LineDraft = {
  descriptionAr: string;
  unit?: string;
  quantity: string;
  unitPriceSar: string;
  itemId?: string;
};
const linesTotals = (lines: LineDraft[]): InvoiceTotals => {
  let subtotalHalalas = 0;
  let vatTotalHalalas = 0;
  for (const l of lines) {
    const lineTotal = Math.round(Number(l.quantity || 0) * Math.round(Number(l.unitPriceSar || 0) * 100));
    subtotalHalalas += lineTotal;
    vatTotalHalalas += halfUp((lineTotal * VAT_BP) / 10_000);
  }
  return { subtotalHalalas, vatTotalHalalas, totalHalalas: subtotalHalalas + vatTotalHalalas };
};

/**
 * Finance registers the invoice issued in the current system (option A) against an order or a contract period: the
 * lines and totals are prefilled from the source, Finance corrects them to the issued invoice's actual figures, and a
 * difference from the prefilled totals needs a reason that Sales will see [SAL §7.3, FIN §7; S3 fix 1].
 */
function RegisterDialog({
  open,
  onClose,
  onDone,
  salesOrderId,
  contractId,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  salesOrderId?: string;
  contractId?: string;
}) {
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const toast = useToast();
  const [source, setSource] = useState<'order' | 'contract'>(contractId ? 'contract' : 'order');
  const [src, setSrc] = useState({
    salesOrderId: salesOrderId ?? '',
    contractId: contractId ?? '',
    periodFrom: '',
    periodTo: '',
  });
  const [v, setV] = useState({ kind: 'tax', externalNumber: '', issueDateTime: '', dueDate: '', notes: '' });
  const [pre, setPre] = useState<InvoicePrefill | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [totals, setTotals] = useState({ subtotal: '', vat: '', total: '' });
  const [reason, setReason] = useState('');
  const [pdf, setPdf] = useState('');
  const [error, setError] = useState<string>();
  const sourceBody = () =>
    source === 'order'
      ? { salesOrderId: src.salesOrderId }
      : { contractId: src.contractId, periodFrom: src.periodFrom, periodTo: src.periodTo };
  const prefill = useMutation({
    mutationFn: () => post<InvoicePrefill>('/finance/invoices/prefill', sourceBody()),
    onSuccess: (p) => {
      setError(undefined);
      setPre(p);
      setLines(
        p.lines.map((l) => ({
          itemId: l.itemId,
          descriptionAr: l.descriptionAr,
          unit: l.unit,
          quantity: String(l.quantity),
          unitPriceSar: (l.unitPriceHalalas / 100).toFixed(2),
        })),
      );
      setTotals({
        subtotal: (p.totals.subtotalHalalas / 100).toFixed(2),
        vat: (p.totals.vatTotalHalalas / 100).toFixed(2),
        total: (p.totals.totalHalalas / 100).toFixed(2),
      });
      setReason('');
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const actual: InvoiceTotals = {
    subtotalHalalas: Math.round(Number(totals.subtotal || 0) * 100),
    vatTotalHalalas: Math.round(Number(totals.vat || 0) * 100),
    totalHalalas: Math.round(Number(totals.total || 0) * 100),
  };
  const differs =
    !!pre &&
    (actual.totalHalalas !== pre.totals.totalHalalas ||
      actual.subtotalHalalas !== pre.totals.subtotalHalalas ||
      actual.vatTotalHalalas !== pre.totals.vatTotalHalalas);
  const linesChanged =
    !!pre &&
    JSON.stringify(
      lines.map((l) => [l.descriptionAr, Number(l.quantity), Math.round(Number(l.unitPriceSar) * 100)]),
    ) !== JSON.stringify(pre.lines.map((l) => [l.descriptionAr, l.quantity, l.unitPriceHalalas]));
  const applyLines = (next: LineDraft[]) => {
    setLines(next);
    const tt = linesTotals(next);
    setTotals({
      subtotal: (tt.subtotalHalalas / 100).toFixed(2),
      vat: (tt.vatTotalHalalas / 100).toFixed(2),
      total: (tt.totalHalalas / 100).toFixed(2),
    });
  };
  const m = useMutation({
    mutationFn: () =>
      post('/finance/invoices', {
        ...sourceBody(),
        kind: v.kind,
        externalNumber: v.externalNumber,
        issueDateTime: localInputToIso(v.issueDateTime),
        dueDate: v.dueDate,
        lines: linesChanged
          ? lines.map((l) => ({
              itemId: l.itemId || undefined,
              descriptionAr: l.descriptionAr,
              unit: l.unit || undefined,
              quantity: Number(l.quantity || 0),
              unitPriceHalalas: Math.round(Number(l.unitPriceSar || 0) * 100),
            }))
          : undefined,
        totals: differs || linesChanged ? actual : undefined,
        differenceReason: differs ? reason : undefined,
        pdfAttachmentId: pdf || undefined,
        notes: v.notes || undefined,
      }),
    onSuccess: () => {
      toast(t('sales.invoices.registered'));
      setError(undefined);
      setPre(null);
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.invoices.register')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pre) return prefill.mutate();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Alert kind="info">{t('sales.invoices.optionAHint')}</Alert>
        <div className="flex gap-2">
          {(['order', 'contract'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              variant={source === k ? 'primary' : 'secondary'}
              onClick={() => {
                setSource(k);
                setPre(null);
              }}
            >
              {t(`sales.invoices.sources.${k}`)}
            </Button>
          ))}
        </div>
        {source === 'order' ? (
          <Field label={t('sales.invoices.salesOrderId')} required hint={t('sales.invoices.salesOrderHint')}>
            <Input
              dir="ltr"
              value={src.salesOrderId}
              onChange={(e) => setSrc({ ...src, salesOrderId: e.target.value })}
              required
            />
          </Field>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t('sales.invoices.contractId')} required hint={t('sales.invoices.contractHint')}>
              <Input
                dir="ltr"
                value={src.contractId}
                onChange={(e) => setSrc({ ...src, contractId: e.target.value })}
                required
              />
            </Field>
            <Field label={t('sales.invoices.periodFrom')} required>
              <Input
                type="date"
                dir="ltr"
                value={src.periodFrom}
                onChange={(e) => setSrc({ ...src, periodFrom: e.target.value })}
                required
              />
            </Field>
            <Field label={t('sales.invoices.periodTo')} required>
              <Input
                type="date"
                dir="ltr"
                value={src.periodTo}
                onChange={(e) => setSrc({ ...src, periodTo: e.target.value })}
                required
              />
            </Field>
          </div>
        )}
        {!pre ? (
          <div className="flex justify-end">
            <Button type="submit" loading={prefill.isPending}>
              {t('sales.invoices.prefill')}
            </Button>
          </div>
        ) : (
          <>
            <Card title={t('sales.invoices.prefilledFrom', { number: pre.sourceNumber })}>
              {pre.remainingHalalas !== null && (
                <p className="text-sm text-slate-600">
                  {t('sales.invoices.orderRemaining', { amount: sar(pre.remainingHalalas) })}
                </p>
              )}
              {pre.source === 'contract' && (
                <p className="text-sm text-slate-600">
                  {t('sales.invoices.entriesCovered', { count: pre.scheduleEntries.length })}
                  {pre.periodFrom && pre.periodTo
                    ? ` · ${formatDate(pre.periodFrom)} – ${formatDate(pre.periodTo)}`
                    : ''}
                </p>
              )}
              {pre.previousInvoices.length > 0 && (
                <p className="text-xs text-slate-500">
                  {t('sales.invoices.previousInvoices')}:{' '}
                  {pre.previousInvoices
                    .map((x) => `${x.externalNumber} (${sar(x.totalHalalas)})`)
                    .join(t('common.listSeparator'))}
                </p>
              )}
              <Table
                head={[
                  t('sales.contracts.itemDescription'),
                  t('sales.quotes.quantity'),
                  t('sales.quotes.unitPrice'),
                  t('sales.quotes.lineTotal'),
                ]}
              >
                {lines.map((l, i) => (
                  <tr key={i}>
                    <Td>
                      <Input
                        value={l.descriptionAr}
                        onChange={(e) =>
                          applyLines(
                            lines.map((x, j) => (j === i ? { ...x, descriptionAr: e.target.value } : x)),
                          )
                        }
                      />
                    </Td>
                    <Td>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        dir="ltr"
                        value={l.quantity}
                        onChange={(e) =>
                          applyLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                        }
                      />
                    </Td>
                    <Td>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        dir="ltr"
                        value={l.unitPriceSar}
                        onChange={(e) =>
                          applyLines(
                            lines.map((x, j) => (j === i ? { ...x, unitPriceSar: e.target.value } : x)),
                          )
                        }
                      />
                    </Td>
                    <Td className="tabular">
                      {sar(
                        Math.round(Number(l.quantity || 0) * Math.round(Number(l.unitPriceSar || 0) * 100)),
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Field label={t('sales.quotes.subtotal')}>
                  <Input
                    type="number"
                    step="0.01"
                    dir="ltr"
                    value={totals.subtotal}
                    onChange={(e) => setTotals({ ...totals, subtotal: e.target.value })}
                  />
                </Field>
                <Field label={t('sales.quotes.vat')}>
                  <Input
                    type="number"
                    step="0.01"
                    dir="ltr"
                    value={totals.vat}
                    onChange={(e) => setTotals({ ...totals, vat: e.target.value })}
                  />
                </Field>
                <Field label={t('sales.quotes.total')}>
                  <Input
                    type="number"
                    step="0.01"
                    dir="ltr"
                    value={totals.total}
                    onChange={(e) => setTotals({ ...totals, total: e.target.value })}
                  />
                </Field>
              </div>
              {differs && (
                <Field
                  label={t('sales.invoices.differenceReason')}
                  required
                  hint={t('sales.invoices.differenceHint', { amount: sar(pre.totals.totalHalalas) })}
                >
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
                </Field>
              )}
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('sales.invoices.kind')}>
                <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
                  <option value="tax">{t('sales.invoices.kinds.tax')}</option>
                  <option value="simplified">{t('sales.invoices.kinds.simplified')}</option>
                </Select>
              </Field>
              <Field label={t('sales.invoices.externalNumber')} required>
                <Input
                  dir="ltr"
                  value={v.externalNumber}
                  onChange={(e) => setV({ ...v, externalNumber: e.target.value })}
                  required
                />
              </Field>
              <Field label={t('sales.invoices.issueDate')} required>
                <Input
                  type="datetime-local"
                  dir="ltr"
                  value={v.issueDateTime}
                  onChange={(e) => setV({ ...v, issueDateTime: e.target.value })}
                  required
                />
              </Field>
              <Field label={t('sales.invoices.dueDate')} required>
                <Input
                  type="date"
                  dir="ltr"
                  value={v.dueDate}
                  onChange={(e) => setV({ ...v, dueDate: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label={t('sales.invoices.pdf')}>
              <FileUploader onUploaded={(r) => setPdf(r.attachmentId)} />
            </Field>
            <Field label={t('sales.requests.notes')}>
              <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPre(null)}>
                {t('sales.invoices.changeSource')}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={m.isPending} disabled={differs && !reason.trim()}>
                {t('actions.save')}
              </Button>
            </div>
            {pre.scheduleEntries.length > 0 && (
              <p className="text-xs text-slate-500">
                {pre.scheduleEntries
                  .map((e) => formatDateTime(e.doneAt ?? e.plannedAt))
                  .join(t('common.listSeparator'))}
              </p>
            )}
          </>
        )}
      </form>
    </Dialog>
  );
}

function PaymentDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState({ amount: '', paidAt: '', method: 'bank_transfer', reference: '' });
  const [proof, setProof] = useState('');
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post(`/finance/invoices/${invoice!._id}/payments`, {
        amountHalalas: Math.round(Number(v.amount) * 100),
        paidAt: localInputToIso(v.paidAt),
        method: v.method,
        reference: v.reference || undefined,
        proofAttachmentId: proof || undefined,
      }),
    onSuccess: () => {
      setV({ amount: '', paidAt: '', method: 'bank_transfer', reference: '' });
      setProof('');
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (!invoice) return null;
  return (
    <Dialog open onClose={onClose} title={`${t('sales.invoices.recordPayment')} — ${invoice.externalNumber}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm text-slate-600">
          {t('sales.invoices.remainingIs', { amount: sar(invoice.remainingHalalas) })}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.invoices.amountSar')} required>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              dir="ltr"
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
              required
            />
          </Field>
          <Field label={t('sales.invoices.paidAt')}>
            <Input
              type="datetime-local"
              dir="ltr"
              value={v.paidAt}
              onChange={(e) => setV({ ...v, paidAt: e.target.value })}
            />
          </Field>
          <Field label={t('sales.invoices.method')}>
            <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {t(`sales.paymentMethods.${pm}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('sales.invoices.reference')}>
            <Input
              dir="ltr"
              value={v.reference}
              onChange={(e) => setV({ ...v, reference: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('sales.invoices.proof')}>
          <FileUploader onUploaded={(r) => setProof(r.attachmentId)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={m.isPending} disabled={!v.amount}>
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
