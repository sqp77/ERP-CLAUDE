import { subscribe } from '../../core/outbox/service';
import { recordAudit } from '../../core/audit/service';
import { withTransaction } from '../../db';
import { CommunicationLog, Customer } from './model';

/**
 * CRM domain-event subscribers (CLAUDE.md "Domain events").
 *
 * Consumed:
 * - `calendar.meeting.outcome_recorded` — a meeting or visit linked to a customer got its outcome: CRM appends it to
 *   the customer's communication log and moves `lastContactAt` / `nextFollowUpAt` [SAL §9, §4.1 ثالثاً, §10.2].
 *   The outbox idempotency key is the entry's `sourceKey` (unique), so a redelivery never writes it twice.
 */
interface OutcomePayload {
  eventId: string;
  customerId: string;
  title: string;
  eventType?: string | null;
  meetingType?: string | null;
  status?: string | null;
  outcome: string;
  nextFollowUpAt?: string | null;
  authorUserId: string;
  authorName?: string;
  at: string;
}

export async function logMeetingOutcome(
  p: OutcomePayload,
  sourceKey: string,
): Promise<'logged' | 'duplicate' | 'skipped'> {
  const customer = await Customer.findOne({ _id: p.customerId, deletedAt: null })
    .select('_id nextFollowUpAt')
    .lean();
  if (!customer) return 'skipped';
  if (await CommunicationLog.exists({ sourceKey })) return 'duplicate';
  const at = new Date(p.at);
  const next = p.nextFollowUpAt ? new Date(p.nextFollowUpAt) : undefined;
  try {
    await withTransaction(async (session) => {
      const [log] = await CommunicationLog.create(
        [
          {
            customerId: customer._id,
            authorUserId: p.authorUserId,
            authorName: p.authorName,
            at,
            method: p.eventType === 'visit' ? 'visit' : 'meeting',
            details: [p.title, p.meetingType].filter(Boolean).join(' — '),
            outcome: p.outcome,
            nextFollowUpAt: next,
            sourceKey,
            source: { type: 'calendar_event', id: p.eventId, label: p.title },
          },
        ],
        { session, ordered: true },
      );
      // lastContactAt only moves forward; a next follow-up from the meeting replaces the customer's.
      await Customer.updateOne(
        { _id: customer._id, $or: [{ lastContactAt: null }, { lastContactAt: { $lt: at } }] },
        { $set: { lastContactAt: at } },
        { session },
      );
      if (next)
        await Customer.updateOne({ _id: customer._id }, { $set: { nextFollowUpAt: next } }, { session });
      await recordAudit(
        { userId: p.authorUserId, roleCodes: [], system: true },
        {
          action: 'create',
          resource: 'crm.logs',
          resourceId: String(log._id),
          after: { customerId: p.customerId, method: log.method, source: 'calendar', eventId: p.eventId },
        },
        session,
      );
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return 'duplicate';
    throw err;
  }
  return 'logged';
}

export function registerCrmSubscribers(): void {
  subscribe(
    'calendar.meeting.outcome_recorded',
    async (event) => {
      const p = event.payload as unknown as OutcomePayload;
      await logMeetingOutcome(p, event.idempotencyKey ?? `outbox:${String(event._id)}`);
    },
    'crm.meeting_outcome_to_log',
  );
}
