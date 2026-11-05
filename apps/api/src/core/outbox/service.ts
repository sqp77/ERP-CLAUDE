import type { ClientSession } from 'mongoose';
import { logger } from '../../logger';
import { Outbox, type OutboxDoc } from './model';

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
    await Outbox.updateMany(
      { status: 'unhandled', ...(types.includes('*') ? {} : { type: { $in: types } }) },
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
      if (fresh.attempts >= MAX_ATTEMPTS) fresh.status = 'failed';
      else {
        fresh.status = 'pending';
        fresh.availableAt = new Date(now.getTime() + backoffMs(fresh.attempts));
      }
      await fresh.save();
      failed++;
    }
  }
  return { delivered, failed, unhandled };
}
