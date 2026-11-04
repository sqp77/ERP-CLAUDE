import { notify } from '../notifications/service';
import { CalendarEvent } from './model';

/** Reminders before events [EP §13.10, §15.5]. Each reminder offset fires once. */
export async function runEventReminders(now = new Date()): Promise<number> {
  const windowEnd = new Date(now.getTime() + 24 * 3_600_000);
  const events = await CalendarEvent.find({ deletedAt: null, status: 'scheduled', startAt: { $gt: now, $lte: windowEnd } });
  let sent = 0;
  for (const ev of events) {
    const minutesLeft = (ev.startAt.getTime() - now.getTime()) / 60_000;
    for (const m of ev.reminderMinutes) {
      if (minutesLeft <= m && !ev.remindersSent.includes(m)) {
        const ids = [String(ev.ownerId), ...ev.participantIds.map(String)];
        await notify({ userIds: ids, type: 'meeting.reminder', bodyAr: ev.title, link: `/calendar?event=${ev._id}` });
        ev.remindersSent.push(m);
        sent++;
      }
    }
    if (ev.isModified()) await ev.save();
  }
  return sent;
}
