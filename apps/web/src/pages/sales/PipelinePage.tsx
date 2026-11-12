import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGES,
  SALES_SERVICE_TYPES,
  type OpportunityStage,
} from '@eayni/shared';
import { patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isoToLocalInput, localInputToIso } from '@/lib/dates';
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
import { sar } from '../hr/_data';
import {
  stageTone,
  useCrmMeta,
  useOpportunities,
  useOpportunity,
  usePipeline,
  useSalesTags,
  useSalesTeam,
  type OpportunityRow,
} from './_data';

/** إدارة الفرص البيعية (Sales Pipeline) [SAL §4.2]: Kanban by stage or a table; filters; expected value, owner, last contact, next follow-up. */
export function PipelinePage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const manager =
    (user?.permissions.find((p) => p.resource === 'sales.opportunities')?.scope ?? 'own') !== 'own';
  const get = (k: string) => params.get(k) ?? '';
  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };
  const view = get('view') === 'table' ? 'table' : 'kanban';
  const list = useOpportunities({
    stage: get('stage') || undefined,
    open: get('open') === 'true',
    serviceType: get('serviceType') || undefined,
    ownerUserId: get('ownerUserId') || undefined,
    tag: get('tag') || undefined,
    followUpDue: get('followUpDue') === 'true',
    q: get('q') || undefined,
    limit: 200,
  });
  const summary = usePipeline(get('ownerUserId') || undefined);
  const team = useSalesTeam(manager);
  const tags = useSalesTags();
  const openId = params.get('opportunity');
  const items = list.data?.items ?? [];
  const byStage = new Map<OpportunityStage, OpportunityRow[]>(OPPORTUNITY_STAGES.map((s) => [s, []]));
  for (const o of items) byStage.get(o.stage)!.push(o);
  const card = (o: OpportunityRow) => {
    const late =
      o.nextFollowUpAt &&
      new Date(o.nextFollowUpAt) < new Date() &&
      (OPEN_OPPORTUNITY_STAGES as readonly string[]).includes(o.stage);
    return (
      <button
        key={o._id}
        type="button"
        onClick={() => setParam('opportunity', o._id)}
        className={cx(
          'block w-full rounded-lg border bg-white p-2 text-start text-sm shadow-sm hover:bg-slate-50',
          late ? 'border-red-300' : 'border-slate-200',
        )}
      >
        <div className="font-medium">{o.title}</div>
        <div className="mt-0.5 truncate text-xs text-slate-500">{o.customerName}</div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="tabular">{sar(o.expectedValueHalalas)}</span>
          <span className="text-slate-500">{o.ownerName}</span>
        </div>
        {o.nextFollowUpAt && (
          <div className={cx('mt-1 text-xs tabular', late ? 'text-red-700' : 'text-slate-500')}>
            {t('sales.opportunities.nextFollowUp')}: {formatDate(o.nextFollowUpAt)}
          </div>
        )}
      </button>
    );
  };
  return (
    <>
      <PageHeader
        title={t('sales.pipeline.title')}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {(['kanban', 'table'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setParam('view', v === 'kanban' ? '' : v)}
                  className={cx(
                    'rounded-md px-2.5 py-1.5',
                    view === v ? 'bg-brand-700 text-white' : 'text-slate-600',
                  )}
                >
                  {t(`sales.pipeline.views.${v}`)}
                </button>
              ))}
            </div>
            <Button onClick={() => setParam('opportunity', 'new')}>{t('sales.opportunities.new')}</Button>
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input
          value={get('q')}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={t('actions.search')}
          aria-label={t('actions.search')}
        />
        <Select
          value={get('stage')}
          onChange={(e) => setParam('stage', e.target.value)}
          aria-label={t('sales.opportunities.stage')}
        >
          <option value="">{t('sales.pipeline.allStages')}</option>
          {OPPORTUNITY_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.stages.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          value={get('serviceType')}
          onChange={(e) => setParam('serviceType', e.target.value)}
          aria-label={t('sales.opportunities.serviceType')}
        >
          <option value="">{t('sales.services.all')}</option>
          {SALES_SERVICE_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`sales.services.${s}`)}
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
          {t('sales.pipeline.followUpDueOnly')}
        </label>
      </div>
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <Spinner />
      ) : view === 'kanban' ? (
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          {OPPORTUNITY_STAGES.map((s) => {
            const sum = summary.data?.stages[s];
            return (
              <div key={s} className="rounded-xl bg-slate-100 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-slate-600">
                  <span>{t(`sales.stages.${s}`)}</span>
                  <span className="tabular">{byStage.get(s)!.length}</span>
                </div>
                {sum && sum.valueHalalas > 0 && (
                  <div className="mb-2 px-1 text-xs text-slate-500 tabular">{sar(sum.valueHalalas)}</div>
                )}
                <div className="space-y-2">{byStage.get(s)!.map(card)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          {!items.length ? (
            <EmptyState title={t('sales.opportunities.empty')} />
          ) : (
            <Table
              head={[
                t('common.number'),
                t('sales.opportunities.title'),
                t('sales.customers.nameAr'),
                t('sales.opportunities.serviceType'),
                t('sales.opportunities.expectedValue'),
                t('sales.customers.owner'),
                t('sales.opportunities.nextFollowUp'),
                t('sales.opportunities.stage'),
              ]}
            >
              {items.map((o) => (
                <tr
                  key={o._id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setParam('opportunity', o._id)}
                >
                  <Td className="tabular text-xs text-slate-500">{o.number}</Td>
                  <Td className="font-medium">{o.title}</Td>
                  <Td>{o.customerName}</Td>
                  <Td>{o.serviceType ? t(`sales.services.${o.serviceType}`) : '—'}</Td>
                  <Td className="tabular">{sar(o.expectedValueHalalas)}</Td>
                  <Td>{o.ownerName}</Td>
                  <Td className="tabular">{o.nextFollowUpAt ? formatDate(o.nextFollowUpAt) : '—'}</Td>
                  <Td>
                    <Badge tone={stageTone[o.stage]}>{t(`sales.stages.${o.stage}`)}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      <OpportunityDialog id={openId} onClose={() => setParam('opportunity', '')} />
    </>
  );
}

/** One opportunity: fields, stage change (a lost deal needs a reason), reassignment by the manager, history. `id === 'new'` creates. */
export function OpportunityDialog({
  id,
  customerId,
  onClose,
}: {
  id: string | null;
  customerId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { formatDateTime } = usePrefs();
  const { user } = useAuth();
  const isNew = id === 'new';
  const q = useOpportunity(isNew ? null : id);
  const meta = useCrmMeta();
  const manager =
    (user?.permissions.find((p) => p.resource === 'sales.opportunities')?.scope ?? 'own') !== 'own';
  const team = useSalesTeam(!!id && manager);
  const [stage, setStage] = useState<string>('');
  const [lostReason, setLostReason] = useState('');
  const [lostNote, setLostNote] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [form, setForm] = useState({ title: '', serviceType: '', expectedValue: '', nextFollowUp: '' });
  useEffect(() => {
    if (!id) return;
    setStage('');
    setLostReason('');
    setLostNote('');
    setReassignTo('');
    setReason('');
    setError(undefined);
    if (isNew) setForm({ title: '', serviceType: '', expectedValue: '', nextFollowUp: '' });
  }, [id, isNew]);
  useEffect(() => {
    if (q.data)
      setForm({
        title: q.data.title,
        serviceType: q.data.serviceType ?? '',
        expectedValue: q.data.expectedValueHalalas != null ? String(q.data.expectedValueHalalas / 100) : '',
        nextFollowUp: isoToLocalInput(q.data.nextFollowUpAt),
      });
  }, [q.data]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sales'] });
    qc.invalidateQueries({ queryKey: ['crm'] });
  };
  const body = () => ({
    title: form.title,
    serviceType: form.serviceType || (isNew ? undefined : null),
    expectedValueHalalas: form.expectedValue
      ? Math.round(Number(form.expectedValue) * 100)
      : isNew
        ? undefined
        : null,
    nextFollowUpAt: form.nextFollowUp ? localInputToIso(form.nextFollowUp) : isNew ? undefined : null,
  });
  const save = useMutation({
    mutationFn: () =>
      isNew
        ? post('/sales/opportunities', { customerId, ...body(), attachmentIds: [], tags: [] })
        : patch(`/sales/opportunities/${id}`, body()),
    onSuccess: () => {
      refresh();
      toast(t('actions.save'));
      if (isNew) onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const move = useMutation({
    mutationFn: () =>
      post(`/sales/opportunities/${id}/stage`, {
        stage,
        lostReason: stage === 'lost' ? lostReason : undefined,
        lostNote: stage === 'lost' ? lostNote || undefined : undefined,
      }),
    onSuccess: () => {
      refresh();
      setStage('');
      toast(t('sales.opportunities.stageChanged'));
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const reassign = useMutation({
    mutationFn: () =>
      post('/sales/opportunities/reassign', { opportunityIds: [id], toUserId: reassignTo, reason }),
    onSuccess: () => {
      refresh();
      setReassignTo('');
      setReason('');
      toast(t('sales.transfer.done'));
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (!id) return null;
  const o = q.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t('sales.opportunities.new') : `${o?.number ?? ''} — ${o?.title ?? ''}`}
    >
      {error && <Alert kind="error">{error}</Alert>}
      {!isNew && q.isLoading && <Spinner />}
      {!isNew && q.isError && <QueryError error={q.error} onRetry={() => q.refetch()} />}
      {(isNew || o) && (
        <div className="space-y-4">
          {o && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={stageTone[o.stage]}>{t(`sales.stages.${o.stage}`)}</Badge>
              <Link
                to={`/sales/customers/${o.customerId}`}
                className="text-brand-700 hover:underline"
                onClick={onClose}
              >
                {o.customerName}
              </Link>
              <span className="text-slate-500">· {o.ownerName}</span>
              {o.lostReason && (
                <span className="text-red-700">
                  {o.lostReason}
                  {o.lostNote ? ` — ${o.lostNote}` : ''}
                </span>
              )}
            </div>
          )}
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="col-span-2">
              <Field label={t('sales.opportunities.title')} required>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  minLength={2}
                />
              </Field>
            </div>
            <Field label={t('sales.opportunities.serviceType')}>
              <Select
                value={form.serviceType}
                onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
              >
                <option value="">—</option>
                {SALES_SERVICE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sales.services.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('sales.opportunities.expectedValue')}>
              <Input
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={form.expectedValue}
                onChange={(e) => setForm({ ...form, expectedValue: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t('sales.opportunities.nextFollowUp')}>
                <Input
                  type="datetime-local"
                  dir="ltr"
                  value={form.nextFollowUp}
                  onChange={(e) => setForm({ ...form, nextFollowUp: e.target.value })}
                />
              </Field>
            </div>
            <div className="col-span-2 flex justify-end">
              <Button type="submit" loading={save.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          </form>
          {o && (
            <>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold">{t('sales.opportunities.changeStage')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                    aria-label={t('sales.opportunities.stage')}
                  >
                    <option value="">—</option>
                    {OPPORTUNITY_STAGES.filter((s) => s !== o.stage).map((s) => (
                      <option key={s} value={s}>
                        {t(`sales.stages.${s}`)}
                      </option>
                    ))}
                  </Select>
                  {stage === 'lost' && (
                    <Select
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value)}
                      aria-label={t('sales.opportunities.lostReason')}
                    >
                      <option value="">{t('sales.opportunities.lostReason')}</option>
                      {meta.data?.lossReasons.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  )}
                  {stage === 'lost' && (
                    <div className="col-span-2">
                      <Textarea
                        value={lostNote}
                        onChange={(e) => setLostNote(e.target.value)}
                        rows={2}
                        placeholder={t('sales.opportunities.lostNote')}
                        aria-label={t('sales.opportunities.lostNote')}
                      />
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-500">{t('sales.opportunities.lostReasonHint')}</span>
                  <Button
                    variant="secondary"
                    disabled={!stage || (stage === 'lost' && !lostReason)}
                    loading={move.isPending}
                    onClick={() => move.mutate()}
                  >
                    {t('sales.opportunities.applyStage')}
                  </Button>
                </div>
              </div>
              {o.canManage && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 text-sm font-semibold">{t('sales.opportunities.reassign')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={reassignTo}
                      onChange={(e) => setReassignTo(e.target.value)}
                      aria-label={t('sales.transfer.to')}
                    >
                      <option value="">—</option>
                      {team.data?.items
                        .filter((p) => p.userId !== o.ownerUserId)
                        .map((p) => (
                          <option key={p.userId} value={p.userId}>
                            {p.fullNameAr}
                          </option>
                        ))}
                    </Select>
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t('sales.transfer.reason')}
                      aria-label={t('sales.transfer.reason')}
                    />
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="secondary"
                      disabled={!reassignTo || reason.trim().length < 2}
                      loading={reassign.isPending}
                      onClick={() => reassign.mutate()}
                    >
                      {t('sales.transfer.confirm')}
                    </Button>
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1 text-sm font-semibold">{t('sales.opportunities.history')}</div>
                <ol className="space-y-1 text-xs">
                  {o.events.map((e) => (
                    <li
                      key={e._id}
                      className="flex justify-between gap-2 rounded border border-slate-100 p-1.5"
                    >
                      <span>
                        {t(`sales.opportunities.events.${e.type}`)}
                        {e.type === 'stage_changed' &&
                          `: ${e.from ? t(`sales.stages.${e.from}`) : '—'} → ${t(`sales.stages.${e.to}`)}`}
                        {e.type === 'reassigned' && `: ${e.fromUserName ?? ''} → ${e.toUserName ?? ''}`}
                        {e.note && <span className="text-slate-500"> ({e.note})</span>}
                      </span>
                      <span className="shrink-0 text-slate-500 tabular">
                        {e.byUserName} · {formatDateTime(e.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
