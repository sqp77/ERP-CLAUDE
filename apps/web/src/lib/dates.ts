import { TIMEZONE } from '@eayni/shared';

/**
 * Calendar-day helpers pinned to Asia/Riyadh (review C13). The app runs in browsers and Lambdas in
 * other zones; Riyadh has a fixed +03:00 offset and no DST, so day boundaries are 21:00 UTC.
 */
const OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** `datetime-local` value ("YYYY-MM-DDTHH:mm") → ISO string with the Riyadh offset, or undefined when empty. */
export function localInputToIso(value?: string | null): string | undefined {
  if (!value) return undefined;
  return `${value.length === 16 ? `${value}:00` : value}+03:00`;
}

/** ISO instant → `datetime-local` value ("YYYY-MM-DDTHH:mm") in Riyadh time (review H3). Round-trips with `localInputToIso`. */
export function isoToLocalInput(iso?: string | Date | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

/** Riyadh calendar parts of an instant. */
export function riyadhParts(d: Date | string | number = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(d));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/** "YYYY-MM-DD" of today in Riyadh — the right default for date inputs. */
export function riyadhToday(now: Date = new Date()): string {
  const { year, month, day } = riyadhParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Instant at 00:00 Riyadh of the day containing `d`. */
export function startOfRiyadhDay(d: Date | string | number = new Date()): Date {
  const { year, month, day } = riyadhParts(d);
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

/** Instant at 00:00 Riyadh of the Sunday starting the week that contains `now`, shifted by `offset` weeks. */
export function startOfRiyadhWeek(offset = 0, now: Date = new Date()): Date {
  const dayStart = startOfRiyadhDay(now);
  const weekday = new Date(dayStart.getTime() + OFFSET_MS).getUTCDay(); // 0 = Sunday
  return new Date(dayStart.getTime() - weekday * DAY_MS + offset * 7 * DAY_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function sameRiyadhDay(a: Date | string, b: Date | string = new Date()): boolean {
  return riyadhToday(new Date(a)) === riyadhToday(new Date(b));
}

export function isBirthdayToday(birthDate?: string | null, now: Date = new Date()): boolean {
  if (!birthDate) return false;
  const b = riyadhParts(birthDate);
  const t = riyadhParts(now);
  return b.month === t.month && b.day === t.day;
}

/** Hijri (Umm al-Qura) calendar parts of an instant in Riyadh. */
export function hijriParts(d: Date | string | number = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura-nu-latn', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(d));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/**
 * Instant at 00:00 Riyadh of the first day of the Hijri month containing `now`, shifted by `offset`
 * months (review H4): the month grid and its title agree when the Hijri calendar is selected.
 */
export function startOfRiyadhHijriMonth(offset = 0, now: Date = new Date()): Date {
  let start = startOfRiyadhDay(now);
  while (hijriParts(start).day !== 1) start = addDays(start, -1);
  for (let i = 0; i < Math.abs(offset); i++) {
    if (offset > 0) {
      start = addDays(start, 28);
      while (hijriParts(start).day !== 1) start = addDays(start, 1);
    } else {
      start = addDays(start, -1);
      while (hijriParts(start).day !== 1) start = addDays(start, -1);
    }
  }
  return start;
}
