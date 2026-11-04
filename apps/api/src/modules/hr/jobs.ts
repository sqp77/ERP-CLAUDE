import { getSetting } from '../../core/settings/service';
import { notify } from '../../core/notifications/service';
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

/** Probation end alert 7 days before [EP §6.5–6.6, EP §15.11]. */
export async function runProbationAlerts(now = new Date()): Promise<number> {
  const contracts = await Contract.find({
    status: 'active',
    probationAlertSent: false,
    probationEndDate: { $gte: now, $lte: new Date(now.getTime() + 7 * DAY) },
  });
  const hr = await hrUserIds();
  let sent = 0;
  for (const c of contracts) {
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
      bodyAr: `تنتهي فترة تجربة ${emp?.fullNameAr ?? ''} في ${c.probationEndDate!.toISOString().slice(0, 10)}`,
      link: `/hr/employees/${c.employeeId}`,
    });
    c.probationAlertSent = true;
    await c.save();
    sent++;
  }
  return sent;
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
