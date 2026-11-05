import { User } from '../auth/model';
import { notify } from './service';

/**
 * Security alerts to every active system admin (security review A5, D24): role assignments,
 * authenticator resets, workflow and MFA-policy changes.
 */
export async function notifySystemAdmins(args: {
  bodyAr: string;
  link?: string;
  data?: Record<string, unknown>;
  excludeUserId?: string;
}): Promise<void> {
  const admins = await User.find({ 'roles.role': 'system_admin', status: 'active', deletedAt: null })
    .select('_id')
    .lean();
  const ids = admins.map((a) => String(a._id)).filter((id) => id !== args.excludeUserId);
  await notify({
    userIds: ids,
    type: 'security.alert',
    bodyAr: args.bodyAr,
    link: args.link,
    data: args.data,
  });
}

/** Executive management [FIN §12]: told when a financial or executive role is granted (follow-up 2). */
export async function notifyExecutives(args: {
  bodyAr: string;
  link?: string;
  data?: Record<string, unknown>;
  excludeUserId?: string;
}): Promise<void> {
  const execs = await User.find({ 'roles.role': 'executive', status: 'active', deletedAt: null })
    .select('_id')
    .lean();
  const ids = execs.map((a) => String(a._id)).filter((id) => id !== args.excludeUserId);
  await notify({
    userIds: ids,
    type: 'security.alert',
    bodyAr: args.bodyAr,
    link: args.link,
    data: args.data,
  });
}
