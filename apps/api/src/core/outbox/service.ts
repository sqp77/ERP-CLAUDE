import type { ClientSession } from 'mongoose';
import { logger } from '../../logger';
import { Outbox, type OutboxDoc } from './model';
import { getSetting } from '../settings/service';
import { notifySystemAdmins } from '../notifications/alerts';
import { recordAudit } from '../audit/service';
import type { Actor } from '../http/context';
import { conflict } from '../http/errors';

export interface DomainEvent<T = Record<string, unknown>> {
  type: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: T;
  idempotencyKey?: string;
  actorUserId?: string;
}

export type EventHandler = (event: OutboxDoc & { _id: unknown }) => Promise<void>;

interface Subscriber {
  key: string;
  handler: EventHandler;
}
const handlers = new Map<string, Subscriber[]>();
let anonymous = 0;

/**
 * Subscribe to an event type, or '*' for all. Modules register handlers at startup through
 * `registerSubscribers()` (one place for the api, outbox and jobs handlers). `key` identifies the
 * subscriber on the event so a retry never re-runs a handler that already succeeded.
 */
export function subscribe(type: string, handler: EventHandler, key?: string): () => void {
  const sub: Subscriber = { key: key ?? handler.name ?? `${type}#${++anonymous}`, handler };
  if (!sub.key) sub.key = `${type}#${++anonymous}`;
  const list = handlers.get(type) ?? [];
  list.push(sub);
  handlers.set(type, list);
  return () => {
    handlers.set(
      type,
      (handlers.get(type) ?? []).filter((h) => h !== sub),
    );
  };
}

export function clearSubscribers(): void {
  handlers.clear();
}

export function subscribedTypes(): string[] {
  return [...handlers.keys()];
}

/** Write the event in the same session as the business change. */
export async function publish(event: DomainEvent, session?: ClientSession): Promise<void> {
  try {
    await Outbox.create([{ ...event }], { session });
  } catch (err) {
    const e = err as { code?: number };
    if (e.code === 11000 && event.idempotencyKey) return; // already published
    throw err;
  }
}

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);

/**
 * Deliver pending events. Safe to run concurrently: each event is claimed atomically with a lease;
 * events whose lease expired (worker crashed) are reclaimed. Events with no subscriber are parked as
 * 'unhandled' and replayed as soon as a subscriber for their type registers, so a hand-off to a module
 * that does not exist yet (e.g. Finance) is never lost.
 */
export async function processOutbox(
  limit = 50,
  now = new Date(),
): Promise<{ delivered: number; failed: number; unhandled: number }> {
  let delivered = 0;
  let failed = 0;
  let unhandled = 0;
  const types = subscribedTypes();
  if (types.length) {
    // Replay for a new subscriber (review G8): only events inside the replay window; older ones are marked
    // 'expired' for a manual requeue. Replayed events keep their createdAt, and the claim below sorts by
    // createdAt, so they are delivered before any live event.
    const windowDays = await getSetting('outbox.replayWindowDays');
    const since = new Date(now.getTime() - windowDays * 86_400_000);
    const typeFilter = types.includes('*') ? {} : { type: { $in: types } };
    await Outbox.updateMany(
      { status: 'unhandled', ...typeFilter, createdAt: { $lt: since } },
      { $set: { status: 'expired' } },
    );
    await Outbox.updateMany(
      { status: 'unhandled', ...typeFilter },
      { $set: { status: 'pending', availableAt: now } },
    );
  }
  for (let i = 0; i < limit; i++) {
    const ev = await Outbox.findOneAndUpdate(
      {
        $or: [
          { status: 'pending', availableAt: { $lte: now } },
          { status: 'processing', leaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: { status: 'processing', leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, new: true },
    );
    if (!ev) break;
    const list = [...(handlers.get(ev.type) ?? []), ...(handlers.get('*') ?? [])];
    if (!list.length) {
      ev.status = 'unhandled';
      ev.leaseExpiresAt = undefined;
      await ev.save();
      unhandled++;
      continue;
    }
    try {
      const done = new Set(ev.handledBy ?? []);
      for (const sub of list) {
        if (done.has(sub.key)) continue;
        await sub.handler(ev as OutboxDoc & { _id: unknown });
        done.add(sub.key);
        await Outbox.updateOne({ _id: ev._id }, { $addToSet: { handledBy: sub.key } });
      }
      ev.handledBy = [...done];
      ev.status = 'delivered';
      ev.deliveredAt = new Date();
      ev.lastError = undefined;
      ev.leaseExpiresAt = undefined;
      await ev.save();
      delivered++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { eventId: ev._id, type: ev.type, attempt: ev.attempts, err: message },
        'outbox handler failed',
      );
      const fresh = await Outbox.findById(ev._id);
      if (!fresh) continue;
      fresh.lastError = message;
      fresh.leaseExpiresAt = undefined;
      if (fresh.attempts >= MAX_ATTEMPTS) {
        fresh.status = 'failed';
        // A hand-off that gave up is a security/integrity alert for the admins (review G8).
        await notifySystemAdmins({
          bodyAr: `فشل تسليم حدث ${fresh.type} بعد ${fresh.attempts} محاولات: ${message}`,
          link: '/admin/outbox',
          data: { kind: 'outbox.failed', eventId: String(fresh._id), type: fresh.type },
        }).catch((e) => logger.error({ err: e }, 'outbox failure alert failed'));
      } else {
        fresh.status = 'pending';
        fresh.availableAt = new Date(now.getTime() + backoffMs(fresh.attempts));
      }
      await fresh.save();
      failed++;
    }
  }
  return { delivered, failed, unhandled };
}

/** Daily purge of delivered events older than `outbox.retentionDays` (review G8). Failed, expired and unhandled events are kept. */
export async function purgeDeliveredEvents(now = new Date()): Promise<number> {
  const days = await getSetting('outbox.retentionDays');
  const before = new Date(now.getTime() - days * 86_400_000);
  const r = await Outbox.deleteMany({ status: 'delivered', deliveredAt: { $lt: before } });
  return r.deletedCount ?? 0;
}

/** Admin requeue of a failed or expired event (review G8): conditional on its status, attempts reset, audited. */
export async function requeueEvent(id: string, actor: Actor): Promise<OutboxDoc & { _id: unknown }> {
  const ev = await Outbox.findOneAndUpdate(
    { _id: id, status: { $in: ['failed', 'expired'] } },
    {
      $set: {
        status: 'pending',
        availableAt: new Date(),
        attempts: 0,
        lastError: undefined,
        leaseExpiresAt: undefined,
      },
    },
    { new: true },
  );
  if (!ev) throw conflict('الحدث غير موجود أو ليس فاشلًا');
  await recordAudit(actor, {
    action: 'update',
    resource: 'outbox',
    resourceId: String(ev._id),
    after: { status: 'pending', requeued: true, type: ev.type },
  });
  return ev as OutboxDoc & { _id: unknown };
}
