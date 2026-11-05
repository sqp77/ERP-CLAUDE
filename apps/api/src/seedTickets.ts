import { User } from './core/auth/model';
import { Department } from './core/org/model';
import { effectivePermission } from './core/rbac/service';
import type { Actor, AuthedRequest } from './core/http/context';
import type { RoleAssignment } from '@eayni/shared';
import { Ticket } from './modules/tickets/model';
import { createTicket, relationsFor, transition } from './modules/tickets/service';

/** Sample tickets in every state for local testing [EP §9]. Idempotent. */
export async function seedTickets(): Promise<number> {
  if (await Ticket.countDocuments()) return 0;
  const byEmail = async (email: string) => {
    const u = await User.findOne({ email });
    if (!u) throw new Error(`seed: user ${email} missing`);
    return u;
  };
  const actorOf = (u: InstanceType<typeof User>): Actor => ({
    userId: String(u._id),
    email: u.email,
    roleCodes: u.roles.map((r) => r.role),
  });
  /** Minimal request context for the service (auth + authz on tickets). */
  const reqOf = async (u: InstanceType<typeof User>): Promise<AuthedRequest> => {
    const eff = await effectivePermission(
      u.roles as RoleAssignment[],
      u.departmentId ? String(u.departmentId) : undefined,
      'tickets',
      'edit',
      String(u._id),
    );
    return {
      auth: {
        user: u,
        roleCodes: u.roles.map((r) => r.role),
        ip: '',
        userAgent: 'seed',
        requestId: 'seed',
        session: {} as never,
      },
      authz: {
        resource: 'tickets',
        action: 'edit',
        scope: eff?.scope ?? 'own',
        departmentIds: eff?.departmentIds ?? [],
      },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as AuthedRequest;
  };
  const act = async (
    u: InstanceType<typeof User>,
    t: InstanceType<typeof Ticket>,
    code: string,
    input: Record<string, unknown> = {},
  ) => transition(t, code, { user: u, actor: actorOf(u), relations: await relationsFor(u, t), input });
  const it = await Department.findOne({ code: 'it' });
  if (!it) return 0;
  const [reem, omar, rashed, dana, hind, yousef, lama, faisal, mohammed, turki, khalid, noura] =
    await Promise.all(
      [
        'reem',
        'omar',
        'rashed',
        'dana',
        'hind',
        'yousef',
        'lama',
        'faisal',
        'mohammed',
        'turki',
        'khalid',
        'noura',
      ].map((n) => byEmail(`${n}@eayni.local`)),
    );
  const open = async (u: InstanceType<typeof User>, body: Record<string, unknown>) =>
    createTicket(await reqOf(u), {
      departmentCode: 'it',
      type: 'issue',
      priority: 'medium',
      attachmentIds: [],
      fields: {},
      subject: '',
      body: '',
      ...body,
    } as never);
  const assign = async (
    mgr: InstanceType<typeof User>,
    t: InstanceType<typeof Ticket>,
    to: InstanceType<typeof User>,
  ) =>
    transition(t, 'assign', {
      user: mgr,
      actor: actorOf(mgr),
      relations: await relationsFor(mgr, t),
      input: { assigneeId: String(to._id) },
    });
  let n = 0;
  // 1. new, in the IT queue
  await open(reem, {
    type: 'request',
    subject: 'صلاحية الدخول إلى مجلد المبيعات المشترك',
    body: 'أحتاج صلاحية قراءة وكتابة على مجلد عروض الأسعار.',
    fields: { itType: 'access' },
    priority: 'low',
  });
  n++;
  // 2. in progress (assigned to mohammed)
  const t2 = await open(omar, {
    subject: 'جهاز الطباعة في مستودع الدمام لا يعمل',
    body: 'الطابعة تعطي خطأ ورق محشور رغم خلوها.',
    fields: { itType: 'device' },
    priority: 'high',
  });
  await assign(faisal, t2, mohammed);
  n++;
  // 3. waiting for the requester (HR ticket)
  const t3 = await createTicket(await reqOf(rashed), {
    departmentCode: 'hr',
    type: 'inquiry',
    subject: 'استفسار عن رصيد الإجازات',
    body: 'كم رصيدي المتبقي من الإجازة السنوية؟',
    priority: 'low',
    attachmentIds: [],
    fields: {},
  });
  await act(noura, t3, 'review');
  await act(noura, t3, 'request_info', { reason: 'يرجى تحديد السنة المطلوب احتساب الرصيد عنها' });
  n++;
  // 4. resolved, awaiting the requester (ops ticket)
  const t4 = await createTicket(await reqOf(lama), {
    departmentCode: 'ops',
    type: 'request',
    subject: 'نقل حاوية من مدخل المبنى',
    body: 'الحاوية تعيق مدخل الزوار.',
    priority: 'medium',
    attachmentIds: [],
    fields: {},
  });
  await assign(khalid, t4, khalid); // the manager handles it himself
  await act(khalid, t4, 'resolve', { resolution: 'تم نقل الحاوية إلى الموقف الخلفي.' });
  n++;
  // 5. closed with a rating
  const t5 = await open(dana, {
    subject: 'تعذر فتح البريد على الجوال',
    body: 'كلمة المرور لا تُقبل في تطبيق البريد.',
    fields: { itType: 'software' },
  });
  await assign(faisal, t5, turki);
  await act(turki, t5, 'resolve', { resolution: 'تمت إعادة تهيئة الحساب على الجوال.' });
  await act(dana, t5, 'close', { rating: { score: 5, comment: 'سريع ومهذب' } });
  n++;
  // 6. reopened by the requester
  const t6 = await open(hind, {
    subject: 'انقطاع الشبكة في قاعة الاجتماعات',
    body: 'الواي فاي ينقطع كل عشر دقائق.',
    fields: { itType: 'network' },
    priority: 'urgent',
  });
  await assign(faisal, t6, mohammed);
  await act(mohammed, t6, 'resolve', { resolution: 'أُعيد تشغيل نقطة الوصول.' });
  await act(hind, t6, 'reopen', { reason: 'المشكلة عادت في اليوم التالي' });
  n++;
  // 7. stalled (IT only)
  const t7 = await open(yousef, {
    subject: 'برنامج الوزن لا يتزامن مع الميزان',
    body: 'القراءات لا تصل من الميزان الرقمي.',
    fields: { itType: 'fault' },
    priority: 'high',
  });
  await assign(faisal, t7, turki);
  await act(turki, t7, 'stall', { reason: 'بانتظار قطعة غيار من المورد' });
  n++;
  return n;
}
