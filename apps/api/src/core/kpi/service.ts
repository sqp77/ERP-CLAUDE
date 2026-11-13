import type { KpiStatus } from '@eayni/shared';
import { riyadhDate } from '../dates/businessDays';

/**
 * KPI framework (core, CLAUDE.md "KPI framework"): periods in Riyadh time, status against a target and pace against
 * the elapsed part of the period. Modules compute the actuals from their own data (Sales registers five computers,
 * SAL §11); nothing here is typed in by hand. Actuals are computed on read, so a card is always live.
 */

export type KpiDirection = 'higher' | 'lower';
export type KpiUnit = 'halalas' | 'kg' | 'bp' | 'days' | 'count' | 'halalas_per_ton';

export interface KpiValue {
  code: string;
  nameAr: string;
  unit: KpiUnit;
  direction: KpiDirection;
  /** null when the source data does not exist yet (e.g. no invoices from Finance). */
  actual: number | null;
  target: number | null;
  status: KpiStatus;
  /** Expected value at this point of the period (higher-is-better totals only) and whether the actual keeps up. */
  expectedNow?: number | null;
  pace?: 'ahead' | 'behind' | null;
}

/** `YYYY-MM` of a date in Riyadh time. */
export function riyadhPeriod(d = new Date()): string {
  return riyadhDate(d).slice(0, 7);
}

/** First instant of the month and first instant of the next month, Riyadh time (UTC+03:00, no DST). */
export function periodBounds(period: string): { from: Date; to: Date } {
  const [y, m] = period.split('-').map(Number);
  const from = new Date(`${period}-01T00:00:00+03:00`);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const to = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00+03:00`);
  return { from, to };
}

/** Riyadh days `YYYY-MM-DD` covering a period, inclusive — what the list filters (drill-downs) take. */
export function periodDays(period: string): { from: string; to: string } {
  const { from, to } = periodBounds(period);
  return { from: riyadhDate(from), to: riyadhDate(new Date(to.getTime() - 1)) };
}

/** Months from `from` to `to` inclusive (`YYYY-MM`), capped at 24. */
export function periodsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Share of the period already elapsed (0..1) at `now`. */
export function elapsedShare(period: string, now = new Date()): number {
  const { from, to } = periodBounds(period);
  if (now <= from) return 0;
  if (now >= to) return 1;
  return (now.getTime() - from.getTime()) / (to.getTime() - from.getTime());
}

/**
 * below / achieved / exceeded (CLAUDE.md): «تحقق» when the target is met exactly, «تجاوز» when it is beaten,
 * «أقل من المستهدف» otherwise. Lower-is-better KPIs (collection days) are met when the actual is at or under target.
 */
export function kpiStatus(actual: number | null, target: number | null, direction: KpiDirection): KpiStatus {
  if (actual === null) return 'no_data';
  if (target === null) return 'no_target';
  if (actual === target) return 'achieved';
  const better = direction === 'higher' ? actual > target : actual < target;
  return better ? 'exceeded' : 'below';
}

/** Pace for cumulative, higher-is-better KPIs: the target scaled by the elapsed share of the period. */
export function kpiPace(
  actual: number | null,
  target: number | null,
  period: string,
  now = new Date(),
): { expectedNow: number | null; pace: 'ahead' | 'behind' | null } {
  if (actual === null || target === null) return { expectedNow: null, pace: null };
  const expectedNow = Math.round(target * elapsedShare(period, now));
  return { expectedNow, pace: actual >= expectedNow ? 'ahead' : 'behind' };
}

export function kpiValue(
  def: { code: string; nameAr: string; unit: KpiUnit; direction: KpiDirection; cumulative?: boolean },
  actual: number | null,
  target: number | null,
  period: string,
  now = new Date(),
): KpiValue {
  const base: KpiValue = { ...def, actual, target, status: kpiStatus(actual, target, def.direction) };
  if (def.cumulative && def.direction === 'higher') Object.assign(base, kpiPace(actual, target, period, now));
  return base;
}

/** Achievement ratio in basis points (10000 = 100%), or null without a target. */
export function achievementBp(actual: number, target: number | null): number | null {
  if (!target) return null;
  return Math.round((actual * 10_000) / target);
}
