import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, Paperclip } from 'lucide-react';
import { DISCUSSION_STATES, DISCUSSION_STATE_AR, type DiscussionState } from '@eayni/shared';
import { get, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { recordLink } from '@/lib/links';
import { useDepartments } from '@/lib/lookups';
import { usePrefs } from '@/lib/preferences';
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
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
import { discussionTone, useDiscussion, useDiscussions, type DiscussionRow } from './_data';

/** النقاشات بين الأقسام [SAL §10.3]: my threads and my department's inbox. */
export function DiscussionsPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'department' ? 'department' : 'mine';
  const state = params.get('state') ?? '';
  const open = params.get('open') !== 'false';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const list = useDiscussions({ view, state: state || undefined, open: !state && open, limit: 100 });
  return (
    <>
      <PageHeader title={t('discussions.title')} subtitle={t('discussions.subtitle')} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1" role="tablist">
          {(['mine', 'department'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => set('view', v === 'mine' ? '' : v)}
              className={cx(
                'min-h-9 rounded-md px-3 text-sm',
                view === v ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              {t(`discussions.views.${v}`)}
            </button>
          ))}
        </div>
        <Select
          className="w-48"
          value={state}
          onChange={(e) => set('state', e.target.value)}
          aria-label={t('common.status')}
        >
          <option value="">{t('discussions.allStates')}</option>
          {DISCUSSION_STATES.map((s) => (
            <option key={s} value={s}>
              {DISCUSSION_STATE_AR[s]}
            </option>
          ))}
        </Select>
        {!state && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={open}
              onChange={(e) => set('open', e.target.checked ? '' : 'false')}
            />
            {t('discussions.openOnly')}
          </label>
        )}
      </div>
      <Card>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('discussions.empty')} hint={t('discussions.emptyHint')} />
        ) : (
          <DiscussionList items={list.data.items} formatDate={formatDate} />
        )}
      </Card>
    </>
  );
}

