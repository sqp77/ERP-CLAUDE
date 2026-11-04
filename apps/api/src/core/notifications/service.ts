import { NOTIFICATION_TITLES_AR, type NotificationType } from '@eayni/shared';
import { logger } from '../../logger';
import { User } from '../auth/model';
import { getSetting } from '../settings/service';
import { email } from './channels';
import { Notification } from './model';

export interface NotifyArgs {
  userIds: string[];
  type: NotificationType;
  titleAr?: string;
  bodyAr?: string;
  link?: string;
  data?: Record<string, unknown>;
  /** Write to the in-app center (default true). */
  inApp?: boolean;
  /** Also email when the channel is enabled. */
  email?: { subject: string; text: string; html?: string };
}

/**
 * Fan a notification out to users. In-app always (unless disabled per call); email only when the
 * `notifications.emailEnabled` setting is on. Never throws because of a channel failure.
 */
export async function notify(args: NotifyArgs): Promise<void> {
  const ids = [...new Set(args.userIds.filter(Boolean))];
  if (!ids.length) return;
  const titleAr = args.titleAr ?? NOTIFICATION_TITLES_AR[args.type];
  const emailEnabled = args.email ? await getSetting('notifications.emailEnabled') : false;
  const users = emailEnabled
    ? await User.find({ _id: { $in: ids }, status: 'active' })
        .select('email')
        .lean()
    : [];
  const emailByUser = new Map(users.map((u) => [String(u._id), u.email]));

  for (const userId of ids) {
    let emailStatus: 'skipped' | 'sent' | 'failed' = 'skipped';
    if (args.email && emailEnabled) {
      const to = emailByUser.get(userId);
      if (to) {
        try {
          await email().send({
            to,
            subject: args.email.subject,
            text: args.email.text,
            html: args.email.html,
          });
          emailStatus = 'sent';
        } catch (err) {
          emailStatus = 'failed';
          logger.warn({ err, userId }, 'email send failed');
        }
      }
    }
    if (args.inApp !== false) {
      await Notification.create({
        userId,
        type: args.type,
        titleAr,
        bodyAr: args.bodyAr,
        link: args.link,
        data: args.data,
        emailStatus,
      });
    }
  }
}

export async function unreadCount(userId: string): Promise<number> {
  return Notification.countDocuments({ userId, readAt: null });
}
