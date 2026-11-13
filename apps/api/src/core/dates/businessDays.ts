import { HIJRI_LOCALE, TIMEZONE, WEEKEND_DAYS } from '@eayni/shared';
import { Holiday } from './model';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' });
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Calendar date (YYYY-MM-DD) of an instant in Asia/Riyadh. */
export function riyadhDate(d: Date): string {
  return dayFmt.format(d);
}

export function riyadhWeekday(d: Date): number {
  return WEEKDAY_INDEX[weekdayFmt.format(d)];
}

export function isWeekend(d: Date): boolean {
  return WEEKEND_DAYS.includes(riyadhWeekday(d));
}

export async function loadHolidaySet(): Promise<Set<string>> {
  const docs = await Holiday.find().select('date').lean();
  return new Set(docs.map((h) => h.date));
}

export function isBusinessDay(d: Date, holidays: Set<string>): boolean {
  return !isWeekend(d) && !holidays.has(riyadhDate(d));
}

const DAY_MS = 86_400_000;

/**
 * Add N business days (Fri–Sat weekend + holidays skipped). The time of day is preserved.
 * N = 0 returns the same instant.
 */
export function addBusinessDays(start: Date, n: number, holidays: Set<string>): Date {
  let d = new Date(start);
  let remaining = n;
  while (remaining > 0) {
    d = new Date(d.getTime() + DAY_MS);
    if (isBusinessDay(d, holidays)) remaining -= 1;
  }
  return d;
}

/** Whole business days strictly between two instants' Riyadh dates (from excluded, to included). */
export function businessDaysBetween(from: Date, to: Date, holidays: Set<string>): number {
  if (to <= from) return 0;
  let count = 0;
  let d = new Date(from);
  const toDate = riyadhDate(to);
  while (riyadhDate(d) < toDate) {
    d = new Date(d.getTime() + DAY_MS);
    if (isBusinessDay(d, holidays)) count += 1;
  }
  return count;
}

/** Hijri rendering for display (Umm al-Qura). Dates are stored Gregorian UTC. */
export function formatHijri(d: Date): string {
  return new Intl.DateTimeFormat(HIJRI_LOCALE, {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

/** Instant at 00:00 Riyadh of the calendar day containing `d`. */
export function startOfRiyadhDay(d: Date): Date {
  const [y, m, day] = riyadhDate(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, -3)); // Riyadh is UTC+3 with no DST
}

/** Instant at 00:00 Riyadh of the Sunday starting the week containing `d` (review G11). */
export function startOfRiyadhWeek(d: Date): Date {
  const dayStart = startOfRiyadhDay(d);
  return new Date(dayStart.getTime() - riyadhWeekday(d) * 86_400_000);
}

/** First and last instant of a Riyadh calendar day given as `YYYY-MM-DD` (list date filters). */
export const riyadhDayStartOf = (day: string): Date => new Date(`${day}T00:00:00+03:00`);
export const riyadhDayEndOf = (day: string): Date => new Date(`${day}T23:59:59.999+03:00`);
/** `{ $gte, $lte }` for an inclusive window of Riyadh days, or undefined when neither end is given. */
export function riyadhDayRange(from?: string, to?: string): { $gte?: Date; $lte?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { $gte: riyadhDayStartOf(from) } : {}),
    ...(to ? { $lte: riyadhDayEndOf(to) } : {}),
  };
}
