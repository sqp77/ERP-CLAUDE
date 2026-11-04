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

const handlers = new Map<string, EventHandler[]>();

/** Subscribe to an event type, or '*' for all. Modules register handlers at startup. */
export function subscribe(type: string, handler: EventHandler): () => void {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
  return () => {
    handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
  };
}

export function clearSubscribers(): void {
  handlers.clear();
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
const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);

/** Deliver pending events. Safe to run concurrently: each event is claimed atomically. */
export async function processOutbox(limit = 50, now = new Date()): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const ev = await Outbox.findOneAndUpdate(
      { status: 'pending', availableAt: { $lte: now } },
      { $set: { status: 'processing' }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, new: true },
    );
    if (!ev) break;
    const list = [...(handlers.get(ev.type) ?? []), ...(handlers.get('*') ?? [])];
    try {
      for (const h of list) await h(ev as OutboxDoc & { _id: unknown });
      ev.status = 'delivered';
      ev.deliveredAt = new Date();
      ev.lastError = undefined;
      await ev.save();
      delivered++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ eventId: ev._id, type: ev.type, attempt: ev.attempts, err: message }, 'outbox handler failed');
      ev.lastError = message;
      if (ev.attempts >= MAX_ATTEMPTS) ev.status = 'failed';
      else {
        ev.status = 'pending';
        ev.availableAt = new Date(now.getTime() + backoffMs(ev.attempts));
      }
      await ev.save();
      failed++;
    }
  }
  return { delivered, failed };
}
