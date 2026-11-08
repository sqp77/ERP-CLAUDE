import { User } from './core/auth/model';
import { effectivePermission } from './core/rbac/service';
import type { AuthedRequest } from './core/http/context';
import type { RoleAssignment } from '@eayni/shared';
import { News } from './modules/news/model';
import { createNews, submitNews } from './modules/news/service';

/** Sample news and circulars [EP §12]. Idempotent. */
export async function seedNews(): Promise<number> {
  if (await News.countDocuments()) return 0;
  const reqOf = async (email: string): Promise<AuthedRequest> => {
    const u = await User.findOne({ email });
    if (!u) throw new Error(`seed: user ${email} missing`);
    const eff = await effectivePermission(
      u.roles as RoleAssignment[],
      u.departmentId ? String(u.departmentId) : undefined,
      'news',
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
        resource: 'news',
        action: 'edit',
        scope: eff?.scope ?? 'own',
        departmentIds: eff?.departmentIds ?? [],
      },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as AuthedRequest;
  };
  const d = (days: number) => new Date(Date.now() + days * 86_400_000);
  let n = 0;
  const noura = await reqOf('noura@eayni.local'); // HR manager → direct publish
  const khalid = await reqOf('khalid@eayni.local'); // Operations manager → self-approve
  const lama = await reqOf('lama@eayni.local'); // Marketing manager
  const abdullah = await reqOf('abdullah@eayni.local'); // executive

  const c1 = await createNews(noura, {
    title: 'تعميم: مواعيد العمل خلال شهر رمضان',
    body: 'تُعتمد ساعات العمل من 10 صباحًا إلى 4 عصرًا لجميع الإدارات، وفرق الميدان بحسب جداول التشغيل.',
    audienceAll: true,
    audienceDepartmentIds: [],
    pinned: true,
    attachmentIds: [],
  });
  await submitNews(noura, c1);
  n++;
  const c2 = await createNews(abdullah, {
    title: 'قرار: اعتماد الهيكل التنظيمي المحدّث',
    body: 'اعتمدت الإدارة التنفيذية الهيكل التنظيمي لعام 2026 ويُعمل به من بداية الشهر القادم.',
    departmentCode: 'executive',
    audienceAll: true,
    audienceDepartmentIds: [],
    pinned: false,
    attachmentIds: [],
  });
  await submitNews(abdullah, c2);
  n++;
  const c3 = await createNews(khalid, {
    title: 'تشغيل خط فرز جديد في مستودع الدمام',
    body: 'بدأ العمل بخط الفرز الثاني بطاقة 3 أطنان يوميًا؛ شكرًا لفريق التشغيل.',
    audienceAll: true,
    audienceDepartmentIds: [],
    pinned: false,
    attachmentIds: [],
  });
  await submitNews(khalid, c3);
  n++;
  const c4 = await createNews(lama, {
    title: 'حملة "عيني تدوّر" في المدارس',
    body: 'تنطلق الحملة في 15 مدرسة بالمنطقة الشرقية خلال الأسبوعين القادمين.',
    audienceAll: true,
    audienceDepartmentIds: [],
    pinned: false,
    publishFrom: d(3),
    attachmentIds: [],
  });
  await submitNews(lama, c4);
  n++;
  // A pending item (manager-authored would self-approve; put it directly in the approval queue of Marketing).
  const c5 = await createNews(lama, {
    title: 'مسوّدة: نتائج حملة التبرع بالملابس',
    body: 'تم جمع 12 طنًا من الملابس خلال الحملة الأخيرة.',
    audienceAll: true,
    audienceDepartmentIds: [],
    pinned: false,
    attachmentIds: [],
  });
  await News.updateOne({ _id: c5._id }, { $set: { state: 'pending_approval', submittedAt: new Date() } });
  n++;
  // An archived one.
  const c6 = await createNews(noura, {
    title: 'تعميم سابق: تحديث بيانات التأمين الطبي',
    body: 'يرجى تحديث بيانات المعالين قبل نهاية الشهر.',
    audienceAll: true,
    audienceDepartmentIds: [],
    pinned: false,
    attachmentIds: [],
  });
  await submitNews(noura, c6);
  await News.updateOne(
    { _id: c6._id },
    { $set: { state: 'archived', archivedAt: d(-10), publishedAt: d(-40), publishTo: d(-11) } },
  );
  n++;
  return n;
}
