import type { AuthedRequest } from '../http/context';

/**
 * Extra calendar items besides stored events [EP §13.4–13.7]: tasks due, secondments, trainings, visits
 * from their own modules. Each source returns read-only items for the viewer and range.
 */
export interface CalendarItem {
  _id: string;
  title: string;
  type: string;
  status: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  readOnly: true;
  location?: string;
  link?: { type: string; id: string; label?: string };
}
export type CalendarSource = (req: AuthedRequest, from: Date, to: Date) => Promise<CalendarItem[]>;
const sources = new Map<string, CalendarSource>();
export function registerCalendarSource(name: string, fn: CalendarSource): void {
  sources.set(name, fn);
}
export async function collectCalendarItems(req: AuthedRequest, from: Date, to: Date, only?: string[]) {
  const out: CalendarItem[] = [];
  for (const [name, fn] of sources) {
    if (only && !only.includes(name)) continue;
    out.push(...(await fn(req, from, to)));
  }
  return out;
}
