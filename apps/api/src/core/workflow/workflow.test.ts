import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { applyTransition, availableTransitions, getWorkflow, initWorkflow, stageHistory } from './engine';
import { riyadhDate } from '../dates/businessDays';

const actor = { userId: 'u1', email: 'u1@eayni.local', roleCodes: ['employee'] };

describe('workflow engine [EP §9.4, HR §3.5]', () => {
  it('initialises a ticket with the first state and an SLA due date in business days', async () => {
    const def = await getWorkflow('ticket');
    const f = await initWorkflow(def, new Date('2026-11-05T06:00:00Z')); // Thursday
    expect(f.state).toBe('new');
    expect(riyadhDate(f.dueAt!)).toBe('2026-11-08'); // +1 business day skips Fri/Sat
  });

  it('refuses transitions from the wrong state, by the wrong actor, or with missing fields', async () => {
    const def = await getWorkflow('ticket');
    const record = { _id: new Types.ObjectId(), number: 'TKT-2026-00001', ...(await initWorkflow(def)) };
    await expect(applyTransition({ def, record, recordType: 'ticket', transition: 'close', actor, actorRelations: ['requester'] })).rejects.toMatchObject({ status: 400 });
    await expect(applyTransition({ def, record, recordType: 'ticket', transition: 'assign', actor, actorRelations: ['requester'] })).rejects.toMatchObject({ status: 403 });
    await expect(applyTransition({ def, record, recordType: 'ticket', transition: 'assign', actor, actorRelations: ['department_manager'] })).rejects.toMatchObject({ status: 400, details: { missing: ['assigneeId'] } });
  });

  it('runs the full ticket path: only the requester closes, reopening needs a reason, stage log is appended', async () => {
    const def = await getWorkflow('ticket');
    let record: Record<string, unknown> & { state: string; stateEnteredAt: Date; dueAt?: Date | null } = { _id: new Types.ObjectId(), number: 'TKT-2026-00002', ...(await initWorkflow(def)) };
    const step = async (transition: string, rel: string[], extra: Record<string, unknown> = {}) => {
      const r = await applyTransition({ def, record, recordType: 'ticket', transition, actor, actorRelations: rel, payload: extra, reason: extra.reason as string | undefined });
      record = { ...record, ...extra, ...r.fields };
      return r;
    };
    await step('assign', ['department_staff'], { assigneeId: 'u9' });
    expect(record.state).toBe('in_progress');
    await step('resolve', ['assignee'], { resolution: 'تم' });
    // The receiving department can't close it finally [EP §9.4].
    await expect(step('close', ['assignee', 'department_manager'])).rejects.toMatchObject({ status: 403 });
    await expect(step('reopen', ['requester'])).rejects.toMatchObject({ status: 400 });
    await step('reopen', ['requester'], { reason: 'لم تُحل المشكلة' });
    expect(record.state).toBe('reopened');
    await step('resolve', ['assignee'], { resolution: 'تم فعلًا' });
    const closed = await step('close', ['requester']);
    expect(closed.category).toBe('done');
    expect(record.closedAt).toBeTruthy();
    expect(record.dueAt).toBeNull();
    const history = await stageHistory('ticket', String(record._id));
    expect(history.map((h) => h.toState)).toEqual(['in_progress', 'resolved', 'reopened', 'resolved', 'closed']);
    expect(availableTransitions(def, 'closed', ['requester']).map((t) => t.code)).toEqual(['reopen']);
  });

  it('marks a stage as overdue when its SLA passed', async () => {
    const def = await getWorkflow('ticket');
    const record = { _id: new Types.ObjectId(), ...(await initWorkflow(def, new Date('2026-10-01T06:00:00Z'))) };
    await applyTransition({ def, record, recordType: 'ticket', transition: 'review', actor, actorRelations: ['department_staff'], now: new Date('2026-10-20T06:00:00Z'), delayReason: 'ضغط عمل' });
    const [log] = await stageHistory('ticket', String(record._id));
    expect(log.overdue).toBe(true);
    expect(log.delayReason).toBe('ضغط عمل');
  });
});
