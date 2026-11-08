import { User } from './core/auth/model';
import type { AuthedRequest } from './core/http/context';
import { effectivePermission } from './core/rbac/service';
import type { RoleAssignment } from '@eayni/shared';
import { EmployeeReport } from './modules/hr/reports.model';
import { addNote, requestReport, submitReport } from './modules/hr/reports.service';

/** Sample employee reports [EP §14]. Idempotent. */
export async function seedEmployeeReports(): Promise<number> {
  if (await EmployeeReport.countDocuments()) return 0;
  const reqOf = async (email: string): Promise<AuthedRequest> => {
    const u = await User.findOne({ email });
    if (!u) throw new Error(`seed: user ${email} missing`);
    const eff = await effectivePermission(
      u.roles as RoleAssignment[],
      u.departmentId ? String(u.departmentId) : undefined,
      'hr.reports',
      'view',
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
        resource: 'hr.reports',
        action: 'view',
        scope: eff?.scope ?? 'own',
        departmentIds: eff?.departmentIds ?? [],
      },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as AuthedRequest;
  };
  const d = (days: number) => new Date(Date.now() + days * 86_400_000);
  const [omar, rashed, fahad, khalid] = await Promise.all(
    ['omar', 'rashed', 'fahad', 'khalid'].map((n) => reqOf(`${n}@eayni.local`)),
  );
  let n = 0;
  const r1 = await submitReport(omar, {
    type: 'weekly',
    title: 'تقرير الأسبوع 44 — زيارات الفرز',
    body: 'أُنجزت 9 زيارات ميدانية بإجمالي 4.2 طن ملابس و1.1 طن بلاستيك. مشكلة: تأخر الشاحنة رقم 3 يومين.',
    periodFrom: d(-10),
    periodTo: d(-4),
    attachmentIds: [],
  });
  await addNote(khalid, r1, 'جيد. أضف أرقام الحاويات التي أُفرغت في الأسبوع القادم.');
  n++;
  await submitReport(rashed, {
    type: 'visit',
    title: 'تقرير زيارة مدارس الظهران الأهلية',
    body: 'تم تسليم 4 حاويات وتدريب مسؤول المرافق على استخدام رمز QR.',
    periodFrom: d(-2),
    periodTo: d(-2),
    attachmentIds: [],
  });
  n++;
  await submitReport(fahad, {
    type: 'monthly',
    title: 'التقرير الشهري لمواقع الدمام',
    body: 'الأوزان الشهرية: 38 طنًا. الحاويات تحت الصيانة: 3. المقترح: إضافة موقع جديد في حي الشاطئ.',
    periodFrom: d(-35),
    periodTo: d(-5),
    attachmentIds: [],
  });
  n++;
  await requestReport(khalid, {
    employeeUserId: String(omar.auth.user._id),
    type: 'task',
    dueDate: d(3),
    note: 'تقرير عن مهمة جرد حاويات الفيصلية',
  });
  return n;
}
