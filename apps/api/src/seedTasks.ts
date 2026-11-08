import { Task, TaskEvent } from './core/tasks/model';
import { Employee } from './modules/hr/model';
import { User } from './core/auth/model';
import { Department } from './core/org/model';
import { nextNumber } from './core/numbering/service';
import { Position } from './core/org/model';
import { createEmployee } from './modules/hr/service';
import { hashPassword } from './core/auth/crypto';
import { SYSTEM_ACTOR } from './core/http/context';

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

/**
 * Sample work distribution for the Operations manager [EP §16]: a queue task, and assigned tasks in
 * every state across the four Operations employees.
 */
export async function seedTasks(samplePassword: string | ((email: string) => string)): Promise<number> {
  if (await Task.countDocuments()) return 0;
  const ops = await Department.findOne({ code: 'ops' });
  if (!ops) return 0;
  const mgrEmp = await Employee.findOne({ workEmail: 'khalid@eayni.local' });
  // Databases seeded before this slice have three Operations employees; add the fourth.
  if (mgrEmp && !(await Employee.exists({ workEmail: 'fahad@eayni.local' }))) {
    const pos = await Position.findOneAndUpdate(
      { titleAr: 'مشرف موقع' },
      {
        $setOnInsert: {
          code: 'pos_site_supervisor',
          titleAr: 'مشرف موقع',
          departmentId: ops._id,
          active: true,
        },
      },
      { upsert: true, new: true },
    );
    const { employee } = await createEmployee(
      {
        firstNameAr: 'فهد',
        lastNameAr: 'القحطاني',
        gender: 'male',
        nationality: 'سعودي',
        identity: { type: 'national_id', number: '1099000025', expiryDate: day(900) },
        workEmail: 'fahad@eayni.local',
        mobile: '+966551234599',
        departmentId: String(ops._id),
        positionId: pos ? String(pos._id) : undefined,
        directManagerId: String(mgrEmp._id),
        employmentType: 'full_time',
        hireDate: day(-1200),
        status: 'active',
        basicSalaryHalalas: 800_000,
        createAccount: true,
      } as Parameters<typeof createEmployee>[0],
      SYSTEM_ACTOR,
    );
    await User.updateOne(
      { _id: employee.userId },
      {
        $set: {
          passwordHash: await hashPassword(
            typeof samplePassword === 'string' ? samplePassword : samplePassword(employee.workEmail),
          ),
          mustChangePassword: false,
        },
      },
    );
  }
  const staff = await Employee.find({
    workEmail: { $in: ['rashed@eayni.local', 'omar@eayni.local', 'yousef@eayni.local', 'fahad@eayni.local'] },
  }).lean();
  if (!mgrEmp?.userId || staff.length < 4) return 0;
  const by = (email: string) => staff.find((s) => s.workEmail === email)!.userId!;
  const mgr = mgrEmp.userId;
  const rows: Array<{
    title: string;
    description?: string;
    assignee?: unknown;
    status: string;
    priority: string;
    due: number;
    start?: number;
    progress?: number;
    events: Array<{ type: string; from?: string; to?: string; note?: string }>;
  }> = [
    {
      title: 'جرد حاويات الملابس في حي الفيصلية',
      description: 'حصر الحاويات وحالتها وتصوير التالف منها',
      status: 'new',
      priority: 'medium',
      due: 3,
      events: [{ type: 'created', to: 'new' }],
    },
    {
      title: 'توصيل 4 حاويات إلى مدارس الظهران الأهلية',
      assignee: by('rashed@eayni.local'),
      status: 'new',
      priority: 'high',
      due: 2,
      events: [{ type: 'created', to: 'new' }],
    },
    {
      title: 'زيارة ميدانية لمصنع الشرقية للبلاستيك',
      description: 'تقدير كميات السكراب وتصوير الموقع',
      assignee: by('omar@eayni.local'),
      status: 'in_progress',
      priority: 'medium',
      due: 4,
      start: -1,
      progress: 40,
      events: [
        { type: 'created', to: 'new' },
        { type: 'status_changed', from: 'new', to: 'in_progress' },
      ],
    },
    {
      title: 'تقرير أوزان مبادرة جمعية البر',
      assignee: by('fahad@eayni.local'),
      status: 'waiting_review',
      priority: 'medium',
      due: 1,
      start: -3,
      progress: 100,
      events: [
        { type: 'created', to: 'new' },
        { type: 'status_changed', from: 'new', to: 'in_progress' },
        { type: 'review_requested', from: 'in_progress', to: 'waiting_review' },
      ],
    },
    {
      title: 'صيانة شاحنة الأسطول رقم 3',
      assignee: by('rashed@eayni.local'),
      status: 'done',
      priority: 'low',
      due: -2,
      start: -6,
      progress: 100,
      events: [
        { type: 'created', to: 'new' },
        { type: 'status_changed', from: 'new', to: 'in_progress' },
        { type: 'review_requested', from: 'in_progress', to: 'waiting_review' },
        { type: 'approved', from: 'waiting_review', to: 'done' },
      ],
    },
    {
      title: 'استلام حاويات المورد وتحديث السجل',
      assignee: by('yousef@eayni.local'),
      status: 'late',
      priority: 'urgent',
      due: -3,
      start: -5,
      progress: 20,
      events: [
        { type: 'created', to: 'new' },
        { type: 'status_changed', from: 'new', to: 'in_progress' },
        { type: 'returned', from: 'waiting_review', to: 'in_progress', note: 'الصور غير واضحة، أعد التصوير' },
      ],
    },
    {
      title: 'تجهيز حاويات لفعالية ملغاة',
      assignee: by('omar@eayni.local'),
      status: 'cancelled',
      priority: 'low',
      due: 5,
      events: [
        { type: 'created', to: 'new' },
        { type: 'cancelled', from: 'new', to: 'cancelled' },
      ],
    },
  ];
  const mgrUser = await User.findById(mgr).select('email').lean();
  for (const r of rows) {
    const t = await Task.create({
      number: await nextNumber('task'),
      title: r.title,
      description: r.description,
      assignerId: mgr,
      assigneeId: r.assignee,
      departmentId: ops._id,
      priority: r.priority,
      status: r.status,
      progressPercent: r.progress ?? 0,
      startAt: r.start !== undefined ? day(r.start) : undefined,
      dueAt: day(r.due),
      completedAt: r.status === 'done' ? day(-1) : undefined,
      reviewNote: r.events.find((e) => e.type === 'returned')?.note,
      remindedDueSoon: r.due <= 1,
      remindedOverdue: r.due < 0,
    });
    let i = 0;
    for (const e of r.events) {
      await TaskEvent.create({
        taskId: t._id,
        type: e.type,
        fromStatus: e.from,
        toStatus: e.to,
        toAssigneeId: e.type === 'created' ? r.assignee : undefined,
        note: e.note,
        actorUserId:
          e.type === 'created' || e.type === 'approved' || e.type === 'returned' || e.type === 'cancelled'
            ? mgr
            : r.assignee,
        actorEmail: mgrUser?.email,
        at: day(-7 + i++),
      });
    }
  }
  return rows.length;
}
