import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Link as LinkIcon } from 'lucide-react';
import { EVENT_STATUSES, EVENT_TYPES, type EventStatus, type EventType } from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, patch, post } from '@/lib/api';
import { errorMessage, fieldErrorsFrom } from '@/lib/errors';
import { recordLink } from '@/lib/links';
import {
  addDays,
  localInputToIso,
  riyadhParts,
  sameRiyadhDay,
  startOfRiyadhDay,
  startOfRiyadhHijriMonth,
  startOfRiyadhWeek,
} from '@/lib/dates';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
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

interface Ev {
  _id: string;
  title: string;
  type: EventType;
  status: EventStatus;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  location?: string;
  meetingUrl?: string;
  description?: string;
  outcome?: string;
  participantIds?: string[];
  ownerId?: string;
  readOnly: boolean;
  source: 'event' | 'module';
  link?: { type: string; id: string; label?: string };
  startHijri: string;
}
interface Person {
  userId: string;
  fullNameAr: string;
}
type View = 'day' | 'week' | 'month';

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
const statusTone: Record<EventStatus, 'slate' | 'green' | 'red' | 'amber' | 'blue'> = {
  scheduled: 'blue',
  done: 'green',
  not_done: 'red',
  rescheduled: 'amber',
  cancelled: 'slate',
};
const OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** Instant at 00:00 Riyadh of the first day of the month containing `now`, shifted by `offset` months. */
function startOfRiyadhMonth(offset: number, now = new Date()): Date {
  const { year, month } = riyadhParts(now);
  return new Date(Date.UTC(year, month - 1 + offset, 1) - OFFSET_MS);
}
const linkTo = (l?: { type: string; id: string }) => recordLink(l?.type, l?.id); // review H6

/**
 * One calendar [EP §13]: day / week / month views in Riyadh time, Gregorian or Hijri labels (global toggle),
 * colours by type, status badges, tasks and secondments merged read-only, new meetings with
 * participants and a linked record, reschedule / status / outcome.
 */
