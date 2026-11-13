import { describe, expect, it } from 'vitest';
import {
  achievementBp,
  elapsedShare,
  kpiStatus,
  kpiValue,
  periodBounds,
  periodDays,
  periodsBetween,
  riyadhPeriod,
} from './service';

/** KPI core: Riyadh periods, status and pace [CLAUDE.md "KPI framework", SAL §11]. Pure functions, no database. */
describe('KPI core', () => {
  it('uses Riyadh months: 21:00 UTC on the last day already belongs to the next month', () => {
    expect(riyadhPeriod(new Date('2026-10-31T20:59:59Z'))).toBe('2026-10');
    expect(riyadhPeriod(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11');
  });

  it('bounds a period on Riyadh midnights, December rolls to January', () => {
    const nov = periodBounds('2026-11');
    expect(nov.from.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(nov.to.toISOString()).toBe('2026-11-30T21:00:00.000Z');
    expect(periodBounds('2026-12').to.toISOString()).toBe('2026-12-31T21:00:00.000Z');
    expect(periodDays('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('lists months inclusive across a year end and caps at 24', () => {
    expect(periodsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(periodsBetween('2020-01', '2030-01')).toHaveLength(24);
    expect(periodsBetween('2027-01', '2026-01')).toEqual([]);
  });

  it('status: exactly met is achieved, beaten is exceeded, otherwise below', () => {
    expect(kpiStatus(100, 100, 'higher')).toBe('achieved');
    expect(kpiStatus(101, 100, 'higher')).toBe('exceeded');
    expect(kpiStatus(99, 100, 'higher')).toBe('below');
    // Collection days: lower is better [SAL §11 «≤ 45 يوم»].
    expect(kpiStatus(30, 45, 'lower')).toBe('exceeded');
    expect(kpiStatus(45, 45, 'lower')).toBe('achieved');
    expect(kpiStatus(60, 45, 'lower')).toBe('below');
    expect(kpiStatus(null, 45, 'lower')).toBe('no_data');
    expect(kpiStatus(10, null, 'higher')).toBe('no_target');
  });

  it('pace compares a cumulative actual with the elapsed share of the target', () => {
    const mid = new Date('2026-11-15T21:00:00Z'); // 15 of 30 days elapsed
    expect(elapsedShare('2026-11', mid)).toBeCloseTo(0.5, 5);
    const v = kpiValue(
      { code: 'sales.revenue', nameAr: '', unit: 'halalas', direction: 'higher', cumulative: true },
      400,
      1000,
      '2026-11',
      mid,
    );
    expect(v).toMatchObject({ status: 'below', expectedNow: 500, pace: 'behind' });
    const ratio = kpiValue(
      { code: 'sales.quote_conversion', nameAr: '', unit: 'bp', direction: 'higher' },
      5000,
      4000,
      '2026-11',
      mid,
    );
    expect(ratio.status).toBe('exceeded');
    expect(ratio.pace).toBeUndefined();
  });

  it('achievement in basis points, none without a target', () => {
    expect(achievementBp(7500, 10_000)).toBe(7500);
    expect(achievementBp(5, 0)).toBeNull();
    expect(achievementBp(5, null)).toBeNull();
  });
});
