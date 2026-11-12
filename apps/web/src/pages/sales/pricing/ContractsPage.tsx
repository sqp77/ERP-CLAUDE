import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { CONTRACT_STATES, PRICE_UNITS, SCHEDULE_KINDS } from '@eayni/shared';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localInputToIso } from '@/lib/dates';
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
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
import { sar } from '../../hr/_data';
import { useCustomers } from '../_data';
import { contractTone, useContract, useContracts } from './_data';

/** العقود الدورية [SAL §7.4, §6.3]: list with the expiring filter, and the contract page with schedule, alerts, renewal and the cooperation certificate. */
export function ContractsPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };
  const list = useContracts({
    state: get('state') || undefined,
    customerId: get('customerId') || undefined,
    expiringWithinDays: get('expiring') === 'true' ? 90 : undefined,
    limit: 200,
  });
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title={t('sales.contracts.title')}
        actions={
          can('sales.contracts', 'create') ? (
            <Button onClick={() => setOpen(true)}>{t('sales.contracts.new')}</Button>
          ) : undefined
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select
          value={get('state')}
          onChange={(e) => setParam('state', e.target.value)}
          aria-label={t('common.status')}
        >
          <option value="">{t('sales.contracts.allStates')}</option>
          {CONTRACT_STATES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.contractStates.${s}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('expiring') === 'true'}
            onChange={(e) => setParam('expiring', e.target.checked)}
          />{' '}
          {t('sales.contracts.expiringSoon')}
        </label>
      </div>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('sales.contracts.empty')} />
        ) : (
          <Table
            head={[
              t('common.number'),
              t('sales.customers.nameAr'),
              t('sales.contracts.type'),
              t('sales.contracts.start'),
              t('sales.contracts.end'),
              t('sales.contracts.daysLeft'),
              t('common.status'),
            ]}
          >
            {list.data.items.map((c) => (
              <tr
                key={c._id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => nav(`/sales/contracts/${c._id}`)}
              >
                <Td className="tabular text-xs text-slate-500">{c.number}</Td>
                <Td className="font-medium">{c.customerName}</Td>
                <Td>{c.contractType ?? '—'}</Td>
                <Td className="tabular">{formatDate(c.startDate)}</Td>
                <Td className="tabular">{formatDate(c.endDate)}</Td>
                <Td
                  className={cx(
                    'tabular',
                    c.daysLeft <= 90 && c.daysLeft > 0 && 'text-amber-700',
                    c.daysLeft <= 0 && 'text-red-700',
                  )}
                >
                  {c.daysLeft}
                </Td>
                <Td>
                  <Badge tone={contractTone[c.state]}>{c.stateAr}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ContractDialog
        open={open}
        onClose={() => setOpen(false)}
        customerId={get('customerId') || undefined}
      />
    </>
  );
}

function ContractDialog({
  open,
  onClose,
  customerId: preset,
  renewalOf,
}: {
  open: boolean;
  onClose: () => void;
  customerId?: string;
  renewalOf?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [customerQ, setCustomerQ] = useState('');
  const customers = useCustomers({ q: customerQ || undefined, limit: 20 });
  const [v, setV] = useState({
    customerId: preset ?? '',
    contractType: '',
    startDate: '',
    endDate: '',
    notes: '',
  });
  const [items, setItems] = useState<
    { descriptionAr: string; quantity: string; unit: string; price: string }[]
  >([{ descriptionAr: '', quantity: '', unit: 'ton', price: '' }]);
  const [signed, setSigned] = useState<string>('');
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () => {
      const body = {
        customerId: v.customerId || preset,
        contractType: v.contractType || undefined,
        startDate: v.startDate,
        endDate: v.endDate,
        notes: v.notes || undefined,
        signedFileAttachmentId: signed || undefined,
        items: items
          .filter((i) => i.descriptionAr)
          .map((i) => ({
            descriptionAr: i.descriptionAr,
            quantity: i.quantity ? Number(i.quantity) : undefined,
            unit: i.unit,
            agreedPriceHalalas: i.price ? Math.round(Number(i.price) * 100) : undefined,
          })),
        schedule: [],
      };
      return renewalOf
        ? post<{ _id: string }>(`/sales/contracts/${renewalOf}/renew`, { ...body, customerId: undefined })
        : post<{ _id: string }>('/sales/contracts', body);
    },
    onSuccess: (r) => {
      toast(t('actions.save'));
      qc.invalidateQueries({ queryKey: ['sales'] });
      onClose();
      nav(`/sales/contracts/${r._id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={renewalOf ? t('sales.contracts.renew') : t('sales.contracts.new')}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        {!preset && !renewalOf && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={customerQ}
              onChange={(e) => setCustomerQ(e.target.value)}
              placeholder={t('sales.customers.searchPlaceholder')}
              aria-label={t('actions.search')}
            />
            <Select
              value={v.customerId}
              onChange={(e) => setV({ ...v, customerId: e.target.value })}
              aria-label={t('sales.customers.nameAr')}
              required
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
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sales.contracts.type')} hint={t('sales.requests.listEmptyHint')}>
            <Input value={v.contractType} onChange={(e) => setV({ ...v, contractType: e.target.value })} />
          </Field>
          <div />
          <Field label={t('sales.contracts.start')} required>
            <Input
              type="date"
              dir="ltr"
              value={v.startDate}
              onChange={(e) => setV({ ...v, startDate: e.target.value })}
              required
            />
          </Field>
          <Field label={t('sales.contracts.end')} required>
            <Input
              type="date"
              dir="ltr"
              value={v.endDate}
              onChange={(e) => setV({ ...v, endDate: e.target.value })}
              required
            />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t('sales.contracts.items')}</div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_90px_100px] gap-2">
              <Input
                value={it.descriptionAr}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, descriptionAr: e.target.value } : x)))
                }
                placeholder={t('sales.contracts.itemDescription')}
                aria-label={t('sales.contracts.itemDescription')}
              />
              <Input
                type="number"
                min={0}
                dir="ltr"
                value={it.quantity}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                }
                placeholder={t('sales.quotes.quantity')}
                aria-label={t('sales.quotes.quantity')}
              />
              <Select
                value={it.unit}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))
                }
                aria-label={t('sales.pricelist.unit')}
              >
                {PRICE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {t(`sales.pricelist.units.${u}`)}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={it.price}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                }
                placeholder={t('sales.contracts.agreedPrice')}
                aria-label={t('sales.contracts.agreedPrice')}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setItems([...items, { descriptionAr: '', quantity: '', unit: 'ton', price: '' }])}
          >
            {t('sales.quotes.addLine')}
          </Button>
        </div>
        <Field label={t('sales.contracts.signedFile')}>
          <FileUploader onUploaded={(r) => setSigned(r.attachmentId)} />
        </Field>
        <Field label={t('sales.customers.notes')}>
          <Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="submit"
            loading={m.isPending}
            disabled={!v.startDate || !v.endDate || (!v.customerId && !preset && !renewalOf)}
          >
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ContractPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useContract(id);
  const [schedule, setSchedule] = useState({ plannedAt: '', kind: 'delivery', note: '' });
  const [renewOpen, setRenewOpen] = useState(false);
  const [sendCert, setSendCert] = useState<{ certId: string; to: string } | null>(null);
  const [mailto, setMailto] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['sales'] });
  const act = useMutation({
    mutationFn: (p: { path: string; body?: Record<string, unknown> }) =>
      post<Record<string, unknown>>(`/sales/contracts/${id}/${p.path}`, p.body),
    onSuccess: (r) => {
      refresh();
      if (typeof r.mailto === 'string') setMailto(r.mailto);
      toast(t('actions.save'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <Spinner />;
  const c = q.data;
  return (
    <>
      <PageHeader
        title={c.number}
        subtitle={`${c.customerName}${c.contractType ? ` · ${c.contractType}` : ''}`}
        actions={
          <>
            <Badge tone={contractTone[c.state]}>{c.stateAr}</Badge>
            {c.yearOrMore && <Badge tone="brand">{t('sales.contracts.yearOrMore')}</Badge>}
            {c.canEdit && ['active', 'expiring', 'expired'].includes(c.state) && (
              <Button variant="secondary" onClick={() => setRenewOpen(true)}>
                {t('sales.contracts.renew')}
              </Button>
            )}
            {c.canCertify && (
              <Button onClick={() => act.mutate({ path: 'certificates' })} loading={act.isPending}>
                {t('sales.contracts.issueCertificate')}
              </Button>
            )}
          </>
        }
      />
      {c.state === 'expiring' && (
        <Alert kind="warning">{t('sales.contracts.expiringAlert', { days: c.daysLeft })}</Alert>
      )}
      {c.yearOrMore && !c.canCertify && ['active'].includes(c.state) && (
        <p className="mt-1 text-xs text-slate-500">
          {t('sales.contracts.certificateFrom', { date: formatDate(c.certificateWindowFrom) })}
        </p>
      )}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title={t('sales.contracts.details')}>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Row k={t('sales.contracts.start')} v={formatDate(c.startDate)} />
            <Row k={t('sales.contracts.end')} v={formatDate(c.endDate)} />
            <Row
              k={t('sales.contracts.duration')}
              v={`${c.durationMonths ?? '—'} ${t('sales.contracts.months')}`}
            />
            <Row k={t('sales.customers.owner')} v={c.ownerName} />
            {c.renewalOf && (
              <Row
                k={t('sales.contracts.renewalOf')}
                v={
                  <Link to={`/sales/contracts/${c.renewalOf}`} className="text-brand-700 hover:underline">
                    {t('sales.contracts.previous')}
                  </Link>
                }
              />
            )}
            {c.notes && <Row k={t('sales.customers.notes')} v={c.notes} />}
          </dl>
          {!!c.items.length && (
            <Table
              head={[
                t('sales.contracts.itemDescription'),
                t('sales.quotes.quantity'),
                t('sales.pricelist.unit'),
                t('sales.contracts.agreedPrice'),
              ]}
            >
              {c.items.map((it, i) => (
                <tr key={i}>
                  <Td>{it.descriptionAr}</Td>
                  <Td className="tabular">{it.quantity ?? '—'}</Td>
                  <Td>{it.unit ? t(`sales.pricelist.units.${it.unit}`) : '—'}</Td>
                  <Td className="tabular">{sar(it.agreedPriceHalalas)}</Td>
                </tr>
              ))}
            </Table>
          )}
          {!!c.files.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {c.files.map((f) => (
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
        <Card title={t('sales.contracts.schedule')}>
          {!c.schedule.length ? (
            <EmptyState title={t('sales.contracts.noSchedule')} />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {c.schedule.map((s) => (
                <li key={s._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {t(`sales.contracts.scheduleKinds.${s.kind}`)} ·{' '}
                    <span className="tabular">{formatDateTime(s.plannedAt)}</span>
                    {s.note && <span className="text-slate-500"> — {s.note}</span>}
                  </span>
                  <span className="flex items-center gap-1">
                    <Badge tone={s.status === 'done' ? 'green' : s.status === 'missed' ? 'red' : 'slate'}>
                      {t(`sales.contracts.scheduleStatuses.${s.status}`)}
                    </Badge>
                    {c.canEdit && s.status === 'planned' && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            act.mutate({ path: `schedule/${s._id}/status`, body: { status: 'done' } })
                          }
                        >
                          {t('sales.contracts.scheduleStatuses.done')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            act.mutate({ path: `schedule/${s._id}/status`, body: { status: 'missed' } })
                          }
                        >
                          {t('sales.contracts.scheduleStatuses.missed')}
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {c.canEdit && (
            <form
              className="mt-3 grid grid-cols-[1fr_110px_1fr_auto] items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (schedule.plannedAt)
                  act.mutate({
                    path: 'schedule',
                    body: {
                      plannedAt: localInputToIso(schedule.plannedAt),
                      kind: schedule.kind,
                      note: schedule.note || undefined,
                    },
                  });
              }}
            >
              <Field label={t('sales.contracts.plannedAt')}>
                <Input
                  type="datetime-local"
                  dir="ltr"
                  value={schedule.plannedAt}
                  onChange={(e) => setSchedule({ ...schedule, plannedAt: e.target.value })}
                />
              </Field>
              <Field label={t('sales.contracts.kind')}>
                <Select
                  value={schedule.kind}
                  onChange={(e) => setSchedule({ ...schedule, kind: e.target.value })}
                >
                  {SCHEDULE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`sales.contracts.scheduleKinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('sales.requests.note')}>
                <Input
                  value={schedule.note}
                  onChange={(e) => setSchedule({ ...schedule, note: e.target.value })}
                />
              </Field>
              <Button type="submit" variant="secondary">
                {t('actions.create')}
              </Button>
            </form>
          )}
        </Card>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title={t('sales.contracts.certificates')}>
          {!c.certificates.length ? (
            <EmptyState
              title={t('sales.contracts.noCertificates')}
              hint={
                c.yearOrMore
                  ? t('sales.contracts.certificateFrom', { date: formatDate(c.certificateWindowFrom) })
                  : t('sales.contracts.certificateYearOnly')
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {c.certificates.map((x) => (
                <li key={x._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <strong>{x.number}</strong> · {formatDateTime(x.issuedAt)}
                    {x.sendLog.length > 0 && (
                      <span className="text-xs text-slate-500">
                        {' '}
                        · {t('sales.contracts.sentTimes', { count: x.sendLog.length })}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-1">
                    <Button variant="secondary" onClick={() => downloadAttachment(x.attachmentId)}>
                      {t('files.download')}
                    </Button>
                    <Button variant="secondary" onClick={() => setSendCert({ certId: x._id, to: '' })}>
                      {t('actions.send')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('sales.contracts.log')}>
          <ol className="space-y-1 text-xs">
            {c.events.map((e) => (
              <li key={e._id} className="flex justify-between gap-2 rounded border border-slate-100 p-1.5">
                <span>
                  {t(`sales.contracts.events.${e.type}`, { defaultValue: e.type })}
                  {e.note && <span className="text-slate-500"> ({e.note})</span>}
                </span>
                <span className="shrink-0 text-slate-500 tabular">
                  {e.byName} · {formatDateTime(e.at)}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <ContractDialog open={renewOpen} onClose={() => setRenewOpen(false)} renewalOf={id} />
      <Dialog
        open={!!sendCert}
        onClose={() => {
          setSendCert(null);
          setMailto('');
        }}
        title={t('sales.contracts.sendCertificate')}
      >
        {mailto ? (
          <div className="space-y-3 text-sm">
            <Alert kind="warning">{t('sales.quotes.mailboxDisabled')}</Alert>
            <a
              href={mailto}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-white"
            >
              {t('sales.quotes.openMailClient')}
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={t('sales.quotes.to')} required hint={t('sales.quotes.toHint')}>
              <Input
                dir="ltr"
                value={sendCert?.to ?? ''}
                onChange={(e) => setSendCert({ ...sendCert!, to: e.target.value })}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                onClick={() =>
                  act.mutate({
                    path: `certificates/${sendCert!.certId}/send`,
                    body: { to: sendCert!.to.split(/[,;\s]+/).filter(Boolean) },
                  })
                }
                disabled={!sendCert?.to.trim()}
                loading={act.isPending}
              >
                {t('actions.send')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
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
