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
import { collectionTone, useInvoices, type InvoiceRow } from './_data';

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

function RegisterDialog({
  open,
  onClose,
  onDone,
  salesOrderId,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  salesOrderId?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({
    salesOrderId: salesOrderId ?? '',
    kind: 'tax',
    externalNumber: '',
    issueDateTime: '',
    dueDate: '',
    notes: '',
  });
  const [pdf, setPdf] = useState('');
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post('/finance/invoices', {
        salesOrderId: v.salesOrderId,
        kind: v.kind,
        externalNumber: v.externalNumber,
        issueDateTime: localInputToIso(v.issueDateTime),
        dueDate: v.dueDate,
        pdfAttachmentId: pdf || undefined,
        notes: v.notes || undefined,
      }),
    onSuccess: () => {
      toast(t('sales.invoices.registered'));
      setError(undefined);
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
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Alert kind="info">{t('sales.invoices.optionAHint')}</Alert>
        <Field label={t('sales.invoices.salesOrderId')} required hint={t('sales.invoices.salesOrderHint')}>
          <Input
            dir="ltr"
            value={v.salesOrderId}
            onChange={(e) => setV({ ...v, salesOrderId: e.target.value })}
            required
          />
        </Field>
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
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={m.isPending}>
            {t('actions.save')}
          </Button>
        </div>
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
