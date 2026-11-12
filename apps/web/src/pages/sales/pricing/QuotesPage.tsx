import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QUOTE_STATES } from '@eayni/shared';
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
import { useCustomers } from '../_data';
import { quoteTone, usePriceList, useQuotes } from './_data';

/** عروض الأسعار [SAL §3 م2–م3, §18]: list with the approval queue, and the builder from the approved price list [§7.1]. */
export function QuotesPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };
  const approver = user?.roles.some((r) => r.role === 'sales_manager' || r.role === 'executive');
  const list = useQuotes({
    state: get('state') || undefined,
    customerId: get('customerId') || undefined,
    awaitingMyApproval: get('approvals') === 'true',
    q: get('q') || undefined,
    limit: 200,
  });
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title={t('sales.quotes.title')}
        actions={
          <>
            {approver && (
              <Button variant="secondary" onClick={() => setParam('approvals', get('approvals') !== 'true')}>
                {t('sales.quotes.awaitingMyApproval')}
              </Button>
            )}
            {can('sales.quotes', 'create') && (
              <Button onClick={() => setOpen(true)}>{t('sales.quotes.new')}</Button>
            )}
          </>
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
          value={get('state')}
          onChange={(e) => setParam('state', e.target.value)}
          aria-label={t('common.status')}
        >
          <option value="">{t('sales.quotes.allStates')}</option>
          {QUOTE_STATES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.quoteStates.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('sales.quotes.empty')} />
        ) : (
          <Table
            head={[
              t('common.number'),
              t('sales.customers.nameAr'),
              t('sales.customers.owner'),
              t('sales.quotes.total'),
              t('sales.quotes.validUntil'),
              t('common.status'),
            ]}
          >
            {list.data.items.map((q) => (
              <tr
                key={q._id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => nav(`/sales/quotes/${q._id}`)}
              >
                <Td className="tabular text-xs text-slate-500">
                  {q.number} {q.version > 1 && <Badge tone="slate">v{q.version}</Badge>}
                </Td>
                <Td className="font-medium">{q.customerName}</Td>
                <Td>{q.ownerName}</Td>
                <Td className="tabular">{sar(q.totalHalalas)}</Td>
                <Td className="tabular">{q.validUntil ? formatDate(q.validUntil) : '—'}</Td>
                <Td>
                  <Badge tone={quoteTone[q.state]}>{q.stateAr}</Badge>
                  {q.approval?.limitsUnset && q.state === 'pending_approval' && (
                    <span className="ms-1 text-xs text-amber-700">{t('sales.quotes.limitsUnsetShort')}</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <QuoteBuilderDialog
        open={open}
        onClose={() => setOpen(false)}
        customerId={get('customerId') || undefined}
        opportunityId={get('opportunityId') || undefined}
        requestId={get('requestId') || undefined}
      />
    </>
  );
}

interface LineDraft {
  itemId: string;
  quantity: string;
  discountPercent: string;
}
interface Preview {
  lines: {
    descriptionAr: string;
    unit: string;
    listPriceHalalas: number;
    marketPriceHalalas?: number;
    discountPercentBp: number;
    netUnitPriceHalalas: number;
    lineTotalHalalas: number;
    vatHalalas: number;
  }[];
  subtotalHalalas: number;
  discountTotalHalalas: number;
  vatTotalHalalas: number;
  totalHalalas: number;
  maxDiscountBp: number;
  approval: { level: 'none' | 'manager' | 'executive'; limitsUnset: boolean };
}

/** Quote builder: lines from the approved price list, market price shown as a hint, server-computed totals and approval level [SAL §3 م2, §7.1, §7.2]. */
export function QuoteBuilderDialog({
  open,
  onClose,
  customerId: presetCustomer,
  opportunityId,
  requestId,
}: {
  open: boolean;
  onClose: () => void;
  customerId?: string;
  opportunityId?: string;
  requestId?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const nav = useNavigate();
  const prices = usePriceList();
  const [customerQ, setCustomerQ] = useState('');
  const customers = useCustomers({ q: customerQ || undefined, limit: 20 });
  const [customerId, setCustomerId] = useState(presetCustomer ?? '');
  const [lines, setLines] = useState<LineDraft[]>([{ itemId: '', quantity: '1', discountPercent: '' }]);
  const [notes, setNotes] = useState('');
  const [internal, setInternal] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (presetCustomer) setCustomerId(presetCustomer);
  }, [presetCustomer]);
  const payloadLines = () =>
    lines
      .filter((l) => l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity) || 1,
        discountPercentBp: l.discountPercent ? Math.round(Number(l.discountPercent) * 100) : undefined,
      }));
  const doPreview = useMutation({
    mutationFn: () => post<Preview>('/sales/quotes/preview', { lines: payloadLines() }),
    onSuccess: (p) => {
      setPreview(p);
      setError(undefined);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () =>
      post<{ _id: string }>('/sales/quotes', {
        customerId,
        opportunityId: opportunityId || undefined,
        requestId: requestId || undefined,
        lines: payloadLines(),
        notesForCustomer: notes || undefined,
        internalNotes: internal || undefined,
        attachmentIds: [],
      }),
    onSuccess: (r) => {
      toast(t('sales.quotes.created'));
      onClose();
      nav(`/sales/quotes/${r._id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const items = prices.data?.items.filter((i) => i.active && i.priceHalalas != null) ?? [];
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.quotes.new')}>
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        {prices.data?.matrix.limitsUnset && <Alert kind="warning">{t('sales.pricelist.limitsUnset')}</Alert>}
        {!presetCustomer && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={customerQ}
              onChange={(e) => setCustomerQ(e.target.value)}
              placeholder={t('sales.customers.searchPlaceholder')}
              aria-label={t('actions.search')}
            />
            <Select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              aria-label={t('sales.customers.nameAr')}
            >
              <option value="">—</option>
              {customers.data?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.number} — {c.nameAr}
                </option>
              ))}
            </Select>
          </div>
        )}
        {!items.length && <Alert kind="info">{t('sales.quotes.noPricedItems')}</Alert>}
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_90px_auto] items-end gap-2">
              <Field label={t('sales.pricelist.item')}>
                <Select
                  value={l.itemId}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))
                  }
                >
                  <option value="">—</option>
                  {items.map((it) => (
                    <option key={it._id} value={it._id}>
                      {it.nameAr} — {sar(it.priceHalalas!)}/{t(`sales.pricelist.units.${it.unit}`)}
                      {it.marketPriceHalalas != null
                        ? ` (${t('sales.pricelist.market')} ${sar(it.marketPriceHalalas)})`
                        : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('sales.quotes.quantity')}>
                <Input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={l.quantity}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label={t('sales.quotes.discountPercent')}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  dir="ltr"
                  value={l.discountPercent}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, discountPercent: e.target.value } : x)))
                  }
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
                disabled={lines.length === 1}
              >
                {t('actions.delete')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setLines([...lines, { itemId: '', quantity: '1', discountPercent: '' }])}
          >
            {t('sales.quotes.addLine')}
          </Button>
        </div>
        <Field label={t('sales.quotes.notesForCustomer')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label={t('sales.quotes.internalNotes')} hint={t('sales.quotes.internalHint')}>
          <Textarea rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => doPreview.mutate()}
            disabled={!payloadLines().length}
            loading={doPreview.isPending}
          >
            {t('sales.quotes.preview')}
          </Button>
          {preview && (
            <div className="text-sm">
              <span className="tabular">
                {t('sales.quotes.total')}: <strong>{sar(preview.totalHalalas)}</strong>
              </span>
              <span className="ms-3">
                {t('sales.quotes.requiredApproval')}:{' '}
                <Badge tone={preview.approval.level === 'none' ? 'green' : 'amber'}>
                  {t(`sales.quotes.levels.${preview.approval.level}`)}
                </Badge>
                {preview.approval.limitsUnset && (
                  <span className="ms-1 text-xs text-amber-700">{t('sales.quotes.limitsUnsetShort')}</span>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!customerId || !payloadLines().length}
          >
            {t('actions.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Small link list used on the customer file. */
export function QuoteLinks({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  return (
    <Link to={`/sales/quotes?customerId=${customerId}`} className="text-brand-700 hover:underline">
      {t('sales.quotes.title')}
    </Link>
  );
}
