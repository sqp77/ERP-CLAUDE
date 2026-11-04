import { getSetting } from '../settings/service';
import { notify } from '../notifications/service';
import { Task } from './model';

/** Reminders before due and on overdue [EP §15.2, §15.3]; flags prevent repeats. */
export async function runTaskReminders(now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
  const days = await getSetting('notifications.taskReminderDaysBefore');
  const horizon = new Date(now.getTime() + days * 86_400_000);
  const open = { status: { $in: ['new', 'in_progress', 'waiting_review', 'late'] }, deletedAt: null };

  const dueSoon = await Task.find({ ...open, remindedDueSoon: false, dueAt: { $gt: now, $lte: horizon } });
  for (const t of dueSoon) {
    await notify({
      userIds: [String(t.assigneeId)],
      type: 'task.due_soon',
      bodyAr: `${t.number}: ${t.title}`,
      link: `/tasks/${t._id}`,
    });
    t.remindedDueSoon = true;
    await t.save();
  }
  const overdue = await Task.find({ ...open, remindedOverdue: false, dueAt: { $lt: now } });
  for (const t of overdue) {
    await notify({
      userIds: [String(t.assigneeId), String(t.assignerId)],
      type: 'task.overdue',
      bodyAr: `${t.number}: ${t.title}`,
      link: `/tasks/${t._id}`,
    });
    t.remindedOverdue = true;
    if (t.status !== 'waiting_review') t.status = 'late';
    await t.save();
  }
  return { dueSoon: dueSoon.length, overdue: overdue.length };
}
