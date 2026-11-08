import type { FilterQuery } from 'mongoose';
import type { CreateNewsInput, RoleAssignment } from '@eayni/shared';
import { badRequest, conflict, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type Actor, type Authz, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { getSetting } from '../../core/settings/service';
import { effectivePermission } from '../../core/rbac/service';
import { claimAttachments } from '../../core/files/service';
import { withTransaction } from '../../db';
import { Department } from '../../core/org/model';
import { User, type UserDoc } from '../../core/auth/model';
import { News, NewsAction, type NewsDoc } from './model';

async function log(news: NewsDoc, action: string, actor: Actor, note?: string) {
  await NewsAction.create({
    newsId: news._id,
    action,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    note,
  });
}

/** Effective permission on news for this user (implicit grants included). */
async function perm(user: UserDoc, action: 'create' | 'edit' | 'approve' | 'view') {
  return effectivePermission(
    user.roles as RoleAssignment[],
    user.departmentId ? String(user.departmentId) : undefined,
    'news',
    action,
    String(user._id),
  );
}

/**
 * Departments this user may write for: managed departments (approve + publish), all for HR and executive
 * management, or — for plain staff when `news.staffAuthoringDepartments` allows it — their own department,
 * whose manager then approves [EP §12.2 "اسم الموظف الناشر", §12.3.3].
 */
export async function publishableDepartments(user: UserDoc) {
  const eff = await perm(user, 'create');
  if (!eff) return [];
  const filter: Record<string, unknown> = { active: { $ne: false } };
  const approve = await perm(user, 'approve');
  if (approve?.scope === 'all') {
    // HR / executive: any department
  } else if (approve?.scope === 'department' && approve.departmentIds.length)
    filter._id = { $in: approve.departmentIds };
  else {
    if (!user.departmentId) return [];
    const own = await Department.findById(user.departmentId).select('code').lean();
    if (!own) return [];
    const cfg = await getSetting('news.staffAuthoringDepartments');
    if (!(cfg[own.code] ?? true)) return [];
    filter._id = user.departmentId;
  }
  const depts = await Department.find(filter).select('code nameAr').sort({ code: 1 }).lean();
  return depts.map((d) => ({ code: d.code, departmentId: String(d._id), nameAr: d.nameAr }));
}

async function canApprove(user: UserDoc, news: NewsDoc): Promise<boolean> {
  const eff = await perm(user, 'approve');
  if (!eff) return false;
  return (
    eff.scope === 'all' ||
    (eff.scope === 'department' && eff.departmentIds.includes(String(news.departmentId)))
  );
}

async function canEdit(user: UserDoc, news: NewsDoc): Promise<boolean> {
  if (String(news.authorUserId) === String(user._id)) return true;
  const eff = await perm(user, 'edit');
  if (!eff) return false;
  return (
    eff.scope === 'all' ||
    (eff.scope === 'department' && eff.departmentIds.includes(String(news.departmentId)))
  );
}

export async function createNews(req: AuthedRequest, input: CreateNewsInput): Promise<NewsDoc> {
  const user = req.auth.user;
  const allowed = await publishableDepartments(user);
  const code =
    input.departmentCode ??
    (await Department.findById(user.departmentId).select('code').lean())?.code ??
    (allowed.length === 1 ? allowed[0].code : undefined);
  const dept = allowed.find((d) => d.code === code);
  if (!dept) throw forbidden('لا يمكنك النشر باسم هذا القسم');
  if (!input.audienceAll && !input.audienceDepartmentIds.length) throw badRequest('حدّد الفئة المستهدفة');
  const { departmentCode: _c, pinned, ...rest } = input;
  const canPin = (await perm(user, 'approve')) !== null; // review E4: only approvers pin
  const ids = [...input.attachmentIds, ...(input.coverAttachmentId ? [input.coverAttachmentId] : [])];
  // Record and attachment claims commit together (review E7).
  const news = await withTransaction(async (session) => {
    const [doc] = await News.create(
      [
        {
          ...rest,
          pinned: canPin ? pinned : false,
          number: await nextNumber('news', session),
          departmentId: dept.departmentId,
          departmentCode: dept.code,
          authorUserId: user._id,
          authorName: user.displayNameAr,
        },
      ],
      { session },
    );
    if (ids.length) await claimAttachments(ids, 'news', String(doc._id), user._id, session);
    return doc;
  });
  const actor = actorFrom(req);
  await log(news, 'created', actor);
  await recordAudit(actor, {
    action: 'create',
    resource: 'news',
    resourceId: String(news._id),
    after: { number: news.number, title: news.title },
  });
  return news;
}

export async function updateNews(
  req: AuthedRequest,
  news: NewsDoc,
  input: Partial<CreateNewsInput>,
): Promise<NewsDoc> {
  const user = req.auth.user;
  const approver = await canApprove(user, news);
  if (!(await canEdit(user, news))) throw forbidden();
  if (news.state === 'archived') throw badRequest('الخبر مؤرشف');
  // Go-live review E4: authors edit drafts and rejected items; a pending item goes back to draft when edited;
  // a published item is edited only by an approver (and the change is logged with before/after).
  if (news.state === 'published' && !approver) throw forbidden('تعديل خبر منشور من صلاحية معتمِد القسم');
  const before = news.toObject();
  const { departmentCode: _c, pinned, ...rest } = input;
  Object.assign(news, rest);
  if (pinned !== undefined && approver) news.pinned = pinned; // `pinned` is ignored for non-approvers
  const ids = [...(input.attachmentIds ?? []), ...(input.coverAttachmentId ? [input.coverAttachmentId] : [])];
  if (ids.length) await claimAttachments(ids, 'news', String(news._id), user._id);
  if (news.state === 'rejected' || news.state === 'pending_approval') news.state = 'draft';
  await news.save();
  await log(
    news,
    'updated',
    actorFrom(req),
    news.state === 'published' ? 'published item edited by approver' : undefined,
  );
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'news',
    resourceId: String(news._id),
    before,
    after: news,
  });
  return news;
}

