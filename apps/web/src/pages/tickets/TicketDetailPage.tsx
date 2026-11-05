import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip, Star } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { errorMessage } from '@/lib/errors';
import { Alert, Badge, Button, Card, Dialog, Field, PageHeader, QueryError, Select, Spinner, Textarea, cx } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { FileUploader, downloadAttachment } from '@/shared/files/FileUploader';
import { useTeam } from '../tasks/_data';
import { priorityLabel, ticketTone, type TicketDetail } from './_data';

type Mode = 'assign' | 'request_info' | 'provide_info' | 'resolve' | 'close' | 'reopen' | 'stall' | null;

/** One ticket [EP §9.3–9.5]: header, department fields, attachments, replies log, comments, and the actions open to me. */
export function TicketDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => get<TicketDetail>(`/tickets/${id}`) });
  const comments = useQuery({
    queryKey: ['comments', 'ticket', id],
    queryFn: () => get<{ items: { _id: string; body: string; authorId: string; createdAt: string }[] }>(`/comments?recordType=ticket&recordId=${id}`),
  });
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState('');
  const [score, setScore] = useState(0);
  const [assignee, setAssignee] = useState('');
  const [atts, setAtts] = useState<{ attachmentId: string; fileName: string }[]>([]);
  const [comment, setComment] = useState('');
  const canAssign = q.data?.actions.includes('assign');
  const team = useTeam(!!canAssign);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['comments', 'ticket', id] });
  };
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => post(`/tickets/${id}/transition`, body),
    onSuccess: () => {
      refresh();
      setMode(null);
      setText('');
      setScore(0);
      setAtts([]);
      toast(t('actions.save'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const addComment = useMutation({
    mutationFn: () => post('/comments', { recordType: 'ticket', recordId: id, body: comment }),
    onSuccess: () => {
      setComment('');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Alert kind="error">{t('common.error')}</Alert>;
  const r = q.data;
  const has = (a: string) => r.actions.includes(a);
  const members = (team.data?.items ?? []).filter((m) => m.userId && m.departmentId === r.departmentId);

  const modal = (title: string, body: React.ReactNode, submit: () => void, disabled = false) => (
    <Dialog open={!!mode} onClose={() => setMode(null)} title={title}>
      <div className="space-y-3">
        {body}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setMode(null)}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={disabled} loading={act.isPending}>
            {t('actions.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title={`${r.number} · ${r.subject}`}
        subtitle={`${r.requester?.fullNameAr ?? r.requesterName ?? ''} ${r.requester?.employeeNumber ? `· ${r.requester.employeeNumber}` : ''} · ${formatDateTime(r.createdAt)}`}
        actions={
          <>
            <Badge tone={ticketTone[r.state]}>{t(`tickets.states.${r.state}`)}</Badge>
            <Link to={r.requesterUserId === user?.id ? '/me/tickets' : '/tickets'} className="text-sm text-brand-700 hover:underline">
              {t('actions.back')}
            </Link>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <Card title={t('tickets.details')}>
            <dl className="grid grid-cols-[150px_1fr] gap-x-2 gap-y-1.5 text-sm">
              <dt className="text-slate-500">{t('tickets.department')}</dt>
              <dd>{r.department?.nameAr ?? r.departmentCode}</dd>
              <dt className="text-slate-500">{t('tickets.type')}</dt>
              <dd>{t(`tickets.types.${r.type}`)}</dd>
              <dt className="text-slate-500">{t('tasks.priority')}</dt>
              <dd>{priorityLabel(t, r.priority, r.departmentConfig)}</dd>
              {r.departmentConfig.fields.map((f) => (
                <FieldRow key={f.key} label={f.labelAr} value={f.type === 'select' ? f.options?.find((o) => o.value === String(r.fields[f.key]))?.labelAr : r.fields[f.key]} />
              ))}
              <dt className="text-slate-500">{t('tickets.assignee')}</dt>
              <dd>{r.assigneeName ?? t('tickets.unassigned')}</dd>
              {r.processingStartedAt && (
                <>
                  <dt className="text-slate-500">{t('tickets.processingStartedAt')}</dt>
                  <dd className="tabular">{formatDateTime(r.processingStartedAt)}</dd>
                </>
              )}
              <dt className="text-slate-500">{t('tickets.body')}</dt>
              <dd className="whitespace-pre-wrap">{r.body}</dd>
            </dl>
            {r.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.attachments.map((a) => (
                  <Button key={a._id} variant="secondary" onClick={() => downloadAttachment(a._id)}>
                    <Paperclip className="size-4" aria-hidden /> {a.originalName}
                  </Button>
                ))}
              </div>
            )}
            {r.resolution && (
              <Alert kind={r.state === 'closed' ? 'success' : 'info'}>
                <strong>{t('tickets.resolution')}:</strong> {r.resolution}
              </Alert>
            )}
            {r.rating?.score && (
              <div className="mt-2 flex items-center gap-1 text-sm text-slate-700">
                <span>{t('tickets.rating')}:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={cx('size-4', n <= r.rating!.score ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} aria-hidden />
                ))}
                {r.rating.comment && <span className="text-slate-500">— {r.rating.comment}</span>}
              </div>
            )}
          </Card>

          {r.actions.length > 0 && (
            <Card title={t('requests.actions')}>
              <div className="flex flex-wrap gap-2">
                {has('assign') && <Button onClick={() => setMode('assign')}>{r.assigneeId ? t('tasks.reassign') : t('tasks.assign')}</Button>}
                {has('start') && <Button onClick={() => act.mutate({ transition: 'start' })}>{t('tasks.startWork')}</Button>}
                {has('review') && (
                  <Button variant="secondary" onClick={() => act.mutate({ transition: 'review' })}>
                    {t('tickets.actions.review')}
                  </Button>
                )}
                {has('request_info') && (
                  <Button variant="secondary" onClick={() => setMode('request_info')}>
                    {t('tickets.actions.request_info')}
                  </Button>
                )}
                {has('provide_info') && <Button onClick={() => setMode('provide_info')}>{t('tickets.actions.provide_info')}</Button>}
                {has('resolve') && <Button onClick={() => setMode('resolve')}>{t('tickets.actions.resolve')}</Button>}
                {has('stall') && (
                  <Button variant="secondary" onClick={() => setMode('stall')}>
                    {t('tickets.actions.stall')}
                  </Button>
                )}
                {has('resume') && <Button onClick={() => act.mutate({ transition: 'resume' })}>{t('tickets.actions.resume')}</Button>}
                {has('close') && <Button onClick={() => setMode('close')}>{t('tickets.actions.close')}</Button>}
                {has('reopen') && (
                  <Button variant="danger" onClick={() => setMode('reopen')}>
                    {t('tickets.actions.reopen')}
                  </Button>
                )}
              </div>
              {(r.state === 'resolved' || r.state === 'awaiting_confirmation') && r.requesterUserId === user?.id && (
                <p className="mt-2 text-xs text-slate-500">{t('tickets.confirmHint', { days: r.reopenWithinDays })}</p>
              )}
            </Card>
          )}

          <Card title={t('tickets.comments')}>
            <ul className="space-y-2 text-sm">
              {comments.data?.items.map((c) => (
                <li key={c._id} className="rounded-lg bg-slate-50 p-2">
                  <div className="whitespace-pre-wrap">{c.body}</div>
                  <div className="mt-1 text-xs tabular text-slate-400">{formatDateTime(c.createdAt)}</div>
                </li>
              ))}
              {!comments.data?.items.length && <li className="text-xs text-slate-500">{t('tickets.noComments')}</li>}
            </ul>
            {r.state !== 'closed' && (
              <div className="mt-3 flex gap-2">
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('tickets.addComment')} />
                <Button onClick={() => addComment.mutate()} disabled={comment.trim().length < 1} loading={addComment.isPending}>
                  {t('actions.send')}
                </Button>
              </div>
            )}
          </Card>
        </div>

        <Card title={t('tickets.log')}>
          <ol className="relative space-y-4 border-s border-slate-200 ps-4">
            {r.history.map((h) => (
              <li key={h._id} className="relative">
                <span className={cx('absolute -start-[21px] top-1.5 size-2.5 rounded-full', h.toState === 'closed' ? 'bg-slate-400' : h.toState === 'resolved' ? 'bg-emerald-500' : 'bg-brand-600')} aria-hidden />
                <div className="text-sm font-medium">
                  {t(`tickets.actionsLog.${h.action}`, h.action)}
                  {h.toState && h.toState !== h.fromState && <span className="ms-2 text-xs text-slate-500">← {t(`tickets.states.${h.toState}`, h.toState)}</span>}
                </div>
                {h.note && <div className="text-xs text-slate-600">{h.note}</div>}
                <div className="text-xs tabular text-slate-400">
                  {formatDateTime(h.at)} · {h.actorEmail ?? t('tickets.system')}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {mode === 'assign' &&
        modal(
          t('tasks.assign'),
          <Field label={t('tickets.assignee')} required>
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">—</option>
              {members.map((m) => (
                <option key={m._id} value={m.userId}>
                  {m.fullNameAr} ({t('tasks.openCount', { count: m.openTasks })})
                </option>
              ))}
            </Select>
          </Field>,
          () => act.mutate({ transition: 'assign', assigneeId: assignee }),
          !assignee,
        )}
      {(mode === 'request_info' || mode === 'reopen' || mode === 'stall') &&
        modal(
          t(`tickets.actions.${mode}`),
          <Field label={t('requests.reasonRequired')} required>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>,
          () => act.mutate({ transition: mode, reason: text }),
          text.trim().length < 2,
        )}
      {mode === 'provide_info' &&
        modal(
          t('tickets.actions.provide_info'),
          <>
            <Field label={t('tickets.reply')} required>
              <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Field label={t('requests.attachments')}>
              <FileUploader onUploaded={(a) => setAtts((s) => [...s, a])} />
              {atts.map((a) => (
                <div key={a.attachmentId} className="text-xs text-slate-600">
                  {a.fileName}
                </div>
              ))}
            </Field>
          </>,
          () => act.mutate({ transition: 'provide_info', note: text, attachmentIds: atts.map((a) => a.attachmentId) }),
          text.trim().length < 1,
        )}
      {mode === 'resolve' &&
        modal(
          t('tickets.actions.resolve'),
          <Field label={t('tickets.resolution')} required>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>,
          () => act.mutate({ transition: 'resolve', resolution: text }),
          text.trim().length < 2,
        )}
      {mode === 'close' &&
        modal(
          t('tickets.actions.close'),
          <>
            <Field label={t('tickets.rateService')} required>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setScore(n)} aria-label={String(n)} className="p-1">
                    <Star className={cx('size-7', n <= score ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('tickets.ratingComment')}>
              <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>,
          () => act.mutate({ transition: 'close', rating: { score, comment: text || undefined } }),
          !score,
        )}
    </>
  );
}

function FieldRow({ label, value }: { label: string; value: unknown }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd>{value === undefined || value === null || value === '' ? '—' : String(value)}</dd>
    </>
  );
}
