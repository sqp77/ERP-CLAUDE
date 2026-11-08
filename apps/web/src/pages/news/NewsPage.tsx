import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Pin } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { Badge, Button, Card, EmptyState, Input, PageHeader, QueryError, Select, Spinner } from '@/shared/ui';
import { useDepartments } from '@/lib/lookups';
import { NewsEditorDialog } from './NewsEditorDialog';
import { newsTone, useNews } from './_data';

type View = 'feed' | 'archive' | 'manage' | 'pending';

/** News & circulars [EP §12]: feed (pinned first), department filter, archive, and the publisher's manage / approval views. */
export function NewsPage({ view: initial = 'feed' }: { view?: View }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { formatDate } = usePrefs();
  const nav = useNavigate();
  const [view, setView] = useState<View>(initial);
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [editor, setEditor] = useState(false);
  const depts = useDepartments(true);
  const list = useNews({ view, departmentCode: dept || undefined, q: q || undefined, limit: 50 });
  const publisher = can('news', 'create');
  const views: View[] = publisher ? ['feed', 'archive', 'manage', 'pending'] : ['feed', 'archive'];
  return (
    <>
      <PageHeader
        title={t('news.title')}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {views.map((v) => (
                <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1.5 ${view === v ? 'bg-brand-700 text-white' : 'text-slate-600'}`}>
                  {t(`news.views.${v}`)}
                </button>
              ))}
            </div>
            {publisher && <Button onClick={() => setEditor(true)}>{t('news.new')}</Button>}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label={t('news.publisher')}>
          <option value="">{t('news.allDepartments')}</option>
          {depts.data?.items.map((d) => (
            <option key={d._id} value={d.code}>
              {d.nameAr}
            </option>
          ))}
        </Select>
        <Input placeholder={t('actions.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <Spinner />
      ) : !list.data?.items.length ? (
        <EmptyState title={t('news.empty')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.items.map((n) => (
            <Card key={n._id} className={n.pinned ? 'ring-1 ring-amber-300' : undefined}>
              <div className="flex items-start justify-between gap-2">
                <Link to={`/news/${n._id}`} className="text-base font-semibold text-slate-900 hover:underline">
                  {n.pinned && <Pin className="me-1 inline size-4 text-amber-600" aria-hidden />}
                  {n.title}
                </Link>
                {view !== 'feed' && <Badge tone={newsTone[n.state]}>{t(`news.states.${n.state}`)}</Badge>}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {n.departmentName ?? t(`departments.${n.departmentCode}`, n.departmentCode)} · {n.authorName} · {formatDate(n.publishedAt ?? n.createdAt, { dateStyle: 'medium' })}
                {!n.audienceAll && <Badge tone="slate">{t('news.targeted')}</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <NewsEditorDialog open={editor} onClose={() => setEditor(false)} onSaved={(id) => nav(`/news/${id}`)} />
    </>
  );
}
