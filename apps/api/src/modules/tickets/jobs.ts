import { addBusinessDays, loadHolidaySet } from '../../core/dates/businessDays';
import { getSetting } from '../../core/settings/service';
import { notify } from '../../core/notifications/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { Ticket } from './model';
import { transition } from './service';

/**
 * After تم الحل (DECISIONS §8): remind the requester after N business days (state → بانتظار تأكيد مقدم
 * الطلب), auto-close after M business days with a notification; reopening stays possible for K days.
 */
export async function runTicketFollowUps(now = new Date()): Promise<{ reminded: number; autoClosed: number }> {
  const [remindDays, closeDays, holidays] = await Promise.all([
    getSetting('tickets.remindAfterBusinessDays'),
    getSetting('tickets.autoCloseAfterBusinessDays'),
    loadHolidaySet(),
  ]);
  let reminded = 0;
  let autoClosed = 0;
  const pending = await Ticket.find({ state: { $in: ['resolved', 'awaiting_confirmation'] }, resolvedAt: { $ne: null }, deletedAt: null });
  for (const t of pending) {
    const resolvedAt = t.resolvedAt!;
    if (now >= addBusinessDays(resolvedAt, closeDays, holidays)) {
      await transition(t, 'close', { actor: SYSTEM_ACTOR, relations: ['system'], input: {} });
      autoClosed++;
      continue;
    }
    if (t.state === 'resolved' && !t.confirmReminderSentAt && now >= addBusinessDays(resolvedAt, remindDays, holidays)) {
      const moved = await transition(t, 'ask_confirmation', { actor: SYSTEM_ACTOR, relations: ['system'], input: {} });
      await Ticket.updateOne({ _id: moved._id }, { $set: { confirmReminderSentAt: now } });
      await notify({
        userIds: [String(t.requesterUserId)],
        type: 'ticket.confirm_reminder',
        bodyAr: `${t.number} — ${t.subject}: أكّد الحل أو أعد فتح التذكرة خلال ${closeDays - remindDays} أيام عمل`,
        link: `/tickets/${t._id}`,
      });
      reminded++;
    }
  }
  return { reminded, autoClosed };
}
