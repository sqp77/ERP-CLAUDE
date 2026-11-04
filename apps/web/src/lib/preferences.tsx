import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { HIJRI_LOCALE, TIMEZONE } from '@eayni/shared';

type CalendarKind = 'gregorian' | 'hijri';

interface Prefs {
  calendar: CalendarKind;
  setCalendar: (c: CalendarKind) => void;
  formatDate: (d: Date | string | undefined | null, opts?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (d: Date | string | undefined | null) => string;
}

const Ctx = createContext<Prefs | null>(null);
const KEY = 'eayni.calendar';

/** Gregorian/Hijri toggle [EP §13.1–13.2]. Stored per browser; dates are always Gregorian UTC on the wire. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [calendar, setCal] = useState<CalendarKind>(() => {
    try {
      return (localStorage.getItem(KEY) as CalendarKind) || 'gregorian';
    } catch {
      return 'gregorian';
    }
  });
  const value = useMemo<Prefs>(() => {
    const locale = calendar === 'hijri' ? HIJRI_LOCALE : 'ar-SA-u-ca-gregory-nu-latn';
    const fmt = (d: Date | string | undefined | null, opts: Intl.DateTimeFormatOptions) =>
      d ? new Intl.DateTimeFormat(locale, { timeZone: TIMEZONE, ...opts }).format(new Date(d)) : '';
    return {
      calendar,
      setCalendar: (c) => {
        setCal(c);
        try {
          localStorage.setItem(KEY, c);
        } catch {
          /* ignore */
        }
      },
      formatDate: (d, opts) => fmt(d, opts ?? { dateStyle: 'medium' }),
      formatDateTime: (d) => fmt(d, { dateStyle: 'medium', timeStyle: 'short' }),
    };
  }, [calendar]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs outside PreferencesProvider');
  return v;
}
