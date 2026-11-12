import { OPEN_LEAD_STATES } from '@eayni/shared';
import { notify } from '../../core/notifications/service';
import { getSetting } from '../../core/settings/service';
import { recordAudit } from '../../core/audit/service';
import { SYSTEM_ACTOR } from '../../core/http/context';
import { Customer, Lead, LeadEvent } from './model';
import { salesManagerUserIds } from './service';

/**
 * Notification 3 [SAL §14, §10.2 «إشعار الموظف عند حلول موعد المتابعة»]: once per follow-up date, N hours before it
 * (setting `sales.followUpReminderHours`), to الموظف المسؤول. Runs on the frequent cadence.
 */
export async function runFollowUpReminders(now = new Date()): Promise<{ notified: number }> {
  const hours = await getSetting('sales.followUpReminderHours');
  const until = new Date(now.getTime() + hours * 3_600_000);
  const due = await Customer.find({
    deletedAt: null,
    nextFollowUpAt: { $ne: null, $lte: until },
    $or: [{ followUpNotifiedFor: null }, { $expr: { $ne: ['$followUpNotifiedFor', '$nextFollowUpAt'] } }],
  })
    .select('_id number nameAr ownerUserId nextFollowUpAt')
    .limit(500)
    .lean();
  let notified = 0;
  for (const c of due) {
    // Claim first so two workers never notify twice (conditional on the same follow-up date).
    const claimed = await Customer.updateOne(
      {
        _id: c._id,
        nextFollowUpAt: c.nextFollowUpAt,
        $or: [{ followUpNotifiedFor: null }, { followUpNotifiedFor: { $ne: c.nextFollowUpAt } }],
      },
      { $set: { followUpNotifiedFor: c.nextFollowUpAt } },
    );
    if (!claimed.modifiedCount) continue;
    await notify({
      userIds: [String(c.ownerUserId)],
      type: 'crm.followup.due',
      bodyAr: `${c.number} — ${c.nameAr}`,
      link: `/sales/customers/${c._id}`,
      data: { customerId: String(c._id), nextFollowUpAt: c.nextFollowUpAt },
    });
    notified++;
  }
  return { notified };
}

/**
 * The 24-hour rule [SAL §3 «تسجيل العميل أو الفرصة في نظام CRM خلال 24 ساعة», DECISIONS §20 Q13]: a referred lead
 * still unregistered after `crm.leadRegistrationHours` clock hours is flagged once; the assigned rep (if any) and
 * the Sales managers are notified.
 */
export async function runLeadOverdueAlerts(now = new Date()): Promise<{ flagged: number }> {
  const hours = await getSetting('crm.leadRegistrationHours');
  const cutoff = new Date(now.getTime() - hours * 3_600_000);
  const overdue = await Lead.find({
    deletedAt: null,
    registeredAt: null,
    overdueNotifiedAt: null,
    state: { $in: OPEN_LEAD_STATES },
    referredAt: { $lt: cutoff },
  })
    .limit(200)
    .lean();
  let flagged = 0;
  for (const lead of overdue) {
    const claimed = await Lead.updateOne(
      { _id: lead._id, overdueNotifiedAt: null },
      { $set: { overdueNotifiedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    await LeadEvent.create({ leadId: lead._id, type: 'overdue', note: `${hours}h` });
    const managers =
      lead.targetDepartment === 'sales' ? await salesManagerUserIds(String(lead.targetDepartmentId)) : [];
    const recipients = [
      ...new Set([...(lead.assigneeUserId ? [String(lead.assigneeUserId)] : []), ...managers]),
    ];
    await notify({
      userIds: recipients,
      type: 'crm.lead.overdue',
      bodyAr: `${lead.number} — ${lead.customerName}: لم يُسجَّل خلال ${hours} ساعة من الإحالة`,
      link: `/sales/leads?lead=${lead._id}`,
      data: { leadId: String(lead._id) },
    });
    await recordAudit(SYSTEM_ACTOR, {
      action: 'update',
      resource: 'crm.leads',
      resourceId: String(lead._id),
      meta: { overdue: true, hours },
    });
    flagged++;
  }
  return { flagged };
}
