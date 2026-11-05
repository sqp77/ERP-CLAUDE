import { describe, expect, it } from 'vitest';
import { Outbox } from './model';
import { processOutbox, publish, subscribe } from './service';

describe('outbox [CLAUDE.md Domain events]', () => {
  it('delivers events to subscribers and marks them delivered', async () => {
    const seen: string[] = [];
    subscribe('ops.visit.completed', async (e) => {
      seen.push(String(e.aggregateId));
    });
    await publish({
      type: 'ops.visit.completed',
      aggregateType: 'visit',
      aggregateId: 'v1',
      payload: { kg: 120 },
    });
    await publish({ type: 'other', payload: {} });
    const r = await processOutbox();
    expect(r).toEqual({ delivered: 1, failed: 0, unhandled: 1 });
    expect(seen).toEqual(['v1']);
    expect(await Outbox.countDocuments({ status: 'delivered' })).toBe(1);
    expect(await Outbox.countDocuments({ status: 'unhandled', type: 'other' })).toBe(1);
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
  it('B11a: an event left in "processing" by a crashed worker is reclaimed once its lease expires', async () => {
    const seen: string[] = [];
    subscribe('crash', async (e) => {
      seen.push(String(e.aggregateId));
    });
    await Outbox.create({
      type: 'crash',
      aggregateId: 'c1',
      payload: {},
      status: 'processing',
      attempts: 1,
      availableAt: new Date(0),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await Outbox.create({
      type: 'crash',
      aggregateId: 'c2',
      payload: {},
      status: 'processing',
      attempts: 1,
      availableAt: new Date(0),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const r = await processOutbox();
    expect(r.delivered).toBe(1);
    expect(seen).toEqual(['c1']);
    expect((await Outbox.findOne({ aggregateId: 'c2' }))!.status).toBe('processing');
  });

  it('B11b: events nobody handles stay "unhandled" and are replayed once a subscriber exists', async () => {
    await publish({ type: 'hr.request.handoff.finance', aggregateId: 'r1', payload: { number: 'HRQ-1' } });
    await processOutbox();
    expect((await Outbox.findOne({ aggregateId: 'r1' }))!.status).toBe('unhandled');
    const seen: string[] = [];
    subscribe('hr.request.handoff.finance', async (e) => {
      seen.push(String(e.aggregateId));
    });
    const r = await processOutbox();
    expect(r.delivered).toBe(1);
    expect(seen).toEqual(['r1']);
    expect((await Outbox.findOne({ aggregateId: 'r1' }))!.status).toBe('delivered');
  });

  it('B11c: on retry, handlers that already succeeded are not run again', async () => {
    let first = 0;
    let second = 0;
    subscribe(
      'multi',
      async () => {
        first++;
      },
      'first',
    );
    subscribe(
      'multi',
      async () => {
        second++;
        if (second === 1) throw new Error('flaky');
      },
      'second',
    );
    await publish({ type: 'multi', payload: {} });
    await processOutbox();
    await Outbox.updateMany({}, { $set: { availableAt: new Date(0) } });
    await processOutbox();
    expect(first).toBe(1);
    expect(second).toBe(2);
    const ev = await Outbox.findOne({ type: 'multi' }).lean();
    expect(ev!.status).toBe('delivered');
    expect(ev!.handledBy?.sort()).toEqual(['first', 'second']);
  });
});
