import { describe, expect, it } from 'vitest';
import {
  hijriParts,
  isBirthdayToday,
  isoToLocalInput,
  localInputToIso,
  startOfRiyadhHijriMonth,
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

  it('H3: an ISO instant becomes the Riyadh datetime-local value and round-trips', () => {
    expect(isoToLocalInput('2026-11-05T22:30:00.000Z')).toBe('2026-11-06T01:30');
    expect(isoToLocalInput('2026-11-05T07:00:00Z')).toBe('2026-11-05T10:00');
    expect(isoToLocalInput('')).toBe('');
    const local = '2026-11-05T10:00';
    expect(isoToLocalInput(new Date(localInputToIso(local)!).toISOString())).toBe(local);
  });
  it('H4: the Hijri month grid starts on day 1 of the Umm al-Qura month and steps by whole months', () => {
    const start = startOfRiyadhHijriMonth(0, now);
    expect(hijriParts(start).day).toBe(1);
    expect(start <= now).toBe(true);
    const next = startOfRiyadhHijriMonth(1, now);
    expect(hijriParts(next).day).toBe(1);
    const days = Math.round((next.getTime() - start.getTime()) / 86_400_000);
    expect([29, 30]).toContain(days);
    expect(startOfRiyadhHijriMonth(-1, next).getTime()).toBe(start.getTime());
    expect(hijriParts(start).month % 12).toBe((hijriParts(next).month - 1) % 12);
  });
});