/** Submit for approval; HR and executive circulars (setting) and approvers themselves publish directly [DECISIONS §10]. */
export async function submitNews(req: AuthedRequest, news: NewsDoc): Promise<NewsDoc> {
  if (!(await canEdit(req.auth.user, news))) throw forbidden();
  if (!['draft', 'rejected'].includes(news.state)) throw badRequest('الخبر ليس مسودة');
  // Direct publishing needs both a direct-publish department and a role listed in news.directPublishRoles (review E4).
  const directDept = (await getSetting('news.directPublishDepartments')).includes(news.departmentCode);
  const directRole = (await getSetting('news.directPublishRoles')).some((r) =>
    req.auth.roleCodes.includes(r),
  );
  const direct = directDept && directRole;
  if (direct || (await canApprove(req.auth.user, news)))
    return publish(news, actorFrom(req), direct ? 'direct_publish' : 'self_approve');
  const updated = await News.findOneAndUpdate(
    { _id: news._id, state: news.state },
    { $set: { state: 'pending_approval', submittedAt: new Date() } },
    { new: true },
  );
  if (!updated) throw conflict('تغيّرت حالة الخبر، حدّث الصفحة');
  await log(updated, 'submitted', actorFrom(req));
  // The department manager(s) approve.
  const { departmentManagerUserIds } = await import('../../core/tasks/jobs');
  const managers = (await departmentManagerUserIds(String(news.departmentId))).filter(
    (id) => id !== String(req.auth.user._id),
  );
  await notify({
    userIds: managers,
    type: 'generic',
    titleAr: 'خبر بانتظار اعتمادك',
    bodyAr: `${updated.number} — ${updated.title}`,
    link: `/news/${updated._id}`,
  });
  return updated;
}

export async function decideNews(
  req: AuthedRequest,
  news: NewsDoc,
  approve: boolean,
  reason?: string,
): Promise<NewsDoc> {
  if (!(await canApprove(req.auth.user, news))) throw forbidden('اعتماد الأخبار من صلاحية مدير القسم الناشر');
  if (String(news.authorUserId) === String(req.auth.user._id) && !approve)
    throw badRequest('لا يمكنك رفض خبرك؛ عدّله أو احذفه');
  if (news.state !== 'pending_approval') throw badRequest('الخبر ليس بانتظار الاعتماد');
  if (!approve) {
    if (!reason?.trim()) throw badRequest('سبب الرفض مطلوب');
    const updated = await News.findOneAndUpdate(
      { _id: news._id, state: 'pending_approval' },
      { $set: { state: 'rejected', rejectReason: reason } },
      { new: true },
    );
    if (!updated) throw conflict('تغيّرت حالة الخبر، حدّث الصفحة');
    await log(updated, 'rejected', actorFrom(req), reason);
    await notify({
      userIds: [String(news.authorUserId)],
      type: 'generic',
      titleAr: 'لم يُعتمد خبرك',
      bodyAr: `${news.number} — ${reason}`,
      link: `/news/${news._id}`,
    });
    return updated;
  }
  return publish(news, actorFrom(req), 'approved');
}

async function audienceUserIds(news: NewsDoc): Promise<string[]> {
  const filter: Record<string, unknown> = { status: 'active', deletedAt: null };
  if (!news.audienceAll) filter.departmentId = { $in: news.audienceDepartmentIds };
  const users = await User.find(filter).select('_id').lean();
  return users.map((u) => String(u._id));
}

