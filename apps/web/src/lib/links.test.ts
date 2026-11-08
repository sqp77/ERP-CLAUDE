import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordLink } from './links';

describe('H6 — recordLink resolves every linkable record type to a served route', () => {
  it('builds paths for known types and nothing for unknown ones', () => {
    expect(recordLink('task', 'abc')).toBe('/tasks/abc');
    expect(recordLink('ticket', 'abc')).toBe('/tickets/abc');
    expect(recordLink('hr_request', 'abc')).toBe('/hr/requests/abc');
    expect(recordLink('employee_report', 'abc')).toBe('/reports/abc');
    expect(recordLink('calendar_event', 'abc')).toBe('/calendar?event=abc');
    expect(recordLink('unknown', 'abc')).toBeUndefined();
    expect(recordLink('task', undefined)).toBeUndefined();
  });
  it('every path it builds is a route the router serves', () => {
    const routerSrc = readFileSync(fileURLToPath(new URL('../router.tsx', import.meta.url)), 'utf8');
    const routes = [...routerSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    const toRegex = (route: string) => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`);
    for (const type of [
      'task',
      'ticket',
      'hr_request',
      'employee_report',
      'news',
      'employee',
      'calendar_event',
    ]) {
      const path = recordLink(type, '0123456789abcdef01234567')!.split('?')[0];
      expect(
        routes.some((r) => toRegex(r).test(path)),
        `${type} → ${path}`,
      ).toBe(true);
    }
  });
});
