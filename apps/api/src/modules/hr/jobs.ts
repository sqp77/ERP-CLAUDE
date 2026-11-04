import { getSetting } from '../../core/settings/service';
import { notify } from '../../core/notifications/service';
import { User } from '../../core/auth/model';
import { revokeAllSessions } from '../../core/auth/session';
import { addBusinessDays, loadHolidaySet, riyadhDate } from '../../core/dates/businessDays';
import { Contract, Employee } from './model';
import { hrUserIds } from './service';

const DAY = 86_400_000;

/** Contract end alerts to HR and the employee at each offset [HR §3.9, EP §6.7, EP §15.10]; expired contracts flip status. */
export async function runContractAlerts(now = new Date()): Promise<{ alerts: number; expired: number }> {
  const offsets = await getSetting('documents.expiryAlertOffsetsDays');
  const horizon = new Date(now.getTime() + (Math.max(...offsets) + 1) * DAY);
  const hr = await hrUserIds();
  let alerts = 0;
  const contracts = await Contract.find({
    status: { $in: ['active', 'renewing'] },
    endDate: { $ne: null, $lte: horizon },
  });
  for (const c of contracts) {
    const daysLeft = Math.ceil((c.endDate!.getTime() - now.getTime()) / DAY);
    const emp = await Employee.findById(c.employeeId).select('userId fullNameAr').lean();
    for (const o of offsets) {
      if (daysLeft <= o && !c.alertsSent.includes(o)) {
        const ids = [...hr, ...(emp?.userId ? [String(emp.userId)] : [])];
        await notify({
          userIds: ids,
          type: 'contract.expiring',
          bodyAr: `عقد ${emp?.fullNameAr ?? ''} (${c.number}) ينتهي خلال ${Math.max(daysLeft, 0)} يومًا`,
          link: `/hr/employees/${c.employeeId}`,
        });
        c.alertsSent.push(o);
        alerts++;
      }
    }
    if (c.isModified()) await c.save();
  }
  const expired = await Contract.updateMany(
    { status: 'active', endDate: { $lt: now } },
    { $set: { status: 'expired', statusReason: 'end_date_passed' } },
  );
  return { alerts, expired: expired.modifiedCount };
}

/** Probation end alerts at each configured offset (default 30 and 7 days) [EP §6.5–6.6, EP §15.11]. */
export async function runProbationAlerts(now = new Date()): Promise<number> {
  const offsets = await getSetting('hr.probationAlertDaysBefore');
  const horizon = new Date(now.getTime() + (Math.max(...offsets, 0) + 1) * DAY);
  const contracts = await Contract.find({ status: 'active', probationEndDate: { $gte: now, $lte: horizon } });
  const hr = await hrUserIds();
  let sent = 0;
  for (const c of contracts) {
    const daysLeft = Math.ceil((c.probationEndDate!.getTime() - now.getTime()) / DAY);
    for (const o of offsets) {
      if (daysLeft <= o && !c.probationAlertsSent.includes(o)) {
        const emp = await Employee.findById(c.employeeId).select('userId fullNameAr directManagerId').lean();
        const manager = emp?.directManagerId
          ? await Employee.findById(emp.directManagerId).select('userId').lean()
          : null;
        const ids = [
          ...hr,
          ...(emp?.userId ? [String(emp.userId)] : []),
          ...(manager?.userId ? [String(manager.userId)] : []),
        ];
        await notify({
          userIds: ids,
          type: 'probation.ending',
          bodyAr: `تنتهي فترة تجربة ${emp?.fullNameAr ?? ''} خلال ${Math.max(daysLeft, 0)} يومًا (${c.probationEndDate!.toISOString().slice(0, 10)})`,
          link: `/hr/employees/${c.employeeId}`,
        });
        c.probationAlertsSent.push(o);
        sent++;
      }
    }
    if (c.isModified()) await c.save();
  }
  return sent;
}

/**
 * End of service: disable the portal account once the last working day (employee.endDate, Asia/Riyadh)
 * is over [EP §3.10, DECISIONS §11.3]. Runs daily; idempotent.
 */
export async function runAccountDeactivation(now = new Date()): Promise<number> {
  const today = riyadhDate(now);
  const leavers = await Employee.find({
    deletedAt: null,
    status: { $in: ['terminated', 'resigned'] },
    endDate: { $ne: null },
    accountDisabledAt: null,
    userId: { $ne: null },
  });
  let disabled = 0;
  for (const e of leavers) {
    if (riyadhDate(e.endDate!) >= today) continue; // last working day not over yet
    await User.updateOne(
      { _id: e.userId, status: 'active' },
      { $set: { status: 'disabled', disabledAt: now, disabledReason: 'end_of_service' } },
    );
    await revokeAllSessions(String(e.userId), 'end_of_service');
    e.accountDisabledAt = now;
    await e.save();
    disabled++;
  }
  return disabled;
}

