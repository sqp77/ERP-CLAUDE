import { describe, expect, it } from 'vitest';
import { addBusinessDays, businessDaysBetween, formatHijri, isWeekend, loadHolidaySet, riyadhDate } from './businessDays';
import { Holiday } from './model';

describe('business days [CLAUDE.md Business days, SAL §6.1]', () => {
  it('treats Friday and Saturday as weekend in Asia/Riyadh', () => {
    expect(isWeekend(new Date('2026-11-06T08:00:00Z'))).toBe(true); // Friday
    expect(isWeekend(new Date('2026-11-07T08:00:00Z'))).toBe(true); // Saturday
    expect(isWeekend(new Date('2026-11-08T08:00:00Z'))).toBe(false); // Sunday
    // 21:30 UTC Thursday = 00:30 Friday in Riyadh
    expect(isWeekend(new Date('2026-11-05T21:30:00Z'))).toBe(true);
  });

  it('adds business days skipping weekend and holidays', async () => {
    await Holiday.create({ date: '2026-11-09', nameAr: 'عطلة تجريبية' }); // Monday
    const holidays = await loadHolidaySet();
    // Wednesday 2026-11-04 + 3 business days → Thu 5, (Fri/Sat skipped), Sun 8, (Mon 9 holiday), Tue 10
    const due = addBusinessDays(new Date('2026-11-04T06:00:00Z'), 3, holidays);
    expect(riyadhDate(due)).toBe('2026-11-10');
    expect(businessDaysBetween(new Date('2026-11-04T06:00:00Z'), due, holidays)).toBe(3);
  });

  it('renders Hijri (Umm al-Qura) dates', () => {
    const s = formatHijri(new Date('2026-11-04T06:00:00Z'));
    expect(s).toMatch(/١٤٤٨|1448/);
  });
});
