import { OPEN_TASK_STATUSES } from '@eayni/shared';
import { getSetting } from '../settings/service';
import { notify } from '../notifications/service';
import { addBusinessDays, isBusinessDay, loadHolidaySet, riyadhDate } from '../dates/businessDays';
import { User } from '../auth/model';
import { Task, TaskEvent } from './model';
import { recordAudit } from '../audit/service';
import { SYSTEM_ACTOR } from '../http/context';

const taskLabel = (t: { number: string; title: string }) => `${t.number}: ${t.title}`;

/** Reminders before due and on overdue [EP §15.2, §15.3]; flags prevent repeats. Assigner and assignee both hear about overdue. */
export async function runTaskReminders(now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
  const days = await getSetting('notifications.taskReminderDaysBefore');
  const horizon = new Date(now.getTime() + days * 86_400_000);
  const open = { status: { $in: [...OPEN_TASK_STATUSES] }, deletedAt: null };

  const dueSoon = await Task.find({ ...open, remindedDueSoon: false, dueAt: { $gt: now, $lte: horizon } });
  for (const t of dueSoon) {
    const ids = [t.assigneeId ? String(t.assigneeId) : String(t.assignerId)];
    await notify({ userIds: ids, type: 'task.due_soon', bodyAr: taskLabel(t), link: `/tasks/${t._id}` });
    t.remindedDueSoon = true;
    await t.save();
  }
  const overdue = await Task.find({ ...open, remindedOverdue: false, dueAt: { $lt: now } });
  let flipped = 0;
  for (const t of overdue) {
    // Conditional on the status read (review G1): a task finished between load and write stays finished.
    const from = t.status;
    const toLate = from !== 'waiting_review';
    const r = await Task.updateOne(
      { _id: t._id, status: from, dueAt: { $lt: now } },
      { $set: toLate ? { remindedOverdue: true, status: 'late' } : { remindedOverdue: true } },
    );
    if (!r.modifiedCount) continue;
    flipped++;
    const ids = [
      ...new Set([t.assigneeId ? String(t.assigneeId) : '', String(t.assignerId)].filter(Boolean)),
    ];
    await notify({ userIds: ids, type: 'task.overdue', bodyAr: taskLabel(t), link: `/tasks/${t._id}` });
    if (toLate) {
      await TaskEvent.create({
        taskId: t._id,
        type: 'status_changed',
        fromStatus: from,
        toStatus: 'late',
        note: 'overdue',
        actorEmail: SYSTEM_ACTOR.email,
      });
      await recordAudit(SYSTEM_ACTOR, {
        action: 'update',
        resource: 'tasks',
        resourceId: String(t._id),
        before: { status: from },
        after: { status: 'late' },
        meta: { job: 'tasks.reminders' },
      });
    }
  }
  return { dueSoon: dueSoon.length, overdue: flipped };
}

/** Department managers of a department: role scoped to it, or the role without a department on a user of that department. */
export async function departmentManagerUserIds(departmentId: string): Promise<string[]> {
  const users = await User.find({
    status: 'active',
    deletedAt: null,
    $or: [
      { roles: { $elemMatch: { role: 'department_manager', departmentId } } },
      { departmentId, roles: { $elemMatch: { role: 'department_manager', departmentId: null } } },
    ],
  })
    .select('_id')
    .lean();
  return users.map((u) => String(u._id));
}

/**
 * Queue tasks nobody picked up: remind the department's managers once the task is older than
 * `tasks.unassignedReminderBusinessDays`, and again each day it stays unassigned [EP §16].
 */
export async function runUnassignedTaskReminders(now = new Date()): Promise<number> {
  const days = await getSetting('tasks.unassignedReminderBusinessDays');
  const holidays = await loadHolidaySet();
  // Once per Riyadh business day (review F3): nothing on Fri/Sat or holidays, date-based not "24 h since".
  if (!isBusinessDay(now, holidays)) return 0;
  const today = riyadhDate(now);
  const queued = await Task.find({ assigneeId: null, status: { $in: ['new', 'late'] }, deletedAt: null }); // G1: late queue tasks too
  let sent = 0;
  for (const t of queued) {
    const due = addBusinessDays(t.createdAt as Date, days, holidays);
    if (now < due) continue;
    if (t.remindedUnassignedOn === today) continue;
    const managers = await departmentManagerUserIds(String(t.departmentId));
    if (managers.length) {
      await notify({
        userIds: managers,
        type: 'task.unassigned_reminder',
        bodyAr: taskLabel(t),
        link: '/tasks/board',
        data: { taskId: String(t._id), departmentId: String(t.departmentId) },
      });
      sent++;
    }
    t.remindedUnassignedOn = today;
    await t.save();
  }
  return sent;
}