export function DiscussionList({
  items,
  formatDate,
}: {
  items: DiscussionRow[];
  formatDate: (d: string, o?: Intl.DateTimeFormatOptions) => string;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((d) => (
        <li key={d._id} className="py-3">
          <Link to={`/discussions/${d._id}`} className="block rounded-lg px-1 hover:bg-slate-50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-900">
                <span className="me-2 text-xs text-slate-500 tabular">{d.number}</span>
                {d.title}
              </span>
              <Badge tone={discussionTone[d.state]}>{DISCUSSION_STATE_AR[d.state]}</Badge>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {t('discussions.fromTo', {
                from: d.openedByDepartmentName ?? d.openedByName ?? '—',
                to: d.targetDepartmentName ?? '—',
              })}
              {d.recordLabel ? ` · ${d.recordLabel}` : ''} ·{' '}
              <span className="tabular">
                {formatDate(d.lastActivityAt, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One discussion: the thread, the reply box with attachments, the state actions of my side, participants. */
export function DiscussionPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useDiscussion(id);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [uploaderKey, setUploaderKey] = useState(0);
  const [stateTo, setStateTo] = useState<DiscussionState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['discussion', id] });
    qc.invalidateQueries({ queryKey: ['discussions'] });
  };
  const reply = useMutation({
    mutationFn: () =>
      post(`/discussions/${id}/messages`, { body, attachmentIds: files.map((f) => f.attachmentId) }),
    onSuccess: () => {
      setBody('');
      setFiles([]);
      setUploaderKey((k) => k + 1);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const d = q.data;
  const href = d ? recordLink(d.recordType, d.recordId) : undefined;
  return (
    <>
      <PageHeader
        title={d ? d.title : t('discussions.title')}
        subtitle={
          d
            ? `${d.number} · ${t('discussions.fromTo', { from: d.openedByDepartmentName ?? '—', to: d.targetDepartmentName ?? '—' })}`
            : undefined
        }
        actions={
          <Button variant="secondary" onClick={() => nav('/discussions')}>
            {t('actions.back')}
          </Button>
        }
      />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || !d ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <Card>
              <ol className="space-y-3">
                {d.entries.map((e) => (
                  <li
                    key={e._id}
                    className={cx(
                      'rounded-lg p-3 text-sm',
                      e.kind === 'state' || e.kind === 'participants'
                        ? 'bg-slate-50 text-slate-600'
                        : 'border border-slate-200',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        <strong className="text-slate-800">{e.authorName}</strong>
                        {e.authorDepartmentName ? ` · ${e.authorDepartmentName}` : ''}
                      </span>
                      <span className="tabular">
                        {formatDate(e.at, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                    {e.kind === 'state' && (
                      <div className="mt-1">
                        {t('discussions.stateChanged', {
                          from: e.fromState ? DISCUSSION_STATE_AR[e.fromState] : '—',
                          to: e.toState ? DISCUSSION_STATE_AR[e.toState] : '—',
                        })}
                        {e.auto && <span className="ms-1 text-xs">({t('discussions.auto')})</span>}
                      </div>
                    )}
                    {e.kind === 'participants' && (
                      <div className="mt-1">{t('discussions.participantsAdded')}</div>
                    )}
                    {e.kind === 'opened' && (
                      <div className="mt-1 text-xs font-medium text-brand-700">{t('discussions.opened')}</div>
                    )}
                    {e.body && <p className="mt-1 whitespace-pre-wrap text-slate-800">{e.body}</p>}
                    {e.attachmentIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {e.attachmentIds.map((a, i) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => downloadAttachment(a)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:bg-slate-50"
                          >
                            <Paperclip className="size-3" aria-hidden />{' '}
                            {t('discussions.attachment', { n: i + 1 })}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
            {d.canReply ? (
              <Card title={t('discussions.reply')}>
                <div className="space-y-2">
                  <Textarea
                    rows={3}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={t('discussions.replyPlaceholder')}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FileUploader
                      key={uploaderKey}
                      label={t('discussions.attach')}
                      onUploaded={(a) => setFiles((s) => [...s, a])}
                    />
                    <Button disabled={!body.trim()} loading={reply.isPending} onClick={() => reply.mutate()}>
                      {t('actions.send')}
                    </Button>
                  </div>
                  {files.length > 0 && (
                    <p className="text-xs text-slate-500">
                      {files.map((f) => f.fileName).join(t('common.listSeparator'))}
                    </p>
                  )}
                </div>
              </Card>
            ) : (
              <Alert kind="info">
                {d.state === 'closed' ? t('discussions.closedReadOnly') : t('discussions.viewOnly')}
              </Alert>
            )}
          </div>
          <div className="space-y-3">
            <Card title={t('discussions.status')}>
              <div className="space-y-2 text-sm">
                <Badge tone={discussionTone[d.state]}>{DISCUSSION_STATE_AR[d.state]}</Badge>
                <div className="flex flex-wrap gap-2 pt-2">
                  {d.allowedStates.map((s) => (
                    <Button
                      key={s}
                      variant={s === 'closed' ? 'secondary' : 'secondary'}
                      className="min-h-9 px-3 py-1"
                      onClick={() => setStateTo(s)}
                    >
                      {t(`discussions.actions.${s}`)}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
            <Card title={t('discussions.details')}>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">{t('discussions.record')}</dt>
                  <dd>
                    {href ? (
                      <Link to={href} className="text-brand-700 hover:underline">
                        {d.recordLabel ?? d.recordId}
                      </Link>
                    ) : (
                      (d.recordLabel ?? d.recordId)
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t('discussions.openedBy')}</dt>
                  <dd>{d.openedByName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t('discussions.targetDepartment')}</dt>
                  <dd>{d.targetDepartmentName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t('discussions.participants')}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {d.participants.length
                      ? d.participants.map((p) => <Badge key={p.userId}>{p.name}</Badge>)
                      : '—'}
                  </dd>
                </div>
              </dl>
              {d.canAddParticipants && (
                <Button variant="ghost" className="mt-2 min-h-9 px-2 py-1" onClick={() => setAddOpen(true)}>
                  {t('discussions.addParticipants')}
                </Button>
              )}
            </Card>
          </div>
        </div>
      )}
      {stateTo && d && (
        <StateDialog id={id} to={stateTo} from={d.state} onClose={() => setStateTo(null)} onDone={refresh} />
      )}
      {addOpen && <AddParticipantsDialog id={id} onClose={() => setAddOpen(false)} onDone={refresh} />}
    </>
  );
}

function StateDialog({
  id,
  to,
  from,
  onClose,
  onDone,
}: {
  id: string;
  to: DiscussionState;
  from: DiscussionState;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const needsNote =
    to === 'resolved' ||
    (from === 'resolved' && to === 'in_progress') ||
    (to === 'closed' && from !== 'resolved');
  const go = useMutation({
    mutationFn: () => post(`/discussions/${id}/state`, { state: to, note: note || undefined }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={t(`discussions.actions.${to}`)}>
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Field
          label={to === 'resolved' ? t('discussions.actionTaken') : t('discussions.note')}
          required={needsNote}
        >
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button disabled={needsNote && !note.trim()} loading={go.isPending} onClick={() => go.mutate()}>
            {t('actions.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface PersonHit {
  userId: string;
  fullNameAr: string;
}
function PeoplePicker({ value, onChange }: { value: PersonHit[]; onChange: (v: PersonHit[]) => void }) {
  const { t } = useTranslation();
  const [pq, setPq] = useState('');
  const people = useQuery({
    queryKey: ['calendar', 'people', pq],
    queryFn: () => get<{ items: PersonHit[] }>(`/calendar/people?q=${encodeURIComponent(pq)}`),
    enabled: pq.trim().length >= 2,
  });
  return (
    <div className="space-y-2">
      <Input value={pq} onChange={(e) => setPq(e.target.value)} placeholder={t('actions.search')} />
      {people.data?.items.length ? (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {people.data.items
            .filter((p) => !value.some((x) => x.userId === p.userId))
            .map((p) => (
              <button
                key={p.userId}
                type="button"
                className="block w-full rounded-md border border-slate-200 px-2 py-1 text-start text-sm hover:bg-slate-50"
                onClick={() => onChange([...value, p])}
              >
                {p.fullNameAr}
              </button>
            ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {value.map((p) => (
          <button
            key={p.userId}
            type="button"
            onClick={() => onChange(value.filter((x) => x.userId !== p.userId))}
            className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800"
          >
            {p.fullNameAr} ×
          </button>
        ))}
      </div>
    </div>
  );
}

function AddParticipantsDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [error, setError] = useState<string>();
  const go = useMutation({
    mutationFn: () => post(`/discussions/${id}/participants`, { userIds: people.map((p) => p.userId) }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={t('discussions.addParticipants')}>
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <PeoplePicker value={people} onChange={setPeople} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button disabled={!people.length} loading={go.isPending} onClick={() => go.mutate()}>
            {t('actions.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The discussion panel on a record (customer, request…) [SAL §10.3 «فتح محادثة مرتبطة بالعميل أو الطلب»]: its threads
 * and the «فتح نقاش مع قسم» dialog.
 */
export function DiscussionPanel({ recordType, recordId }: { recordType: string; recordId: string }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const [open, setOpen] = useState(false);
  const list = useDiscussions({ recordType, recordId, limit: 50 }, !!recordId);
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <MessagesSquare className="size-4 text-slate-500" aria-hidden /> {t('discussions.panelTitle')}
        </span>
      }
      actions={
        <Button variant="secondary" className="min-h-9 px-3 py-1" onClick={() => setOpen(true)}>
          {t('discussions.open')}
        </Button>
      }
    >
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <Spinner />
      ) : !list.data?.items.length ? (
        <p className="text-sm text-slate-500">{t('discussions.panelEmpty')}</p>
      ) : (
        <DiscussionList items={list.data.items} formatDate={formatDate} />
      )}
      {open && (
        <OpenDiscussionDialog recordType={recordType} recordId={recordId} onClose={() => setOpen(false)} />
      )}
    </Card>
  );
}

function OpenDiscussionDialog({
  recordType,
  recordId,
  onClose,
}: {
  recordType: string;
  recordId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const depts = useDepartments(false);
  const [f, setF] = useState({ title: '', details: '', targetDepartmentId: '' });
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [files, setFiles] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [error, setError] = useState<string>();
  const go = useMutation({
    mutationFn: () =>
      post<{ _id: string }>('/discussions', {
        recordType,
        recordId,
        ...f,
        participantUserIds: people.map((p) => p.userId),
        attachmentIds: files.map((x) => x.attachmentId),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['discussions'] });
      onClose();
      nav(`/discussions/${r._id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={t('discussions.open')}>
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('discussions.targetDepartment')} required hint={t('discussions.targetHint')}>
          <Select
            value={f.targetDepartmentId}
            onChange={(e) => setF({ ...f, targetDepartmentId: e.target.value })}
          >
            <option value="">—</option>
            {depts.data?.items.map((d) => (
              <option key={d._id} value={d._id}>
                {d.nameAr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('discussions.subject')} required>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t('discussions.problemDetails')} required>
          <Textarea rows={4} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
        </Field>
        <Field label={t('discussions.participants')} hint={t('discussions.participantsHint')}>
          <PeoplePicker value={people} onChange={setPeople} />
        </Field>
        <div className="space-y-1">
          <FileUploader label={t('discussions.attach')} onUploaded={(a) => setFiles((s) => [...s, a])} />
          {files.length > 0 && (
            <p className="text-xs text-slate-500">
              {files.map((x) => x.fileName).join(t('common.listSeparator'))}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            disabled={!f.targetDepartmentId || f.title.trim().length < 3 || f.details.trim().length < 3}
            loading={go.isPending}
            onClick={() => go.mutate()}
          >
            {t('discussions.send')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
