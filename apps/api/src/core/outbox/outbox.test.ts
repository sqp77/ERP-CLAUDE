import { describe, expect, it } from 'vitest';
import { Outbox } from './model';
import { processOutbox, publish, subscribe } from './service';

describe('outbox [CLAUDE.md Domain events]', () => {
  it('delivers events to subscribers and marks them delivered', async () => {
    const seen: string[] = [];
    subscribe('ops.visit.completed', async (e) => {
      seen.push(String(e.aggregateId));
    });
    await publish({ type: 'ops.visit.completed', aggregateType: 'visit', aggregateId: 'v1', payload: { kg: 120 } });
    await publish({ type: 'other', payload: {} });
    const r = await processOutbox();
    expect(r).toEqual({ delivered: 2, failed: 0 });
    expect(seen).toEqual(['v1']);
    expect(await Outbox.countDocuments({ status: 'delivered' })).toBe(2);
  });

  it('retries failed handlers with backoff and gives up after 5 attempts', async () => {
    let calls = 0;
    subscribe('boom', async () => {
      calls++;
      throw new Error('handler down');
    });
    await publish({ type: 'boom', payload: {} });
    for (let i = 0; i < 5; i++) {
      await Outbox.updateMany({}, { $set: { availableAt: new Date(0) } });
      await processOutbox();
    }
    const ev = await Outbox.findOne({ type: 'boom' }).lean();
    expect(calls).toBe(5);
    expect(ev?.status).toBe('failed');
    expect(ev?.lastError).toBe('handler down');
  });

  it('ignores duplicate idempotency keys', async () => {
    await publish({ type: 'x', payload: {}, idempotencyKey: 'k1' });
    await publish({ type: 'x', payload: {}, idempotencyKey: 'k1' });
    expect(await Outbox.countDocuments({ type: 'x' })).toBe(1);
  });
});
