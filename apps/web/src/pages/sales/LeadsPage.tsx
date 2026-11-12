import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LEAD_STATES } from '@eayni/shared';
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
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { leadTone, useCrmMeta, useLead, useLeads, useSalesTeam, type LeadRow } from './_data';

/** استقبال وتوزيع العملاء المحتملين [SAL §3, §8.1, §18]: the manager assigns, the rep registers within the configured hours. */
export function LeadsPage() {
  const { t } = useTranslation();
  const { formatDateTime } = usePrefs();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const manager = (user?.permissions.find((p) => p.resource === 'crm.leads')?.scope ?? 'own') !== 'own';
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };
  const view = get('view') || (manager ? 'department' : 'mine');
  const list = useLeads({
    view,
    state: get('state') || undefined,
    open: get('open') === 'true',
    overdue: get('overdue') === 'true',
    limit: 200,
  });
  const meta = useCrmMeta();
  const openId = params.get('lead');
  return (
    <>
      <PageHeader
        title={t('sales.leads.title')}
        subtitle={t('sales.leads.subtitle', { hours: meta.data?.registrationHours ?? 24 })}
        actions={
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {(manager ? (['department', 'mine'] as const) : (['mine'] as const)).map((v) => (
              <button
                key={v}
                onClick={() => setParam('view', v)}
                className={cx(
                  'rounded-md px-2.5 py-1.5',
                  view === v ? 'bg-brand-700 text-white' : 'text-slate-600',
                )}
              >
                {t(`sales.leads.views.${v}`)}
              </button>
            ))}
          </div>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select
          value={get('state')}
          onChange={(e) => setParam('state', e.target.value)}
          aria-label={t('common.status')}
        >
          <option value="">{t('sales.leads.allStates')}</option>
          {LEAD_STATES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.leadStates.${s}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('open') === 'true'}
            onChange={(e) => setParam('open', e.target.checked)}
          />{' '}
          {t('sales.leads.openOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={get('overdue') === 'true'}
            onChange={(e) => setParam('overdue', e.target.checked)}
          />{' '}
          {t('sales.leads.overdueOnly')}
        </label>
      </div>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('sales.leads.empty')} />
        ) : (
          <Table
            head={[
              t('common.number'),
              t('sales.leads.customerName'),
              t('sales.leads.interest'),
              t('sales.leads.referredBy'),
              t('sales.leads.referredAt'),
              t('sales.leads.assignee'),
              t('common.status'),
            ]}
          >
            {list.data.items.map((l) => (
              <tr
                key={l._id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => setParam('lead', l._id)}
              >
                <Td className="tabular text-xs text-slate-500">{l.number}</Td>
                <Td className="font-medium">
                  {l.customerName}
                  {l.overdue && <Badge tone="red">{t('sales.leads.overdue')}</Badge>}
                </Td>
                <Td className="max-w-xs truncate">{l.interest}</Td>
                <Td>{l.referredByName}</Td>
                <Td className="tabular">{formatDateTime(l.referredAt)}</Td>
                <Td>{l.assigneeName ?? <Badge tone="amber">{t('sales.leads.unassigned')}</Badge>}</Td>
                <Td>
                  <Badge tone={leadTone[l.state]}>{t(`sales.leadStates.${l.state}`)}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <LeadDialog id={openId} onClose={() => setParam('lead', '')} />
    </>
  );
}

/** One lead: assign (manager), change state with an outcome, convert into a customer and/or opportunity keeping the link. */
export function LeadDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { formatDateTime } = usePrefs();
  const q = useLead(id);
  const team = useSalesTeam(!!id);
  const [assignee, setAssignee] = useState('');
  const [state, setState] = useState('');
  const [outcome, setOutcome] = useState('');
  const [oppTitle, setOppTitle] = useState('');
  const [withOpp, setWithOpp] = useState(true);
  const [error, setError] = useState<string>();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm'] });
    qc.invalidateQueries({ queryKey: ['sales'] });
  };
  const assign = useMutation({
    mutationFn: () => post(`/crm/leads/${id}/assign`, { assigneeUserId: assignee }),
    onSuccess: () => {
      refresh();
      setAssignee('');
      toast(t('sales.leads.assigned'));
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const setLeadState = useMutation({
    mutationFn: () => post(`/crm/leads/${id}/state`, { state, outcome: outcome || undefined }),
    onSuccess: () => {
      refresh();
      setState('');
      setOutcome('');
      toast(t('actions.save'));
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const convert = useMutation({
    mutationFn: () =>
      post<{ customerId: string }>(`/crm/leads/${id}/convert`, {
        createOpportunity: withOpp,
        opportunityTitle: oppTitle || undefined,
      }),
    onSuccess: () => {
      refresh();
      toast(t('sales.leads.converted'));
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (!id) return null;
  const l = q.data as
    | (LeadRow & {
        events: {
          _id: string;
          type: string;
          from?: string;
          to?: string;
          byEmail?: string;
          note?: string;
          at: string;
        }[];
        canManage: boolean;
      })
    | undefined;
  const open = l && !['converted', 'not_interested', 'closed'].includes(l.state);
  return (
    <Dialog open onClose={onClose} title={l ? `${l.number} — ${l.customerName}` : t('sales.leads.title')}>
      {error && <Alert kind="error">{error}</Alert>}
      {q.isLoading && <Spinner />}
      {q.isError && <QueryError error={q.error} onRetry={() => q.refetch()} />}
      {l && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={leadTone[l.state]}>{t(`sales.leadStates.${l.state}`)}</Badge>
            {l.overdue && <Badge tone="red">{t('sales.leads.overdue')}</Badge>}
            <span className="text-slate-500">
              {t('sales.leads.referredBy')}: {l.referredByName} · {formatDateTime(l.referredAt)}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">{t('sales.leads.interest')}</dt>
              <dd>{l.interest}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('sales.leads.contact')}</dt>
              <dd dir="ltr" className="text-start">
                {[l.contactName, l.phone, l.email].filter(Boolean).join(' · ') || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('sales.leads.channel')}</dt>
              <dd>{l.channel ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t('sales.leads.deadline')}</dt>
              <dd className={cx('tabular', l.overdue && 'text-red-700')}>
                {l.registeredAt
                  ? t('sales.leads.registeredAt', { at: formatDateTime(l.registeredAt) })
                  : formatDateTime(l.registrationDeadline)}
              </dd>
            </div>
            {l.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">{t('sales.customers.notes')}</dt>
                <dd className="whitespace-pre-wrap">{l.notes}</dd>
              </div>
            )}
            {l.customerId && (
              <div className="sm:col-span-2">
                <Link
                  to={`/sales/customers/${l.customerId}`}
                  className="text-brand-700 hover:underline"
                  onClick={onClose}
                >
                  {t('sales.leads.openCustomer')}
                </Link>
              </div>
            )}
          </dl>
          {l.canManage && open && (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 font-semibold">{t('sales.leads.assign')}</div>
              <div className="flex gap-2">
                <Select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  aria-label={t('sales.leads.assignee')}
                >
                  <option value="">—</option>
                  {team.data?.items.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.fullNameAr}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  disabled={!assignee}
                  loading={assign.isPending}
                  onClick={() => assign.mutate()}
                >
                  {t('sales.leads.assignConfirm')}
                </Button>
              </div>
            </div>
          )}
          {open && (l.assigneeUserId || l.canManage) && (
            <>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 font-semibold">{t('sales.leads.convert')}</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withOpp} onChange={(e) => setWithOpp(e.target.checked)} />{' '}
                  {t('sales.leads.withOpportunity')}
                </label>
                {withOpp && (
                  <Field label={t('sales.opportunities.title')} hint={t('sales.leads.oppTitleHint')}>
                    <Input value={oppTitle} onChange={(e) => setOppTitle(e.target.value)} />
                  </Field>
                )}
                <div className="mt-2 flex justify-end">
                  <Button loading={convert.isPending} onClick={() => convert.mutate()}>
                    {t('sales.leads.convertConfirm')}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 font-semibold">{t('sales.leads.changeState')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    aria-label={t('common.status')}
                  >
                    <option value="">—</option>
                    {LEAD_STATES.filter((s) => s !== 'converted' && s !== l.state).map((s) => (
                      <option key={s} value={s}>
                        {t(`sales.leadStates.${s}`)}
                      </option>
                    ))}
                  </Select>
                  <Textarea
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    rows={1}
                    placeholder={t('sales.leads.outcome')}
                    aria-label={t('sales.leads.outcome')}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="secondary"
                    disabled={!state}
                    loading={setLeadState.isPending}
                    onClick={() => setLeadState.mutate()}
                  >
                    {t('actions.save')}
                  </Button>
                </div>
              </div>
            </>
          )}
          <div>
            <div className="mb-1 font-semibold">{t('sales.leads.history')}</div>
            <ol className="space-y-1 text-xs">
              {l.events.map((e) => (
                <li key={e._id} className="flex justify-between gap-2 rounded border border-slate-100 p-1.5">
                  <span>
                    {t(`sales.leads.events.${e.type}`)}
                    {e.type === 'state_changed' &&
                      `: ${e.from ? t(`sales.leadStates.${e.from}`) : '—'} → ${t(`sales.leadStates.${e.to}`)}`}
                    {e.note && <span className="text-slate-500"> ({e.note})</span>}
                  </span>
                  <span className="shrink-0 text-slate-500 tabular">
                    {e.byEmail} · {formatDateTime(e.at)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Dialog>
  );
}
