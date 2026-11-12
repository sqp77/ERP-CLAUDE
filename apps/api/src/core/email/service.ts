import type { ClientSession } from 'mongoose';
import { EmailMessage, type EmailMessageDoc } from './model';

/**
 * Mailbox adapter seam [SAL §3, §7.3, §10.1; plan §2; DECISIONS §20 Q5]: sending from the employee's or the
 * department's mailbox needs a provider (Microsoft 365 / Google Workspace) the owner has not chosen yet. Until then
 * the `disabled` provider stores the message as «مسوّدة لم تُرسل» and the UI offers a `mailto:` link; the employee then
 * marks it «أُرسل خارج النظام». A real provider later flips the same records to «أُرسل من النظام».
 */
export interface OutgoingMail {
  from: { userId: string; email?: string; name?: string; mailbox: 'user' | 'department' };
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  attachmentIds: string[];
}
export interface MailboxProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(mail: OutgoingMail): Promise<{ providerMessageId?: string }>;
}
class DisabledMailboxProvider implements MailboxProvider {
  readonly name = 'disabled';
  readonly enabled = false;
  async send(): Promise<never> {
    throw new Error('mailbox provider not configured');
  }
}
let provider: MailboxProvider = new DisabledMailboxProvider();
export function setMailboxProvider(p: MailboxProvider | undefined): void {
  provider = p ?? new DisabledMailboxProvider();
}
export const mailboxProvider = () => provider;

/** Compose, try the provider, and always keep the message in the record's correspondence. */
export async function composeAndSend(
  link: { recordType: string; recordId: string; customerId?: unknown },
  mail: OutgoingMail,
  session?: ClientSession,
): Promise<EmailMessageDoc & { _id: unknown; mailto: string }> {
  let state: 'draft_unsent' | 'sent' | 'failed' = 'draft_unsent';
  let error: string | undefined;
  let sentAt: Date | undefined;
  if (provider.enabled) {
    try {
      await provider.send(mail);
      state = 'sent';
      sentAt = new Date();
    } catch (e) {
      state = 'failed';
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const [doc] = await EmailMessage.create(
    [
      {
        ...link,
        fromUserId: mail.from.userId,
        fromName: mail.from.name,
        fromMailbox: mail.from.mailbox,
        to: mail.to,
        cc: mail.cc,
        subject: mail.subject,
        bodyText: mail.bodyText,
        attachmentIds: mail.attachmentIds,
        state,
        provider: provider.name,
        sentAt,
        error,
      },
    ],
    { session, ordered: true },
  );
  const mailto = `mailto:${mail.to.join(',')}?${mail.cc.length ? `cc=${mail.cc.join(',')}&` : ''}subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.bodyText)}`;
  return Object.assign(doc.toObject(), { mailto }) as never;
}

/** The employee sent the draft from their own mail client (`mailto:`): record it, never delete the draft. */
export async function markSentExternally(id: string, userId: string): Promise<boolean> {
  const r = await EmailMessage.updateOne(
    { _id: id, fromUserId: userId, state: 'draft_unsent' },
    { $set: { state: 'sent_externally', sentAt: new Date() } },
  );
  return r.modifiedCount > 0;
}

export async function correspondenceOf(customerId: unknown) {
  return EmailMessage.find({ customerId }).sort({ createdAt: -1 }).lean();
}
