import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { SALES_LIBRARY_CATEGORIES, type SalesLibraryCategory } from '@eayni/shared';
import { del, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { usePrefs } from '@/lib/preferences';
import { uploadFile, downloadAttachment } from '@/shared/files/FileUploader';
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
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { useLibraryHistory, useSalesLibrary, type LibraryDoc } from './_data';

/**
 * إدارة المستندات والإجراءات [SAL §8.2]: the manager uploads work procedures and instructions as PDF; a new upload of a
 * document keeps the old version. The rest of §8.2 (employee reports, secondment and visit reports, customer files)
 * already lives in its own screens, linked here.
 */
export function SalesLibraryPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useSalesLibrary();
  const [upload, setUpload] = useState<LibraryDoc | 'new' | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/sales/management/library/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales', 'library'] });
      toast(t('sales.library.deleted'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const canManage = !!q.data?.canManage;
  return (
    <>
      <PageHeader
        title={t('sales.library.title')}
        subtitle={t('sales.library.subtitle')}
        actions={canManage && <Button onClick={() => setUpload('new')}>{t('sales.library.upload')}</Button>}
      />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || !q.data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {SALES_LIBRARY_CATEGORIES.map((c) => {
            const docs = q.data.items.filter((d) => d.category === c);
            if (!docs.length && c === 'other') return null;
            return (
              <Card key={c} title={t(`sales.library.categories.${c}`)}>
                {!docs.length ? (
                  <EmptyState title={t('sales.library.empty')} />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {docs.map((d) => (
                      <li key={d._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <FileText className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="text-start font-medium text-brand-700 hover:underline"
                              onClick={() => downloadAttachment(d.attachmentId)}
                            >
                              {d.title}
                            </button>
                            {d.description && <p className="text-xs text-slate-600">{d.description}</p>}
                            <p className="text-xs text-slate-500">
                              {t('sales.library.uploadedBy', {
                                name: d.uploadedByName ?? '—',
                                date: formatDate(d.createdAt),
                              })}{' '}
                              {d.version > 1 && <Badge>v{d.version}</Badge>}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {d.versions > 1 && (
                            <Button
                              variant="ghost"
                              className="min-h-9 px-2 py-1"
                              onClick={() => setHistoryOf(d._id)}
                            >
                              {t('sales.library.versions', { n: d.versions })}
                            </Button>
                          )}
                          {canManage && (
                            <>
                              <Button
                                variant="ghost"
                                className="min-h-9 px-2 py-1"
                                onClick={() => setUpload(d)}
                              >
                                {t('sales.library.newVersion')}
                              </Button>
                              <Button
                                variant="ghost"
                                className="min-h-9 px-2 py-1 text-red-700"
                                onClick={() =>
                                  window.confirm(t('common.deleteConfirm')) && remove.mutate(d._id)
                                }
                              >
                                {t('actions.delete')}
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
          <Card title={t('sales.library.related')}>
            <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <li>
                <Link to="/reports" className="text-brand-700 hover:underline">
                  {t('sales.library.employeeReports')}
                </Link>
              </li>
              <li>
                <Link to="/hr/secondments" className="text-brand-700 hover:underline">
                  {t('sales.library.secondmentReports')}
                </Link>
              </li>
              <li>
                <Link to="/sales/tasks?view=visits" className="text-brand-700 hover:underline">
                  {t('sales.library.fieldVisits')}
                </Link>
              </li>
              <li>
                <Link to="/sales/customers" className="text-brand-700 hover:underline">
                  {t('sales.library.customerFiles')}
                </Link>
              </li>
            </ul>
          </Card>
        </div>
      )}
      {upload && <UploadDialog replaces={upload === 'new' ? null : upload} onClose={() => setUpload(null)} />}
      {historyOf && <LibraryHistoryDialog id={historyOf} onClose={() => setHistoryOf(null)} />}
    </>
  );
}

function UploadDialog({ replaces, onClose }: { replaces: LibraryDoc | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: replaces?.title ?? '',
    category: (replaces?.category ?? 'procedure') as SalesLibraryCategory,
    description: replaces?.description ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t('sales.library.pickFile'));
      if (file.type !== 'application/pdf') throw new Error(t('sales.library.pdfOnly'));
      const att = await uploadFile(file);
      return post('/sales/management/library', {
        title: f.title,
        category: f.category,
        description: f.description || undefined,
        attachmentId: att.attachmentId,
        replacesId: replaces?._id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales', 'library'] });
      toast(t('sales.library.uploaded'));
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={replaces ? t('sales.library.newVersion') : t('sales.library.upload')}
    >
      <div className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        {replaces && <Alert kind="info">{t('sales.library.versionHint')}</Alert>}
        <Field label={t('sales.library.docTitle')} required>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t('sales.library.category')} required>
          <Select
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value as SalesLibraryCategory })}
          >
            {SALES_LIBRARY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`sales.library.categories.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sales.library.description')}>
          <Textarea
            rows={2}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <Field label={t('sales.library.file')} required hint={t('sales.library.pdfOnly')}>
          <input
            type="file"
            accept="application/pdf"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={f.title.trim().length < 3 || !file}
            onClick={() => save.mutate()}
          >
            {t('actions.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function LibraryHistoryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const h = useLibraryHistory(id);
  return (
    <Dialog open onClose={onClose} title={t('sales.library.historyTitle')}>
      {h.isLoading ? (
        <Spinner />
      ) : (
        <ol className="space-y-2 text-sm">
          {h.data?.items.map((v) => (
            <li
              key={v._id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"
            >
              <button
                type="button"
                className="text-start text-brand-700 hover:underline"
                onClick={() => downloadAttachment(v.attachmentId)}
              >
                v{v.version} — {v.title}
              </button>
              <span className="text-xs text-slate-500">
                {v.uploadedByName} · {formatDate(v.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.close')}
        </Button>
      </div>
    </Dialog>
  );
}
