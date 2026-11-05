import { describe, expect, it } from 'vitest';
import { needsSecondmentReport } from './secondment';

describe('C17 — the report upload stays available after the mission', () => {
  it('is offered while the latest secondment has no report, whatever the current status', () => {
    expect(needsSecondmentReport({ status: 'seconded', secondment: { destination: 'جدة' } })).toBe(true);
    expect(needsSecondmentReport({ status: 'active', secondment: { destination: 'جدة' } })).toBe(true);
    expect(
      needsSecondmentReport({
        status: 'active',
        secondment: { destination: 'جدة', reportedAt: '2026-11-01' },
      }),
    ).toBe(false);
    expect(needsSecondmentReport({ status: 'active' })).toBe(false);
  });
});
