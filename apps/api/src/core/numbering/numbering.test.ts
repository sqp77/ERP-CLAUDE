import { describe, expect, it } from 'vitest';
import { nextNumber } from './service';

describe('numbering [CLAUDE.md Numbering]', () => {
  it('issues PREFIX-YYYY-##### sequentially per prefix and year', async () => {
    const now = new Date('2026-11-04T09:00:00Z');
    expect(await nextNumber('ticket', undefined, now)).toBe('TKT-2026-00001');
    expect(await nextNumber('ticket', undefined, now)).toBe('TKT-2026-00002');
    expect(await nextNumber('hrRequest', undefined, now)).toBe('HRQ-2026-00001');
    expect(await nextNumber('ticket', undefined, new Date('2027-01-01T00:00:00Z'))).toBe('TKT-2027-00001');
  });

  it('never duplicates under concurrency', async () => {
    const numbers = await Promise.all(Array.from({ length: 40 }, () => nextNumber('task')));
    expect(new Set(numbers).size).toBe(40);
  });

  it('uses the Riyadh calendar year at the boundary', async () => {
    // 2026-12-31 22:30 UTC is already 2027-01-01 01:30 in Asia/Riyadh.
    expect(await nextNumber('event', undefined, new Date('2026-12-31T22:30:00Z'))).toBe('EVT-2027-00001');
  });
});
