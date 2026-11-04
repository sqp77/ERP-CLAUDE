import { describe, expect, it } from 'vitest';
import { getSetting, listSettings, setSetting } from './service';
import { SYSTEM_ACTOR } from '../http/context';
import { AuditLog } from '../audit/model';

describe('settings registry [golden rule 10]', () => {
  it('returns registry defaults, validates overrides and audits changes', async () => {
    expect(await getSetting('tickets.autoCloseAfterBusinessDays')).toBe(5);
    expect(await getSetting('hr.advanceLimitHalalas')).toBeNull();
    await expect(setSetting('tickets.autoCloseAfterBusinessDays', -1, SYSTEM_ACTOR)).rejects.toMatchObject({ status: 400 });
    await setSetting('tickets.autoCloseAfterBusinessDays', 7, SYSTEM_ACTOR);
    expect(await getSetting('tickets.autoCloseAfterBusinessDays')).toBe(7);
    const row = (await listSettings()).find((s) => s.key === 'tickets.autoCloseAfterBusinessDays');
    expect(row).toMatchObject({ value: 7, default: 5, isDefault: false });
    expect(await AuditLog.countDocuments({ resource: 'settings' })).toBe(1);
  });
});
