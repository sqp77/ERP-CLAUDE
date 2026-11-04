import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { EVENT_TYPES, type EventStatus, type EventType } from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
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
  Select,
  Spinner,
  cx,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';

interface Ev {
  _id: string;
  title: string;
  type: EventType;
  status: EventStatus;
  startAt: string;
  endAt: string;
  location?: string;
  meetingUrl?: string;
  startHijri: string;
}

const typeColor: Record<EventType, string> = {
  meeting: 'bg-sky-500',
  visit: 'bg-amber-500',
  training: 'bg-violet-500',
  secondment: 'bg-fuchsia-500',
  follow_up: 'bg-emerald-500',
  event: 'bg-rose-500',
  task: 'bg-slate-500',
  other: 'bg-slate-400',
};

/** Week view grouped by day, Gregorian/Hijri labels, colors by type [EP §13]. Month grid comes with phase 1. */
export function CalendarPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { formatDate } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 7) % 7) + offset * 7); // weeks start Sunday
    const end = new Date(start.getTime() + 7 * 86_400_000);
    return { start, end };
  }, [offset]);
  const q = useQuery({
    queryKey: ['calendar', range.start.toISOString()],
    queryFn: () =>
      get<{ items: Ev[] }>(
        `/calendar/events?from=${range.start.toISOString()}&to=${range.end.toISOString()}`,
      ),
  });
  const days = Array.from({ length: 7 }, (_, i) => new Date(range.start.getTime() + i * 86_400_000));
  const form = useForm<{
    title: string;
    type: EventType;
    startAt: string;
    endAt: string;
    location?: string;
    meetingUrl?: string;
  }>({ defaultValues: { type: 'meeting' } });
  const create = form.handleSubmit(async (v) => {
    try {
      await post('/calendar/events', {
        ...v,
        meetingUrl: v.meetingUrl || undefined,
        location: v.location || undefined,
      });
      toast(t('actions.save'));
      setOpen(false);
      form.reset();
      qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        actions={
          <>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                className="rounded-md p-2 hover:bg-slate-100"
                onClick={() => setOffset((o) => o - 1)}
                aria-label={t('common.prev')}
              >
                <ChevronRight className="size-4" />
              </button>
              <button className="px-2 text-sm" onClick={() => setOffset(0)}>
                {t('calendar.thisWeek')}
              </button>
              <button
                className="rounded-md p-2 hover:bg-slate-100"
                onClick={() => setOffset((o) => o + 1)}
                aria-label={t('common.next')}
              >
                <ChevronLeft className="size-4" />
              </button>
            </div>
            {can('calendar', 'create') && <Button onClick={() => setOpen(true)}>{t('calendar.new')}</Button>}
          </>
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {days.map((d) => {
            const items = (q.data?.items ?? []).filter(
              (e) => new Date(e.startAt).toDateString() === d.toDateString(),
            );
            const today = d.toDateString() === new Date().toDateString();
            return (
              <Card key={d.toISOString()} className={cx(today && 'ring-2 ring-brand-500')}>
                <div className="mb-2 text-sm font-semibold">
                  {formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                {items.length === 0 ? (
                  <div className="text-xs text-slate-400">—</div>
                ) : (
                  <ul className="space-y-2">
                    {items.map((e) => (
                      <li key={e._id} className="flex items-start gap-2 text-sm">
                        <span
                          className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', typeColor[e.type])}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <div className="font-medium">{e.title}</div>
                          <div className="text-xs text-slate-500 tabular">
                            {formatDate(e.startAt, { timeStyle: 'short' })} · {t(`calendar.types.${e.type}`)}{' '}
                            <Badge>{t(`calendar.statuses.${e.status}`)}</Badge>
                          </div>
                          {e.location && <div className="text-xs text-slate-500">{e.location}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {!q.isLoading && !q.data?.items.length && (
        <div className="mt-3">
          <EmptyState title={t('calendar.noEvents')} />
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('calendar.new')}>
        <form onSubmit={create} className="space-y-3" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('calendar.eventTitle')} required>
            <Input {...form.register('title', { required: true })} />
          </Field>
          <Field label={t('calendar.type')}>
            <Select {...form.register('type')}>
              {EVENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`calendar.types.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('calendar.start')} required>
              <Input type="datetime-local" dir="ltr" {...form.register('startAt', { required: true })} />
            </Field>
            <Field label={t('calendar.end')} required>
              <Input type="datetime-local" dir="ltr" {...form.register('endAt', { required: true })} />
            </Field>
          </div>
          <Field label={t('calendar.location')}>
            <Input {...form.register('location')} />
          </Field>
          <Field label={t('calendar.meetingUrl')}>
            <Input dir="ltr" type="url" {...form.register('meetingUrl')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
