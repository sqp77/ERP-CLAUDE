import { describe, expect, it } from 'vitest';
import {
  isBirthdayToday,
  localInputToIso,
  riyadhToday,
  sameRiyadhDay,
  startOfRiyadhDay,
  startOfRiyadhWeek,
} from './dates';

// 2026-11-05 22:30 UTC = 2026-11-06 01:30 in Riyadh (UTC+3, no DST).
const now = new Date('2026-11-05T22:30:00Z');

describe('C13 — dates are computed in Asia/Riyadh, not in the browser or server zone', () => {
  it('datetime-local values are sent with the +03:00 offset', () => {
    expect(localInputToIso('2026-11-05T10:00')).toBe('2026-11-05T10:00:00+03:00');
    expect(localInputToIso('')).toBeUndefined();
    expect(new Date(localInputToIso('2026-11-05T10:00')!).toISOString()).toBe('2026-11-05T07:00:00.000Z');
  });
  it('today, day start and week start follow the Riyadh calendar day', () => {
    expect(riyadhToday(now)).toBe('2026-11-06');
    expect(startOfRiyadhDay(now).toISOString()).toBe('2026-11-05T21:00:00.000Z');
    // Week starts on Sunday: 2026-11-06 is a Friday → Sunday 2026-11-01 00:00 Riyadh.
    expect(startOfRiyadhWeek(0, now).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(startOfRiyadhWeek(1, now).toISOString()).toBe('2026-11-07T21:00:00.000Z');
  });
  it('birthday and same-day checks use the Riyadh date', () => {
    expect(isBirthdayToday('1990-11-06', now)).toBe(true);
    expect(isBirthdayToday('1990-11-05', now)).toBe(false);
    expect(sameRiyadhDay('2026-11-05T21:30:00Z', now)).toBe(true);
    expect(sameRiyadhDay('2026-11-05T20:59:00Z', now)).toBe(false);
  });
});
