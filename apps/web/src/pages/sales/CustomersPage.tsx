import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CUSTOMER_CLASSIFICATIONS, CUSTOMER_SOURCES, CUSTOMER_STATUSES } from '@eayni/shared';
import { del, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { errorMessage } from '@/lib/errors';
import {
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
import { NewCustomerDialog } from './NewCustomerDialog';
import { DrillBanner, useDrill, type DrillKey } from './DrillFilters';

const DRILL: DrillKey[] = ['createdFrom', 'createdTo'];
import { statusTone, useCustomers, useSalesTags, useSalesTeam, type TagRow } from './_data';

/** قاعدة بيانات العملاء [SAL §4, §12 ثانياً]: search with Arabic normalization, filters, tags; the manager transfers in bulk and manages tags. */
export function CustomersPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const manager = (user?.permissions.find((p) => p.resource === 'crm.customers')?.scope ?? 'own') !== 'own';
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    next.delete('page');
    setParams(next, { replace: true });
  };
  const [q, setQ] = useState(get('q'));
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const page = Number(get('page') || 1);
  const drill = useDrill(DRILL);
  const list = useCustomers({
    ...drill,
    q: get('q') || undefined,
    status: get('status') || undefined,
    source: get('source') || undefined,
    classification: get('classification') || undefined,
    tag: get('tag') || undefined,
    ownerUserId: get('view') === 'mine' ? user?.id : get('ownerUserId') || undefined,
    followUpDue: get('followUpDue') === 'true',
    referredFromCs: get('referredFromCs') === 'true',
    sort: get('sort') || 'recent',
    page,
    limit: 50,
  });
  const tags = useSalesTags();
  const team = useSalesTeam(manager);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 50));

  return (
    <>
      <PageHeader
        title={t('sales.customers.title')}
        subtitle={list.data ? t('sales.customers.count', { count: list.data.total }) : undefined}
        actions={
          <>
            {manager && (
              <Button variant="secondary" onClick={() => setTagsOpen(true)}>
                {t('sales.tags.manage')}
              </Button>
            )}
            {manager && selected.length > 0 && (
              <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                {t('sales.transfer.button', { count: selected.length })}
              </Button>
            )}
            <Button onClick={() => setNewOpen(true)}>{t('sales.newCustomer')}</Button>
          </>
        }
      />
      <DrillBanner keys={DRILL} />
      <form
        className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setParam('q', q);
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('sales.customers.searchPlaceholder')}
          aria-label={t('actions.search')}
          className="col-span-2"
        />
        <Select
          value={get('status')}
          onChange={(e) => setParam('status', e.target.value)}
          aria-label={t('sales.customers.status')}
        >
          <option value="">{t('sales.customers.allStatuses')}</option>
          {CUSTOMER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          value={get('source')}
          onChange={(e) => setParam('source', e.target.value)}
          aria-label={t('sales.customers.source')}
        >
          <option value="">{t('sales.customers.allSources')}</option>
          {CUSTOMER_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.sources.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          value={get('tag')}
          onChange={(e) => setParam('tag', e.target.value)}
          aria-label={t('sales.tags.title')}
        >
          <option value="">{t('sales.tags.all')}</option>
          {tags.data?.items.map((x) => (
            <option key={x._id} value={x.name}>
              {x.name}
            </option>
          ))}
        </Select>
        <Select
          value={get('classification')}
          onChange={(e) => setParam('classification', e.target.value)}
          aria-label={t('sales.customers.classification')}
        >
          <option value="">{t('sales.customers.allClassifications')}</option>
          {CUSTOMER_CLASSIFICATIONS.map((s) => (
            <option key={s} value={s}>
              {t(`sales.classifications.${s}`)}
            </option>
          ))}
        </Select>
        {manager && (
          <Select
            value={get('ownerUserId')}
            onChange={(e) => setParam('ownerUserId', e.target.value)}
            aria-label={t('sales.customers.owner')}
          >
            <option value="">{t('sales.customers.allOwners')}</option>
            {team.data?.items.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.fullNameAr}
              </option>
            ))}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('followUpDue') === 'true'}
            onChange={(e) => setParam('followUpDue', e.target.checked)}
          />{' '}
          {t('sales.customers.followUpDueOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('referredFromCs') === 'true'}
            onChange={(e) => setParam('referredFromCs', e.target.checked)}
          />{' '}
          {t('sales.customers.referredFromCs')}
        </label>
        <Select
          value={get('sort') || 'recent'}
          onChange={(e) => setParam('sort', e.target.value)}
          aria-label={t('sales.customers.sort')}
        >
          {['recent', 'name', 'followUp', 'lastContact'].map((s) => (
            <option key={s} value={s}>
              {t(`sales.customers.sorts.${s}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t('actions.search')}
        </Button>
      </form>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('sales.customers.empty')} hint={t('sales.customers.emptyHint')} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table
                head={[
                  ...(manager ? [''] : []),
                  t('common.number'),
                  t('sales.customers.nameAr'),
                  t('sales.customers.city'),
                  t('sales.customers.status'),
                  t('sales.customers.owner'),
                  t('sales.customers.lastContact'),
                  t('sales.customers.nextFollowUp'),
                  t('sales.tags.title'),
                ]}
              >
                {list.data.items.map((c) => (
                  <tr key={c._id} className="hover:bg-slate-50">
                    {manager && (
                      <Td>
                        <input
                          type="checkbox"
                          checked={selected.includes(c._id)}
                          onChange={() => toggle(c._id)}
                          aria-label={c.nameAr}
                        />
                      </Td>
                    )}
                    <Td className="tabular text-xs text-slate-500">{c.number}</Td>
                    <Td className="font-medium">
                      <Link to={`/sales/customers/${c._id}`} className="hover:underline">
                        {c.nameAr}
                      </Link>
                      {c.classification && (
                        <Badge tone="brand">{t(`sales.classifications.${c.classification}`)}</Badge>
                      )}
                    </Td>
                    <Td>{c.city ?? '—'}</Td>
                    <Td>
                      <Badge tone={statusTone[c.status]}>{t(`sales.statuses.${c.status}`)}</Badge>
                    </Td>
                    <Td>{c.ownerName}</Td>
                    <Td className="tabular">{c.lastContactAt ? formatDate(c.lastContactAt) : '—'}</Td>
                    <Td
                      className={`tabular ${c.nextFollowUpAt && new Date(c.nextFollowUpAt) < new Date() ? 'text-red-700' : ''}`}
                    >
                      {c.nextFollowUpAt ? formatDate(c.nextFollowUpAt) : '—'}
                    </Td>
                    <Td className="text-xs text-slate-600">{c.tags.join(' ')}</Td>
                  </tr>
                ))}
              </Table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {list.data.items.map((c) => (
                <li key={c._id} className="flex items-start gap-3 py-3">
                  {manager && (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.includes(c._id)}
                      onChange={() => toggle(c._id)}
                      aria-label={c.nameAr}
                    />
                  )}
                  <Link to={`/sales/customers/${c._id}`} className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.nameAr}</span>
                      <Badge tone={statusTone[c.status]}>{t(`sales.statuses.${c.status}`)}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {c.number} · {c.ownerName}
                      {c.nextFollowUpAt &&
                        ` · ${t('sales.customers.nextFollowUp')}: ${formatDate(c.nextFollowUpAt)}`}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <div className="mt-3 flex items-center justify-between text-sm">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setParams((p) => ({ ...Object.fromEntries(p), page: String(page - 1) }))}
                >
                  {t('common.prev')}
                </Button>
                <span>{t('common.page', { page, pages })}</span>
                <Button
                  variant="secondary"
                  disabled={page >= pages}
                  onClick={() => setParams((p) => ({ ...Object.fromEntries(p), page: String(page + 1) }))}
                >
                  {t('common.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
      <NewCustomerDialog open={newOpen} onClose={() => setNewOpen(false)} />
      {manager && (
        <TransferDialog
          open={transferOpen}
          customerIds={selected}
          onClose={() => setTransferOpen(false)}
          onDone={() => {
            setSelected([]);
            setTransferOpen(false);
            qc.invalidateQueries({ queryKey: ['crm'] });
            qc.invalidateQueries({ queryKey: ['sales'] });
            toast(t('sales.transfer.done'));
          }}
        />
      )}
      {manager && <TagsDialog open={tagsOpen} onClose={() => setTagsOpen(false)} />}
    </>
  );
}

/** نقل العميل من موظف إلى موظف آخر, one or many, with a reason; both reps are notified [SAL §8.1, §14]. */
export function TransferDialog({
  open,
  customerIds,
  onClose,
  onDone,
}: {
  open: boolean;
  customerIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const team = useSalesTeam(open);
  const [toUserId, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () =>
      post('/crm/customers/transfer', { customerIds, toUserId, reason, includeOpportunities: true }),
    onSuccess: () => {
      setTo('');
      setReason('');
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.transfer.title', { count: customerIds.length })}>
      <div className="space-y-3">
        {error && <div className="text-sm text-red-700">{error}</div>}
        <Field label={t('sales.transfer.to')} required>
          <Select value={toUserId} onChange={(e) => setTo(e.target.value)}>
            <option value="">—</option>
            {team.data?.items.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.fullNameAr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sales.transfer.reason')} required hint={t('sales.transfer.hint')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            onClick={() => m.mutate()}
            loading={m.isPending}
            disabled={!toUserId || reason.trim().length < 2}
          >
            {t('sales.transfer.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** الوسوم (Hashtags) [SAL §10.4]: the department manager adds, renames and removes them. */
export function TagsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const tags = useSalesTags();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<TagRow | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tags'] });
    qc.invalidateQueries({ queryKey: ['crm'] });
  };
  const add = useMutation({
    mutationFn: () => post('/tags', { scope: 'sales', name }),
    onSuccess: () => {
      setName('');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const rename = useMutation({
    mutationFn: (x: TagRow) => patch(`/tags/${x._id}`, { name: x.name }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/tags/${id}`),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('sales.tags.manage')}>
      <div className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sales.tags.placeholder')}
            aria-label={t('sales.tags.new')}
          />
          <Button type="submit" loading={add.isPending}>
            {t('actions.create')}
          </Button>
        </form>
        <ul className="divide-y divide-slate-100 text-sm">
          {tags.data?.items.map((x) => (
            <li key={x._id} className="flex items-center justify-between gap-2 py-2">
              {editing?._id === x._id ? (
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  aria-label={t('actions.edit')}
                />
              ) : (
                <span>{x.name}</span>
              )}
              <span className="flex gap-1">
                {editing?._id === x._id ? (
                  <Button
                    variant="secondary"
                    onClick={() => rename.mutate(editing)}
                    loading={rename.isPending}
                  >
                    {t('actions.save')}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setEditing(x)}>
                    {t('actions.edit')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (confirm(t('sales.tags.deleteConfirm'))) remove.mutate(x._id);
                  }}
                >
                  {t('actions.delete')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">{t('sales.tags.hint')}</p>
      </div>
    </Dialog>
  );
}
