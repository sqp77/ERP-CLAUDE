import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NotificationType } from '@eayni/shared';
import { get, post } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import { riyadhToday } from '@/lib/dates';
import { Badge, Button, Card, EmptyState, PageHeader, QueryError, Spinner, cx } from '@/shared/ui';

interface N {
  _id: string;
  type: NotificationType;
  titleAr: string;
  bodyAr?: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

/** EP §15 groups of the 18 notification types (plus platform ones). */
const GROUPS: Record<string, string[]> = {
  tasks: [
    'task.assigned',
    'task.due_soon',
    'task.overdue',
    'task.review_requested',
    'task.approved',
    'task.returned',
    'task.reassigned',
    'task.unassigned_reminder',
  ],
  meetings: ['meeting.created', 'meeting.reminder', 'training.added'],
  tickets: [
    'ticket.created',
    'ticket.updated',
    'ticket.assigned',
    'ticket.info_requested',
    'ticket.resolved',
    'ticket.confirm_reminder',
    'ticket.auto_closed',
    'ticket.reopened',
    'ticket.closed',
    'request.decided',
  ],
  hr: [
    'contract.expiring',
    'probation.ending',
    'employee.birthday',
    'report.requested',
    'secondment.report_reminder',
    'employee.manager_or_department_changed',
    'employee.promotion',
    'employee.data_updated',
    'document.expiring',
  ],
  news: ['news.published'],
  security: ['security.alert', 'auth.password_reset', 'auth.new_login'],
};
const PAGE = 30;

/** Notification center [EP §15]: history grouped by day, unread filter, type groups, mark one / all read, link to the record. */
export function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { formatDate, formatDateTime } = usePrefs();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [group, setGroup] = useState<string>('');
  const [limit, setLimit] = useState(PAGE);
  const types = group ? GROUPS[group].join(',') : '';
  const q = useQuery({
    queryKey: ['notifications', 'list', unreadOnly, group, limit],
    queryFn: () =>
      get<{ items: N[]; unread: number; total: number }>(
        `/notifications?limit=${limit}${unreadOnly ? '&unread=true' : ''}${types ? `&types=${encodeURIComponent(types)}` : ''}`,
      ),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({
    mutationFn: (id: string) => post(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: invalidate });

  const today = riyadhToday();
  const yesterday = riyadhToday(new Date(Date.now() - 86_400_000));
  const dayLabel = (iso: string) => {
    const d = riyadhToday(new Date(iso));
    return d === today
      ? t('notifications.today')
      : d === yesterday
        ? t('notifications.yesterday')
        : formatDate(iso, { dateStyle: 'full' });
  };
  const items = q.data?.items ?? [];
  const byDay: { day: string; items: N[] }[] = [];
  for (const n of items) {
    const day = dayLabel(n.createdAt);
    const last = byDay[byDay.length - 1];
    if (last && last.day === day) last.items.push(n);
    else byDay.push({ day, items: [n] });
  }

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        subtitle={q.data ? t('notifications.unreadCount', { count: q.data.unread }) : undefined}
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
      <div className="mb-3 flex flex-wrap gap-1">
        {['', ...Object.keys(GROUPS)].map((g) => (
          <button
            key={g || 'all'}
            onClick={() => setGroup(g)}
            className={cx(
              'rounded-full px-3 py-1 text-xs',
              group === g ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            )}
          >
            {g ? t(`notifications.groups.${g}`) : t('common.all')}
          </button>
        ))}
      </div>
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !items.length ? (
          <EmptyState title={t('notifications.empty')} />
        ) : (
          <div className="space-y-4">
            {byDay.map((d) => (
              <div key={d.day}>
                <div className="mb-1 text-xs font-semibold text-slate-500">{d.day}</div>
                <ul className="divide-y divide-slate-100">
                  {d.items.map((n) => (
                    <li
                      key={n._id}
                      className={cx('flex items-start gap-3 py-3', !n.readAt && '-mx-4 bg-brand-50/40 px-4')}
                    >
                      <span
                        className={cx(
                          'mt-2 size-2 shrink-0 rounded-full',
                          n.readAt ? 'bg-transparent' : 'bg-brand-600',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
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
                          <Badge tone="slate">{t(`notifications.types.${n.type}`, n.type)}</Badge>
                        </div>
                        {n.bodyAr && <div className="text-sm text-slate-600">{n.bodyAr}</div>}
                        <div className="mt-0.5 text-xs tabular text-slate-400">
                          {formatDateTime(n.createdAt)}
                        </div>
                      </div>
                      {!n.readAt && (
                        <button
                          className="text-xs text-brand-700 hover:underline"
                          onClick={() => readOne.mutate(n._id)}
                        >
                          {t('notifications.markRead')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {q.data && q.data.total > items.length && (
              <div className="text-center">
                <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                  {t('notifications.loadMore')}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
