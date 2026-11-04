import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get, post } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { Button, Card, EmptyState, PageHeader, Spinner, cx } from '@/shared/ui';

interface N {
  _id: string;
  titleAr: string;
  bodyAr?: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

/** Notification center [EP §15]: history, unread filter, mark read. */
export function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { formatDateTime } = usePrefs();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    queryFn: () =>
      get<{ items: N[]; unread: number }>(`/notifications?limit=50${unreadOnly ? '&unread=true' : ''}`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({
    mutationFn: (id: string) => post(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: invalidate });

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />{' '}
              {t('notifications.unreadOnly')}
            </label>
            <Button variant="secondary" onClick={() => readAll.mutate()} disabled={!q.data?.unread}>
              {t('actions.markAllRead')}
            </Button>
          </>
        }
      />
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('notifications.empty')} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.items.map((n) => (
              <li
                key={n._id}
                className={cx('flex items-start gap-3 py-3', !n.readAt && 'bg-brand-50/40 -mx-4 px-4')}
              >
                <span
                  className={cx(
                    'mt-2 size-2 shrink-0 rounded-full',
                    n.readAt ? 'bg-transparent' : 'bg-brand-600',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900">
                    {n.link ? (
                      <Link
                        to={n.link}
                        onClick={() => !n.readAt && readOne.mutate(n._id)}
                        className="hover:underline"
                      >
                        {n.titleAr}
                      </Link>
                    ) : (
                      n.titleAr
                    )}
                  </div>
                  {n.bodyAr && <div className="text-sm text-slate-600">{n.bodyAr}</div>}
                  <div className="mt-0.5 text-xs text-slate-400 tabular">{formatDateTime(n.createdAt)}</div>
                </div>
                {!n.readAt && (
                  <button
                    className="text-xs text-brand-700 hover:underline"
                    onClick={() => readOne.mutate(n._id)}
                  >
                    {t('actions.confirm')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