export function CalendarPage() {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const { formatDate, calendar } = usePrefs();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('week');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Ev | null>(null);

  const range = useMemo(() => {
    if (view === 'day') {
      const start = addDays(startOfRiyadhDay(), offset);
      return { start, end: addDays(start, 1) };
    }
    if (view === 'week') {
      const start = startOfRiyadhWeek(offset);
      return { start, end: addDays(start, 7) };
    }
    if (calendar === 'hijri') {
      // Hijri months in the grid when Hijri is selected (review H4): title and day numbers agree with the cells.
      const start = startOfRiyadhHijriMonth(offset);
      return { start, end: startOfRiyadhHijriMonth(offset + 1) };
    }
    const start = startOfRiyadhMonth(offset);
    return { start, end: startOfRiyadhMonth(offset + 1) };
  }, [view, offset, calendar]);
  const q = useQuery({
    queryKey: ['calendar', view, range.start.toISOString()],
    queryFn: () =>
      get<{ items: Ev[] }>(
        `/calendar/events?from=${range.start.toISOString()}&to=${range.end.toISOString()}`,
      ),
  });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  // Deep link from notifications: /calendar?event=<id> (review H4). The event is fetched by id and the
  // calendar jumps to its date before the dialog opens, so an old or far-away event is found too.
  const deepId = params.get('event');
  const deep = useQuery({
    queryKey: ['calendar', 'event', deepId],
    queryFn: () => get<Ev>(`/calendar/events/${deepId}`),
    enabled: !!deepId,
  });
  const [jumpedTo, setJumpedTo] = useState<string | null>(null);
  useEffect(() => {
    if (!deepId || !deep.data || jumpedTo === deepId) return;
    const start = new Date(deep.data.startAt);
    if (!(start >= range.start && start < range.end)) {
      if (view === 'day')
        setOffset(Math.round((startOfRiyadhDay(start).getTime() - startOfRiyadhDay().getTime()) / DAY_MS));
      else if (view === 'week')
        setOffset(
          Math.round((startOfRiyadhWeek(0, start).getTime() - startOfRiyadhWeek(0).getTime()) / (7 * DAY_MS)),
        );
      else {
        const { year, month } = riyadhParts(start);
        const nowParts = riyadhParts();
        setOffset((year - nowParts.year) * 12 + (month - nowParts.month));
      }
    }
    setJumpedTo(deepId);
    setSelected(deep.data);
  }, [deepId, deep.data, jumpedTo, range.start, range.end, view]);

  const gridStart =
    view === 'month' ? startOfRiyadhWeek(0, new Date(range.start.getTime() + OFFSET_MS)) : range.start;
  const dayCount = view === 'day' ? 1 : view === 'week' ? 7 : 42;
  const days = Array.from({ length: dayCount }, (_, i) => addDays(gridStart, i));
  const inMonth = (d: Date) => d >= range.start && d < range.end;
  const dayItems = (d: Date) =>
    items.filter((e) => {
      const s = new Date(e.startAt);
      const en = new Date(e.endAt);
      if (e.allDay || en.getTime() - s.getTime() >= DAY_MS) return s < addDays(d, 1) && en >= d;
      return sameRiyadhDay(s, d);
    });
  const title =
    view === 'month'
      ? formatDate(new Date(range.start.getTime() + OFFSET_MS), { month: 'long', year: 'numeric' })
      : view === 'day'
        ? formatDate(range.start, { dateStyle: 'full' })
        : `${formatDate(range.start, { day: 'numeric', month: 'short' })} – ${formatDate(addDays(range.end, -1), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const chip = (e: Ev, compact = false) => (
    <button
      key={e._id}
      type="button"
      onClick={() => setSelected(e)}
      className={cx(
        'flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-start text-xs hover:bg-slate-100',
        compact && 'truncate',
      )}
      title={e.title}
    >
      <span className={cx('mt-1 size-2 shrink-0 rounded-full', typeColor[e.type])} aria-hidden />
      <span className="min-w-0 flex-1">
        {!e.allDay && (
          <span className="tabular text-slate-500">{formatDate(e.startAt, { timeStyle: 'short' })} </span>
        )}
        <span className={cx('font-medium', e.status === 'cancelled' && 'text-slate-400 line-through')}>
          {e.title}
        </span>
        {!compact && (
          <span className="ms-1">
            <Badge tone={statusTone[e.status]}>{t(`calendar.statuses.${e.status}`)}</Badge>
          </span>
        )}
      </span>
    </button>
  );

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        subtitle={title}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {(['day', 'week', 'month'] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setView(v);
                    setOffset(0);
                  }}
                  className={cx(
                    'rounded-md px-2.5 py-1.5',
                    view === v ? 'bg-brand-700 text-white' : 'text-slate-600',
                  )}
                >
                  {t(`calendar.views.${v}`)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                className="rounded-md p-2 hover:bg-slate-100"
                onClick={() => setOffset((o) => o - 1)}
                aria-label={t('common.prev')}
              >
                <ChevronRight className="size-4" />
              </button>
              <button className="px-2 text-sm" onClick={() => setOffset(0)}>
                {t('calendar.today')}
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
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
        {EVENT_TYPES.map((x) => (
          <span key={x} className="flex items-center gap-1">
            <span className={cx('size-2 rounded-full', typeColor[x])} aria-hidden />{' '}
            {t(`calendar.types.${x}`)}
          </span>
        ))}
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Spinner />
      ) : view === 'month' ? (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200">
          {days.slice(0, 7).map((d) => (
            <div
              key={`h${d.toISOString()}`}
              className="bg-slate-50 px-2 py-1 text-center text-xs font-semibold text-slate-600"
            >
              {formatDate(d, { weekday: 'short' })}
            </div>
          ))}
          {days.map((d) => {
            const list = dayItems(d);
            return (
              <div
                key={d.toISOString()}
                className={cx(
                  'min-h-24 bg-white p-1',
                  !inMonth(d) && 'bg-slate-50 text-slate-400',
                  sameRiyadhDay(d) && 'ring-2 ring-inset ring-brand-500',
                )}
              >
                <div className="mb-1 text-end text-xs tabular">{formatDate(d, { day: 'numeric' })}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((e) => chip(e, true))}
                  {list.length > 3 && (
                    <button
                      className="text-[11px] text-brand-700"
                      onClick={() => {
                        setView('day');
                        setOffset(Math.round((d.getTime() - startOfRiyadhDay().getTime()) / DAY_MS));
                      }}
                    >
                      +{list.length - 3}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={cx('grid gap-3', view === 'week' && 'md:grid-cols-2 xl:grid-cols-4')}>
          {days.map((d) => {
            const list = dayItems(d);
            return (
              <Card key={d.toISOString()} className={cx(sameRiyadhDay(d) && 'ring-2 ring-brand-500')}>
                <div className="mb-2 text-sm font-semibold">
                  {formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                {list.length === 0 ? (
                  <div className="text-xs text-slate-400">{t('calendar.noEvents')}</div>
                ) : (
                  <div className="space-y-1">{list.map((e) => chip(e))}</div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <EventDialog
        ev={selected}
        onClose={() => {
          setSelected(null);
          if (params.get('event')) setParams({});
        }}
        meId={user?.id}
        onChanged={() => qc.invalidateQueries({ queryKey: ['calendar'] })}
      />
      <NewEventDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['calendar'] })}
      />
    </>
  );
}

/** Event details: status / outcome for owner and participants, reschedule, linked record [EP §13.11–13.12]. */
function EventDialog({
  ev,
  onClose,
  meId,
  onChanged,
}: {
  ev: Ev | null;
  onClose: () => void;
  meId?: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const toast = useToast();
  const [mode, setMode] = useState<'status' | 'reschedule' | null>(null);
  const [status, setStatus] = useState<EventStatus>('done');
  const [outcome, setOutcome] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/calendar/events/${ev!._id}`, body),
    onSuccess: () => {
      onChanged();
      setMode(null);
      toast(t('actions.save'));
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!ev) return null;
  const mine = ev.ownerId === meId || ev.participantIds?.includes(meId ?? '');
  const href = linkTo(ev.link);
  return (
    <Dialog open onClose={onClose} title={ev.title}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx('size-2.5 rounded-full', typeColor[ev.type])} aria-hidden />
          <span>{t(`calendar.types.${ev.type}`)}</span>
          <Badge tone={statusTone[ev.status]}>{t(`calendar.statuses.${ev.status}`)}</Badge>
        </div>
        <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
          <dt className="text-slate-500">{t('calendar.start')}</dt>
          <dd className="tabular">
            {formatDate(
              ev.startAt,
              ev.allDay ? { dateStyle: 'full' } : { dateStyle: 'full', timeStyle: 'short' },
            )}
            <span className="ms-2 text-xs text-slate-500">({ev.startHijri})</span>
          </dd>
          <dt className="text-slate-500">{t('calendar.end')}</dt>
          <dd className="tabular">
            {formatDate(
              ev.endAt,
              ev.allDay ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' },
            )}
          </dd>
          {ev.location && (
            <>
              <dt className="text-slate-500">{t('calendar.location')}</dt>
              <dd>{ev.location}</dd>
            </>
          )}
          {ev.meetingUrl && (
            <>
              <dt className="text-slate-500">{t('calendar.meetingUrl')}</dt>
              <dd>
                <a
                  href={ev.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-brand-700 hover:underline"
                  dir="ltr"
                >
                  {ev.meetingUrl}
                </a>
              </dd>
            </>
          )}
          {ev.description && (
            <>
              <dt className="text-slate-500">{t('tasks.description')}</dt>
              <dd className="whitespace-pre-wrap">{ev.description}</dd>
            </>
          )}
          {ev.outcome && (
            <>
              <dt className="text-slate-500">{t('calendar.outcome')}</dt>
              <dd className="whitespace-pre-wrap">{ev.outcome}</dd>
            </>
          )}
          {ev.link && (
            <>
              <dt className="text-slate-500">{t('calendar.linkedRecord')}</dt>
              <dd>
                {href ? (
                  <a href={href} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                    <LinkIcon className="size-3" aria-hidden /> {ev.link.label ?? ev.link.id}
                  </a>
                ) : (
                  (ev.link.label ?? ev.link.id)
                )}
              </dd>
            </>
          )}
        </dl>
        {!ev.readOnly && mine && ev.status !== 'cancelled' && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Button variant="secondary" onClick={() => setMode('status')}>
              {t('calendar.setStatus')}
            </Button>
            {ev.ownerId === meId && (
              <Button variant="secondary" onClick={() => setMode('reschedule')}>
                {t('calendar.reschedule')}
              </Button>
            )}
            {ev.ownerId === meId && (
              <Button
                variant="ghost"
                onClick={() =>
                  window.confirm(t('calendar.cancelConfirm')) && save.mutate({ status: 'cancelled' })
                }
              >
                {t('calendar.cancelEvent')}
              </Button>
            )}
          </div>
        )}
        {mode === 'status' && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <Field label={t('common.status')}>
              <Select value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>
                {EVENT_STATUSES.filter((s) => s !== 'rescheduled').map((s) => (
                  <option key={s} value={s}>
                    {t(`calendar.statuses.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('calendar.outcome')}>
              <Textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMode(null)}>
                {t('actions.cancel')}
              </Button>
              <Button
                loading={save.isPending}
                onClick={() => save.mutate({ status, outcome: outcome || undefined })}
              >
                {t('actions.save')}
              </Button>
            </div>
          </div>
        )}
        {mode === 'reschedule' && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('calendar.start')} required>
                <Input
                  type="datetime-local"
                  dir="ltr"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </Field>
              <Field label={t('calendar.end')} required>
                <Input
                  type="datetime-local"
                  dir="ltr"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-slate-500">{t('calendar.rescheduleHint')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMode(null)}>
                {t('actions.cancel')}
              </Button>
              <Button
                disabled={!startAt || !endAt}
                loading={save.isPending}
                onClick={() =>
                  save.mutate({ startAt: localInputToIso(startAt), endAt: localInputToIso(endAt) })
                }
              >
                {t('calendar.reschedule')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

interface NewEventForm {
  title: string;
  type: EventType;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  location?: string;
  meetingUrl?: string;
  description?: string;
  linkType?: string;
  linkId?: string;
}

/** New meeting / visit / training with participants (name search) and an optional linked record [EP §13.8, §13.12]. */
function NewEventDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [pq, setPq] = useState('');
  const [participants, setParticipants] = useState<Person[]>([]);
  const people = useQuery({
    queryKey: ['calendar', 'people', pq],
    queryFn: () => get<{ items: Person[] }>(`/calendar/people?q=${encodeURIComponent(pq)}`),
    enabled: open && pq.trim().length >= 2,
  });
  const form = useForm<NewEventForm>({ defaultValues: { type: 'meeting' } });
  const required = t('common.requiredField');
  const err = (k: 'title' | 'startAt' | 'endAt') => form.formState.errors[k]?.message;
  const create = form.handleSubmit(async (v) => {
    setError(undefined);
    try {
      await post('/calendar/events', {
        title: v.title,
        type: v.type,
        startAt: localInputToIso(v.startAt),
        endAt: localInputToIso(v.endAt),
        allDay: !!v.allDay,
        location: v.location || undefined,
        meetingUrl: v.meetingUrl || undefined,
        description: v.description || undefined,
        participantIds: participants.map((p) => p.userId),
        link: v.linkType && v.linkId ? { type: v.linkType, id: v.linkId.trim() } : undefined,
      });
      toast(t('actions.save'));
      onCreated();
      form.reset({ type: 'meeting' });
      setParticipants([]);
      onClose();
    } catch (e) {
      for (const [name, message] of Object.entries(fieldErrorsFrom(e)))
        form.setError(name as keyof NewEventForm, { type: 'server', message });
      setError(errorMessage(e));
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('calendar.new')}>
      <form onSubmit={create} className="space-y-3" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('calendar.eventTitle')} required error={err('title')}>
          <Input {...form.register('title', { required, minLength: { value: 2, message: required } })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('calendar.type')}>
            <Select {...form.register('type')}>
              {EVENT_TYPES.filter((x) => x !== 'task' && x !== 'secondment').map((x) => (
                <option key={x} value={x}>
                  {t(`calendar.types.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('allDay')} /> {t('calendar.allDay')}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('calendar.start')} required error={err('startAt')}>
            <Input type="datetime-local" dir="ltr" {...form.register('startAt', { required })} />
          </Field>
          <Field label={t('calendar.end')} required error={err('endAt')}>
            <Input type="datetime-local" dir="ltr" {...form.register('endAt', { required })} />
          </Field>
        </div>
        <Field label={t('calendar.participants')} hint={t('calendar.participantsHint')}>
          <div className="space-y-2">
            <Input value={pq} onChange={(e) => setPq(e.target.value)} placeholder={t('actions.search')} />
            {people.data?.items.length ? (
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {people.data.items
                  .filter((p) => !participants.some((x) => x.userId === p.userId))
                  .map((p) => (
                    <button
                      key={p.userId}
                      type="button"
                      className="block w-full rounded-md border border-slate-200 px-2 py-1 text-start text-sm hover:bg-slate-50"
                      onClick={() => setParticipants((s) => [...s, p])}
                    >
                      {p.fullNameAr}
                    </button>
                  ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {participants.map((p) => (
                <button
                  key={p.userId}
                  type="button"
                  onClick={() => setParticipants((s) => s.filter((x) => x.userId !== p.userId))}
                  className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800"
                >
                  {p.fullNameAr} ×
                </button>
              ))}
            </div>
          </div>
        </Field>
        <Field label={t('calendar.location')}>
          <Input {...form.register('location')} />
        </Field>
        <Field label={t('calendar.meetingUrl')}>
          <Input dir="ltr" type="url" {...form.register('meetingUrl')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('calendar.linkedRecord')}>
            <Select {...form.register('linkType')}>
              <option value="">—</option>
              <option value="task">{t('tasks.sources.task')}</option>
              <option value="ticket">{t('tasks.sources.ticket')}</option>
              <option value="hr_request">{t('tasks.sources.hr_request')}</option>
            </Select>
          </Field>
          <Field label={t('tasks.sourceId')} hint={t('tasks.sourceHint')}>
            <Input dir="ltr" {...form.register('linkId')} />
          </Field>
        </div>
        <Field label={t('tasks.description')}>
          <Textarea rows={2} {...form.register('description')} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            {t('actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
