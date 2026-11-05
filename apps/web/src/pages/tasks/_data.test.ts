import { describe, expect, it } from 'vitest';
import { awayNotice, taskTone } from './_data';

const now = new Date('2026-11-05T09:00:00Z');

describe('task colours per MKT §11', () => {
  it('red late, orange high priority, blue in progress, green done, grey not started', () => {
    expect(taskTone({ status: 'in_progress', priority: 'medium', dueAt: '2026-11-01T09:00:00Z' }, now)).toBe(
      'red',
    );
    expect(taskTone({ status: 'late', priority: 'low', dueAt: null }, now)).toBe('red');
    expect(taskTone({ status: 'new', priority: 'high', dueAt: '2026-11-09T09:00:00Z' }, now)).toBe('orange');
    expect(taskTone({ status: 'in_progress', priority: 'medium', dueAt: null }, now)).toBe('blue');
    expect(taskTone({ status: 'done', priority: 'urgent', dueAt: '2026-11-01T09:00:00Z' }, now)).toBe(
      'green',
    );
    expect(taskTone({ status: 'new', priority: 'low', dueAt: null }, now)).toBe('grey');
  });
});

describe('away notice before assigning (follow-up 3)', () => {
  it('reports leave or secondment with the end date, nothing for on-duty staff', () => {
    expect(awayNotice({ status: 'on_leave', awayKind: 'on_leave', awayUntil: '2026-11-20' })).toEqual({
      kind: 'on_leave',
      until: '2026-11-20',
    });
    expect(
      awayNotice({ status: 'seconded', awayKind: 'seconded', awayUntil: '2026-12-15T00:00:00.000Z' })?.kind,
    ).toBe('seconded');
    expect(awayNotice({ status: 'on_leave', awayKind: null, awayUntil: null })).toEqual({
      kind: 'on_leave',
      until: null,
    });
    expect(awayNotice({ status: 'active', awayKind: null, awayUntil: null })).toBeNull();
  });
});