/** Identity / iqama expiry alerts [HR §3.9, EP §5.2]. */
export async function runIdentityAlerts(now = new Date()): Promise<number> {
  const offsets = await getSetting('documents.expiryAlertOffsetsDays');
  const horizon = new Date(now.getTime() + (Math.max(...offsets) + 1) * DAY);
  const hr = await hrUserIds();
  let sent = 0;
  const employees = await Employee.find({
    deletedAt: null,
    status: { $nin: ['terminated', 'resigned'] },
    'identity.expiryDate': { $ne: null, $lte: horizon },
  });
  for (const e of employees) {
    const identity = e.identity;
    if (!identity?.expiryDate) continue;
    const daysLeft = Math.ceil((identity.expiryDate.getTime() - now.getTime()) / DAY);
    for (const o of offsets) {
      if (daysLeft <= o && !identity.alertsSent.includes(o)) {
        await notify({
          userIds: [...hr, ...(e.userId ? [String(e.userId)] : [])],
          type: 'document.expiring',
          bodyAr: `تنتهي هوية/إقامة ${e.fullNameAr} خلال ${Math.max(daysLeft, 0)} يومًا`,
          link: `/hr/employees/${e._id}`,
        });
        identity.alertsSent.push(o);
        sent++;
      }
    }
    if (e.isModified()) await e.save();
  }
  return sent;
}

/** Birthday greeting notification once a year [EP §5.1, EP §15.12]. */
export async function runBirthdayGreetings(now = new Date()): Promise<number> {
  const today = riyadhDate(now); // YYYY-MM-DD
  const [year, month, day] = today.split('-');
  const employees = await Employee.find({
    deletedAt: null,
    status: { $nin: ['terminated', 'resigned'] },
    birthDate: { $ne: null },
    userId: { $ne: null },
  })
    .select('birthDate userId fullNameAr lastBirthdayYear')
    .lean();
  let sent = 0;
  for (const e of employees) {
    const b = riyadhDate(e.birthDate!);
    if (b.slice(5) !== `${month}-${day}`) continue;
    if ((e as { lastBirthdayYear?: number }).lastBirthdayYear === Number(year)) continue;
    await notify({
      userIds: [String(e.userId)],
      type: 'employee.birthday',
      bodyAr: `كل عام وأنت بخير ${e.fullNameAr}، نتمنى لك عامًا سعيدًا`,
      link: '/',
    });
    await Employee.updateOne({ _id: e._id }, { $set: { lastBirthdayYear: Number(year) } });
    sent++;
  }
  return sent;
}

/**
 * Secondment report reminders [EP §5.3, EP §15.14]: the first on the day after the end date, the second
 * N business days after the first (both settings). Stops once the report is uploaded.
 */
export async function runSecondmentReportReminders(now = new Date()): Promise<number> {
  const firstDays = await getSetting('hr.secondmentReportFirstReminderDays');
  const secondBiz = await getSetting('hr.secondmentReportSecondReminderBusinessDays');
  const holidays = await loadHolidaySet();
  const employees = await Employee.find({
    deletedAt: null,
    'secondment.endDate': { $ne: null, $lt: now },
    'secondment.reportedAt': null,
    userId: { $ne: null },
  });
  let sent = 0;
  for (const e of employees) {
    const sec = e.secondment!;
    const firstDue = new Date(sec.endDate!.getTime() + firstDays * DAY);
    const secondDue = addBusinessDays(firstDue, secondBiz, holidays);
    const stages: [number, Date][] = [
      [1, firstDue],
      [2, secondDue],
    ];
    for (const [stage, due] of stages) {
      if (now >= due && !sec.remindersSent.includes(stage)) {
        await notify({
          userIds: [String(e.userId)],
          type: 'secondment.report_reminder',
          bodyAr: `يرجى رفع تقرير الانتداب إلى ${sec.destination} الذي انتهى في ${riyadhDate(sec.endDate!)}`,
          link: '/me/profile',
        });
        sec.remindersSent.push(stage);
        sent++;
      }
    }
    if (e.isModified()) await e.save();
  }
  return sent;
}
