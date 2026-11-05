import { describe, expect, it } from 'vitest';
import { priorityLabel, ticketTone } from './_data';

describe('tickets UI helpers [EP §9, IT §7.1]', () => {
  it('uses the department priority wording when configured, else the general label', () => {
    const t = (k: string) => k;
    expect(priorityLabel(t, 'urgent', { fields: [], priorityLabelsAr: { urgent: 'عاجل' } })).toBe('عاجل');
    expect(priorityLabel(t, 'urgent', { fields: [] })).toBe('tasks.priorities.urgent');
    expect(ticketTone.stalled).toBe('red');
  });
});
