import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip, Pin } from 'lucide-react';
import { get, post } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { errorMessage } from '@/lib/errors';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  PageHeader,
  QueryError,
  Spinner,
  Textarea,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { downloadAttachment } from '@/shared/files/FileUploader';
import { NewsEditorDialog } from './NewsEditorDialog';
import { newsTone, type NewsDetail } from './_data';

/** One news item [EP §12]: cover image, body, attachments, publisher and date; publisher / approver actions. */
export function NewsDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['news', 'item', id], queryFn: () => get<NewsDetail>(`/news/${id}`) });
  const [coverUrl, setCoverUrl] = useState<string>();
  const [editor, setEditor] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    const c = q.data?.coverAttachmentId;
    if (!c) return;
    get<{ url: string }>(`/files/${c}/url`)
      .then((r) => setCoverUrl(r.url))
      .catch(() => undefined);
  }, [q.data?.coverAttachmentId]);
  const act = useMutation({
    mutationFn: (p: { path: string; body?: unknown }) => post(`/news/${id}/${p.path}`, p.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['news'] });
      setRejecting(false);
      toast(t('actions.save'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Alert kind="error">{t('common.error')}</Alert>;
  const n = q.data;
  const files = n.attachments.filter((a) => a._id !== n.coverAttachmentId);
  return (
    <>
      <PageHeader
        title={n.title}
        subtitle={`${n.departmentName ?? n.departmentCode} · ${n.authorName ?? ''} · ${formatDate(n.publishedAt ?? n.createdAt, { dateStyle: 'long' })}`}
        actions={
          <>
            {n.pinned && <Pin className="size-4 text-amber-600" aria-hidden />}
            {n.state !== 'published' && <Badge tone={newsTone[n.state]}>{t(`news.states.${n.state}`)}</Badge>}
            <Link to="/news" className="text-sm text-brand-700 hover:underline">
              {t('actions.back')}
            </Link>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          {coverUrl && <img src={coverUrl} alt="" className="mb-4 max-h-80 w-full rounded-lg object-cover" />}
          {n.state === 'rejected' && n.rejectReason && (
            <Alert kind="error">
              <strong>{t('news.rejectReason')}:</strong> {n.rejectReason}
            </Alert>
          )}
          <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">{n.body}</div>
          {files.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {files.map((a) => (
                <Button key={a._id} variant="secondary" onClick={() => downloadAttachment(a._id)}>
                  <Paperclip className="size-4" aria-hidden /> {a.originalName}
                </Button>
              ))}
            </div>
          )}
          {(n.publishFrom || n.publishTo) && (
            <p className="mt-3 text-xs text-slate-500">
              {t('news.window')}: {n.publishFrom ? formatDateTime(n.publishFrom) : '—'} {t('news.windowTo')}{' '}
              {n.publishTo ? formatDateTime(n.publishTo) : '—'}
            </p>
          )}
        </Card>
        <div className="space-y-4">
          {(n.canEdit || n.canApprove) && (
            <Card title={t('requests.actions')}>
              <div className="flex flex-wrap gap-2">
                {n.canEdit && n.state !== 'archived' && (
                  <Button variant="secondary" onClick={() => setEditor(true)}>
                    {t('actions.edit')}
                  </Button>
                )}
                {n.canEdit && (n.state === 'draft' || n.state === 'rejected') && (
                  <Button onClick={() => act.mutate({ path: 'submit' })}>{t('news.submit')}</Button>
                )}
                {n.canApprove && n.state === 'pending_approval' && (
                  <>
                    <Button onClick={() => act.mutate({ path: 'decide', body: { approve: true } })}>
                      {t('news.approve')}
                    </Button>
                    <Button variant="danger" onClick={() => setRejecting(true)}>
                      {t('news.reject')}
                    </Button>
                  </>
                )}
                {n.canApprove && n.state === 'published' && (
                  <Button
                    variant="ghost"
                    onClick={() => act.mutate({ path: 'pin', body: { pinned: !n.pinned } })}
                  >
                    {n.pinned ? t('news.unpin') : t('news.pin')}
                  </Button>
                )}
                {n.canEdit && n.state === 'published' && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      window.confirm(t('news.archiveConfirm')) && act.mutate({ path: 'archive' })
                    }
                  >
                    {t('news.archive')}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {t('news.audience')}: {n.audienceAll ? t('news.audienceAll') : t('news.audienceDepartments')}
              </p>
            </Card>
          )}
          {(n.canEdit || n.canApprove) && (
            <Card title={t('news.log')}>
              <ol className="space-y-2 text-xs">
                {n.history.map((h) => (
                  <li key={h._id}>
                    <span className="font-medium">{t(`news.actionsLog.${h.action}`, h.action)}</span>
                    {h.note && <span className="text-slate-600"> — {h.note}</span>}
                    <div className="tabular text-slate-400">
                      {formatDateTime(h.at)} · {h.actorEmail}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>
      <NewsEditorDialog
        open={editor}
        onClose={() => setEditor(false)}
        existing={n}
        canPin={n.canApprove}
        onSaved={() => qc.invalidateQueries({ queryKey: ['news'] })}
      />
      <Dialog open={rejecting} onClose={() => setRejecting(false)} title={t('news.reject')}>
        <div className="space-y-3">
          <Field label={t('requests.reasonRequired')} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 2}
              loading={act.isPending}
              onClick={() => act.mutate({ path: 'decide', body: { approve: false, reason } })}
            >
              {t('news.reject')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