/** Publish now (or schedule when publishFrom is in the future); the audience is told when the window opens [EP §12.3.5]. */
async function publish(news: NewsDoc, actor: Actor, how: string): Promise<NewsDoc> {
  const now = new Date();
  const updated = await News.findOneAndUpdate(
    { _id: news._id, state: { $in: ['draft', 'rejected', 'pending_approval'] } },
    {
      $set: {
        state: 'published',
        publishedAt: now,
        approvedBy: actor.userId,
        approvedAt: now,
        publishFrom: news.publishFrom ?? now,
      },
    },
    { new: true },
  );
  if (!updated) throw conflict('تغيّرت حالة الخبر، حدّث الصفحة');
  await log(updated, how, actor);
  await recordAudit(actor, {
    action: 'approve',
    resource: 'news',
    resourceId: String(updated._id),
    meta: { how },
  });
  if (!updated.publishFrom || updated.publishFrom <= now) await announce(updated);
  return updated;
}

/**
 * Announce a published item once (review G7): the announcement is claimed with a conditional update
 * (notifiedAt null → now) before anyone is notified, so two workers never notify twice; an item whose
 * window already ended is never announced.
 */
export async function announce(news: NewsDoc, now = new Date()): Promise<boolean> {
  if (news.publishTo && news.publishTo < now) return false;
  const claimed = await News.findOneAndUpdate(
    { _id: news._id, state: 'published', notifiedAt: null, deletedAt: null },
    { $set: { notifiedAt: now } },
    { new: true },
  );
  if (!claimed) return false;
  const ids = await audienceUserIds(claimed);
  await notify({
    userIds: ids,
    type: 'news.published',
    bodyAr: claimed.title,
    link: `/news/${claimed._id}`,
    data: { newsId: String(claimed._id), departmentCode: claimed.departmentCode },
  });
  return true;
}

export async function archiveNews(req: AuthedRequest, news: NewsDoc): Promise<NewsDoc> {
  if (!(await canEdit(req.auth.user, news))) throw forbidden();
  // Conditional on the current state and audited (review G7).
  const updated = await News.findOneAndUpdate(
    { _id: news._id, state: news.state, deletedAt: null },
    { $set: { state: 'archived', archivedAt: new Date(), pinned: false } },
    { new: true },
  );
  if (!updated) throw conflict('تغيّرت حالة الخبر، أعد التحميل');
  await log(updated, 'archived', actorFrom(req));
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'news',
    resourceId: String(updated._id),
    before: { state: news.state, pinned: news.pinned },
    after: { state: 'archived', pinned: false },
  });
  return updated;
}

export async function setPinned(req: AuthedRequest, news: NewsDoc, pinned: boolean): Promise<NewsDoc> {
  if (!(await canApprove(req.auth.user, news))) throw forbidden('تثبيت الأخبار من صلاحية مدير القسم');
  const updated = await News.findOneAndUpdate(
    { _id: news._id, state: news.state, pinned: !pinned, deletedAt: null },
    { $set: { pinned } },
    { new: true },
  );
  if (!updated) throw conflict('تغيّرت حالة الخبر، أعد التحميل');
  await log(updated, pinned ? 'pinned' : 'unpinned', actorFrom(req));
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'news',
    resourceId: String(updated._id),
    before: { pinned: !pinned },
    after: { pinned },
  });
  return updated;
}

/** What the viewer may read: published items in their audience and window; plus their department's items when they manage / publish. */
export async function visibilityFilter(
  user: UserDoc,
  authz: Authz,
  now = new Date(),
): Promise<FilterQuery<unknown>> {
  const audience = {
    $or: [
      { audienceAll: true },
      ...(user.departmentId ? [{ audienceDepartmentIds: user.departmentId }] : []),
    ],
  };
  const published = { state: { $in: ['published', 'archived'] }, publishFrom: { $lte: now }, ...audience };
  const or: Record<string, unknown>[] = [published, { authorUserId: user._id }];
  const edit = await perm(user, 'edit');
  if (edit?.scope === 'all') return {};
  if (edit?.scope === 'department') or.push({ departmentId: { $in: edit.departmentIds } });
  void authz;
  return { $or: or };
}

export async function findVisible(req: AuthedRequest, id: string): Promise<NewsDoc> {
  const n = await News.findOne({
    _id: id,
    deletedAt: null,
    ...(await visibilityFilter(req.auth.user, req.authz!)),
  });
  if (!n) throw notFound('الخبر غير موجود');
  return n;
}

export async function history(newsId: string) {
  return NewsAction.find({ newsId }).sort({ at: 1 }).lean();
}

export async function viewerCapabilities(user: UserDoc, news: NewsDoc) {
  return { canEdit: await canEdit(user, news), canApprove: await canApprove(user, news) };
}
