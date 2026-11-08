import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { get, post } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { errorMessage } from '@/lib/errors';
import { openSignedUrl } from '@/lib/download';
import { Alert, Badge, Button, Card, Field, PageHeader, QueryError, Spinner, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { downloadAttachment } from '@/shared/files/FileUploader';
import { typeLabel, useReportTypes, type ReportDetail } from './_data';

/** One report [EP §14]: header, body, attachments, manager notes (append-only), export HTML (print → PDF) or Excel [EP §14.3]. */
export function ReportDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const types = useReportTypes();
  const q = useQuery({ queryKey: ['reports', 'item', id], queryFn: () => get<ReportDetail>(`/hr/employee-reports/${id}`) });
  const [note, setNote] = useState('');
  const addNote = useMutation({
    mutationFn: () => post(`/hr/employee-reports/${id}/notes`, { note }),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast(t('actions.save'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const exportAs = (format: 'html' | 'xlsx') =>
    openSignedUrl(async () => `/api/v1/hr/employee-reports/${id}/export?format=${format}`).catch((e) => toast(errorMessage(e), 'error'));
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Alert kind="error">{t('common.error')}</Alert>;
  const r = q.data;
  return (
    <>
      <PageHeader
        title={`${r.number} · ${r.title}`}
        subtitle={`${r.employee?.fullNameAr ?? ''} · ${typeLabel(types.data?.items, r.type)} · ${formatDate(r.submittedAt, { dateStyle: 'long' })}`}
        actions={
          <>
            <Badge tone={r.state === 'reviewed' ? 'green' : 'blue'}>{t(`reports.states.${r.state}`)}</Badge>
            <Button variant="secondary" onClick={() => exportAs('html')}>
              {t('reports.exportPdf')}
            </Button>
            <Button variant="secondary" onClick={() => exportAs('xlsx')}>
              {t('reports.exportExcel')}
            </Button>
            <Link to="/me/reports" className="text-sm text-brand-700 hover:underline">
              {t('actions.back')}
            </Link>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <dl className="mb-3 grid grid-cols-[130px_1fr] gap-x-2 gap-y-1 text-sm">
            <dt className="text-slate-500">{t('reports.period')}</dt>
            <dd className="tabular">{r.periodFrom || r.periodTo ? `${formatDate(r.periodFrom)} – ${formatDate(r.periodTo)}` : '—'}</dd>
            <dt className="text-slate-500">{t('reports.manager')}</dt>
            <dd>{r.managerName ?? '—'}</dd>
          </dl>
          <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">{r.body}</div>
          {r.attachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {r.attachments.map((a) => (
                <Button key={a._id} variant="secondary" onClick={() => downloadAttachment(a._id)}>
                  <Paperclip className="size-4" aria-hidden /> {a.originalName}
                </Button>
              ))}
            </div>
          )}
        </Card>
        <Card title={t('reports.notes')}>
          <ul className="space-y-2 text-sm">
            {r.notes.map((n, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-2">
                <div className="whitespace-pre-wrap">{n.note}</div>
                <div className="mt-1 text-xs tabular text-slate-400">
                  {n.byName ?? n.byEmail} · {formatDateTime(n.at)}
                </div>
              </li>
            ))}
            {!r.notes.length && <li className="text-xs text-slate-500">{t('reports.noNotes')}</li>}
          </ul>
          {r.canNote && (
            <div className="mt-3 space-y-2">
              <Field label={t('reports.addNote')}>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button disabled={note.trim().length < 1} loading={addNote.isPending} onClick={() => addNote.mutate()}>
                  {t('actions.send')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
