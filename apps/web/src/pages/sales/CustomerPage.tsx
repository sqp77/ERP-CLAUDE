import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { COMMUNICATION_METHODS, CUSTOMER_CLASSIFICATIONS, CUSTOMER_STATUSES } from '@eayni/shared';
import { del, patch, post } from '@/lib/api';
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
  Textarea,
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
import { sar } from '../hr/_data';
import { TransferDialog } from './CustomersPage';
import { OpportunityDialog } from './PipelinePage';
import { DiscussionPanel } from '../discussions/DiscussionsPage';
import {
  stageTone,
  statusTone,
  useCustomer,
  useCustomerLogs,
  useOpportunities,
  useSalesTags,
  type ContactRow,
} from './_data';

type Tab = 'log' | 'contacts' | 'opportunities' | 'discussions' | 'data' | 'history';
const TABS: Tab[] = ['log', 'contacts', 'opportunities', 'discussions', 'data', 'history'];

/** ملف العميل وسجل التواصل [SAL §4.1, §18]: one file per organization; the log is chronological and append-only. */
export function CustomerPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'log') as Tab;
  const setTab = (v: Tab) => setParams((p) => ({ ...Object.fromEntries(p), tab: v }), { replace: true });
  const q = useCustomer(id);
  const logs = useCustomerLogs(id);
  const opps = useOpportunities({ customerId: id, limit: 100 }, !!id);
  const tags = useSalesTags();
  const [transfer, setTransfer] = useState(false);
  const [oppOpen, setOppOpen] = useState<string | 'new' | null>(null);
  const [contact, setContact] = useState<Partial<ContactRow> | null>(null);
  const [editTags, setEditTags] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm'] });
    qc.invalidateQueries({ queryKey: ['sales'] });
  };
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/crm/customers/${id}`, body),
    onSuccess: () => {
      refresh();
      toast(t('actions.save'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const saveContact = useMutation({
    mutationFn: (c: Partial<ContactRow>) =>
      c._id
        ? patch(`/crm/customers/${id}/contacts/${c._id}`, {
            nameAr: c.nameAr,
            jobTitle: c.jobTitle || undefined,
            phone: c.phone || undefined,
            email: c.email || undefined,
            notes: c.notes || undefined,
          })
        : post(`/crm/customers/${id}/contacts`, {
            nameAr: c.nameAr,
            jobTitle: c.jobTitle || undefined,
            phone: c.phone || undefined,
            email: c.email || undefined,
            notes: c.notes || undefined,
          }),
    onSuccess: () => {
      setContact(null);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const removeContact = useMutation({
    mutationFn: (cid: string) => del(`/crm/customers/${id}/contacts/${cid}`),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <Spinner />;
  const c = q.data;
  const overdue = c.nextFollowUpAt && new Date(c.nextFollowUpAt) < new Date();

  return (
    <>
      <PageHeader
        title={c.nameAr}
        subtitle={`${c.number} · ${t(`sales.sources.${c.source}`)}${c.city ? ` · ${c.city}` : ''}`}
        actions={
          <>
            <Badge tone={statusTone[c.status]}>{t(`sales.statuses.${c.status}`)}</Badge>
            {c.classification && <Badge tone="brand">{t(`sales.classifications.${c.classification}`)}</Badge>}
            {c.canManage && (
              <Button variant="secondary" onClick={() => setTransfer(true)}>
                {t('sales.transfer.single')}
              </Button>
            )}
            <Link to={`/calendar?new=customer:${id}`}>
              <Button variant="secondary">{t('sales.customers.scheduleMeeting')}</Button>
            </Link>
            <Button onClick={() => setOppOpen('new')}>{t('sales.opportunities.new')}</Button>
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Info label={t('sales.customers.owner')} value={c.ownerName} />
        <Info
          label={t('sales.customers.lastContact')}
          value={c.lastContactAt ? formatDateTime(c.lastContactAt) : '—'}
        />
        <Info
          label={t('sales.customers.nextFollowUp')}
          value={c.nextFollowUpAt ? formatDateTime(c.nextFollowUpAt) : '—'}
          tone={overdue ? 'red' : undefined}
        />
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="text-xs text-slate-500">{t('sales.tags.title')}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {c.tags.length ? (
              c.tags.map((x) => <Badge key={x}>{x}</Badge>)
            ) : (
              <span className="text-slate-400">—</span>
            )}
            <button
              type="button"
              className="text-xs text-brand-700 hover:underline"
              onClick={() => setEditTags(true)}
            >
              {t('actions.edit')}
            </button>
          </div>
        </div>
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {TABS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={cx(
              'whitespace-nowrap rounded-md px-3 py-1.5',
              tab === v ? 'bg-brand-700 text-white' : 'text-slate-600',
            )}
          >
            {t(`sales.customers.tabs.${v}`)}
            {v === 'contacts' && ` (${c.contacts.length})`}
            {v === 'opportunities' && opps.data && ` (${opps.data.total})`}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
          <Card title={t('sales.log.title')}>
            {logs.isLoading ? (
              <Spinner />
            ) : !logs.data?.items.length ? (
              <EmptyState title={t('sales.log.empty')} hint={t('sales.log.emptyHint')} />
            ) : (
              <ol className="space-y-3">
                {logs.data.items.map((l) => (
                  <li key={l._id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        <Badge tone="slate">{t(`sales.methods.${l.method}`)}</Badge> {l.authorName}
                        {l.source?.type === 'calendar_event' && (
                          <Link
                            to={`/calendar?event=${l.source.id}`}
                            className="ms-2 text-brand-700 hover:underline"
                          >
                            {t('sales.log.fromCalendar')}
                          </Link>
                        )}
                      </span>
                      <span className="tabular">{formatDateTime(l.at)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap">{l.details}</p>
                    <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">
                      {l.outcome && <Row k={t('sales.log.outcome')} v={l.outcome} />}
                      {l.customerNeed && <Row k={t('sales.log.customerNeed')} v={l.customerNeed} />}
                      {l.nextStep && <Row k={t('sales.log.nextStep')} v={l.nextStep} />}
                      {l.nextFollowUpAt && (
                        <Row k={t('sales.log.nextFollowUpAt')} v={formatDateTime(l.nextFollowUpAt)} />
                      )}
                    </dl>
                    {!!l.attachmentIds.length && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {l.attachmentIds.map((a) => (
                          <button
                            key={a}
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                            onClick={() => downloadAttachment(a)}
                          >
                            <Paperclip className="size-3" /> {t('files.attachment')}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <LogComposer customerId={id} onDone={refresh} />
        </div>
      )}

      {tab === 'discussions' && <DiscussionPanel recordType="customer" recordId={id} />}

      {tab === 'contacts' && (
        <Card
          title={t('sales.contacts.title')}
          actions={
            c.contacts.length < 3 ? (
              <Button variant="secondary" onClick={() => setContact({})}>
                {t('sales.contacts.add')}
              </Button>
            ) : (
              <span className="text-xs text-slate-500">{t('sales.contacts.maxHint')}</span>
            )
          }
        >
          {!c.contacts.length ? (
            <EmptyState title={t('sales.contacts.empty')} />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {c.contacts.map((x) => (
                <li key={x._id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div>
                    <div className="font-medium">
                      {x.nameAr} {x.jobTitle && <span className="text-slate-500">— {x.jobTitle}</span>}
                    </div>
                    <div className="text-xs text-slate-600" dir="ltr">
                      {[x.phone, x.email].filter(Boolean).join(' · ')}
                    </div>
                    {x.notes && <div className="text-xs text-slate-500">{x.notes}</div>}
                  </div>
                  <span className="flex gap-1">
                    <Button variant="secondary" onClick={() => setContact(x)}>
                      {t('actions.edit')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (confirm(t('common.deleteConfirm'))) removeContact.mutate(x._id);
                      }}
                    >
                      {t('actions.delete')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'opportunities' && (
        <Card title={t('sales.opportunities.title')}>
          {opps.isLoading ? (
            <Spinner />
          ) : !opps.data?.items.length ? (
            <EmptyState title={t('sales.opportunities.empty')} />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {opps.data.items.map((o) => (
                <li key={o._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <button
                    type="button"
                    className="text-start hover:underline"
                    onClick={() => setOppOpen(o._id)}
                  >
                    <span className="text-xs text-slate-500 tabular">{o.number}</span>{' '}
                    <span className="font-medium">{o.title}</span>
                    {o.serviceType && (
                      <span className="text-slate-500"> — {t(`sales.services.${o.serviceType}`)}</span>
                    )}
                  </button>
                  <span className="flex items-center gap-2">
                    <span className="tabular text-xs">{sar(o.expectedValueHalalas)}</span>
                    <Badge tone={stageTone[o.stage]}>{t(`sales.stages.${o.stage}`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'data' && (
        <Card title={t('sales.customers.tabs.data')}>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Row k={t('sales.customers.kind')} v={t(`sales.customers.kinds.${c.kind}`)} />
            <Row k={t('sales.customers.country')} v={c.country ?? '—'} />
            <Row k={t('sales.customers.region')} v={c.region ?? '—'} />
            <Row k={t('sales.customers.city')} v={c.city ?? '—'} />
            <Row k={t('sales.customers.activity')} v={c.activity ?? '—'} />
            <Row k={t('sales.customers.organizationType')} v={c.organizationType ?? '—'} />
            <Row k={t('sales.customers.facilitySize')} v={c.facilitySize ?? '—'} />
            <Row k={t('sales.customers.phone')} v={c.phone ?? '—'} />
            <Row k={t('sales.customers.email')} v={c.email ?? '—'} />
            <Row k={t('sales.customers.crNumber')} v={c.party?.crNumber ?? '—'} />
            <Row k={t('sales.customers.unifiedNumber')} v={c.party?.unifiedNumber ?? '—'} />
            <Row k={t('sales.customers.vatNumber')} v={c.party?.vatNumber ?? '—'} />
            <Row k={t('sales.customers.nationalAddress')} v={c.party?.nationalAddress ?? '—'} />
            <Row
              k={t('sales.customers.createdBy')}
              v={`${c.createdByName ?? ''} · ${formatDate(c.createdAt)}`}
            />
            {c.leadId && (
              <Row
                k={t('sales.customers.fromLead')}
                v={
                  <Link to={`/sales/leads?lead=${c.leadId}`} className="text-brand-700 hover:underline">
                    {t('sales.customers.openLead')}
                  </Link>
                }
              />
            )}
          </dl>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('sales.customers.status')}>
              <Select value={c.status} onChange={(e) => update.mutate({ status: e.target.value })}>
                {CUSTOMER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sales.statuses.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {c.canManage && (
              <Field
                label={t('sales.customers.classification')}
                hint={t('sales.customers.classificationHint')}
              >
                <Select
                  value={c.classification ?? ''}
                  onChange={(e) => update.mutate({ classification: e.target.value || null })}
                >
                  <option value="">—</option>
                  {CUSTOMER_CLASSIFICATIONS.map((s) => (
                    <option key={s} value={s}>
                      {t(`sales.classifications.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {c.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{c.notes}</p>}
        </Card>
      )}

      {tab === 'history' && (
        <Card title={t('sales.customers.tabs.history')}>
          <ol className="space-y-2 text-sm">
            {c.events.map((e) => (
              <li
                key={e._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2"
              >
                <span>
                  <Badge tone="slate">{t(`sales.customers.events.${e.type}`)}</Badge>{' '}
                  {e.type === 'owner_changed' && `${e.fromUserName ?? ''} → ${e.toUserName ?? ''}`}
                  {e.type === 'status_changed' &&
                    `${e.from ? t(`sales.statuses.${e.from}`) : '—'} → ${t(`sales.statuses.${e.to}`)}`}
                  {e.type === 'classification_changed' &&
                    `${e.from ? t(`sales.classifications.${e.from}`) : '—'} → ${e.to ? t(`sales.classifications.${e.to}`) : '—'}`}
                  {e.type === 'lead_linked' && e.to}
                  {e.reason && <span className="text-slate-500"> ({e.reason})</span>}
                </span>
                <span className="text-xs text-slate-500 tabular">
                  {e.byUserName} · {formatDateTime(e.at)}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {c.canManage && (
        <TransferDialog
          open={transfer}
          customerIds={[id]}
          onClose={() => setTransfer(false)}
          onDone={() => {
            setTransfer(false);
            refresh();
            toast(t('sales.transfer.done'));
          }}
        />
      )}
      <OpportunityDialog id={oppOpen} customerId={id} onClose={() => setOppOpen(null)} />
      <Dialog
        open={!!contact}
        onClose={() => setContact(null)}
        title={contact?._id ? t('sales.contacts.edit') : t('sales.contacts.add')}
      >
        {contact && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveContact.mutate(contact);
            }}
          >
            <Field label={t('sales.contacts.name')} required>
              <Input
                value={contact.nameAr ?? ''}
                onChange={(e) => setContact({ ...contact, nameAr: e.target.value })}
                required
                minLength={2}
              />
            </Field>
            <Field label={t('sales.contacts.jobTitle')}>
              <Input
                value={contact.jobTitle ?? ''}
                onChange={(e) => setContact({ ...contact, jobTitle: e.target.value })}
              />
            </Field>
            <Field label={t('sales.contacts.phone')}>
              <Input
                value={contact.phone ?? ''}
                onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                inputMode="tel"
                dir="ltr"
              />
            </Field>
            <Field label={t('sales.contacts.email')}>
              <Input
                value={contact.email ?? ''}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
                type="email"
                dir="ltr"
              />
            </Field>
            <Field label={t('sales.contacts.notes')}>
              <Textarea
                value={contact.notes ?? ''}
                onChange={(e) => setContact({ ...contact, notes: e.target.value })}
                rows={2}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setContact(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={saveContact.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog open={editTags} onClose={() => setEditTags(false)} title={t('sales.tags.title')}>
        <div className="flex flex-wrap gap-1.5">
          {tags.data?.items.map((tag) => {
            const on = c.tags.includes(tag.name);
            return (
              <button
                key={tag._id}
                type="button"
                className={cx(
                  'rounded-full border px-2.5 py-1 text-xs',
                  on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600',
                )}
                onClick={() =>
                  update.mutate({ tags: on ? c.tags.filter((x) => x !== tag.name) : [...c.tags, tag.name] })
                }
              >
                {tag.name}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">{t('sales.tags.pickHint')}</p>
      </Dialog>
    </>
  );
}

function Info({ label, value, tone }: { label: string; value?: string; tone?: 'red' }) {
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

/** Phone-first composer for سجل التواصل [SAL §4.1 ثالثاً, §10.2]: method, details, outcome, need, next step, next follow-up, photos/documents. */
function LogComposer({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [method, setMethod] = useState<string>('call');
  const [details, setDetails] = useState('');
  const [outcome, setOutcome] = useState('');
  const [need, setNeed] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [atts, setAtts] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post(`/crm/customers/${customerId}/logs`, {
        method,
        details,
        outcome: outcome || undefined,
        customerNeed: need || undefined,
        nextStep: nextStep || undefined,
        nextFollowUpAt: localInputToIso(followUp),
        attachmentIds: atts.map((a) => a.attachmentId),
      }),
    onSuccess: () => {
      setDetails('');
      setOutcome('');
      setNeed('');
      setNextStep('');
      setFollowUp('');
      setAtts([]);
      setError(undefined);
      toast(t('sales.log.added'));
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card title={t('sales.log.add')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (details.trim()) m.mutate();
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <div
          className="grid grid-cols-4 gap-1 rounded-lg border border-slate-200 p-1 text-xs"
          role="radiogroup"
          aria-label={t('sales.log.method')}
        >
          {COMMUNICATION_METHODS.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={method === x}
              onClick={() => setMethod(x)}
              className={cx(
                'min-h-10 rounded-md px-2 py-1.5',
                method === x ? 'bg-brand-700 text-white' : 'text-slate-600',
              )}
            >
              {t(`sales.methods.${x}`)}
            </button>
          ))}
        </div>
        <Field label={t('sales.log.details')} required>
          <Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} required />
        </Field>
        <Field label={t('sales.log.outcome')}>
          <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </Field>
        <Field label={t('sales.log.customerNeed')}>
          <Input value={need} onChange={(e) => setNeed(e.target.value)} />
        </Field>
        <Field label={t('sales.log.nextStep')}>
          <Input value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
        </Field>
        <Field label={t('sales.log.nextFollowUpAt')} hint={t('sales.log.followUpHint')}>
          <Input
            type="datetime-local"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            dir="ltr"
          />
        </Field>
        <div className="space-y-1">
          <FileUploader
            ownerType="customer"
            ownerId={customerId}
            onUploaded={(r) => setAtts((a) => [...a, r])}
            label={t('sales.log.attach')}
          />
          {atts.map((a) => (
            <div key={a.attachmentId} className="text-xs text-slate-600">
              {a.fileName}
            </div>
          ))}
        </div>
        <Button type="submit" className="w-full" loading={m.isPending} disabled={!details.trim()}>
          {t('sales.log.save')}
        </Button>
        <p className="text-xs text-slate-500">{t('sales.log.appendOnlyHint')}</p>
      </form>
    </Card>
  );
}
