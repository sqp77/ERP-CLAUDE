import { DEPARTMENT_CODES, type DepartmentCode } from '@eayni/shared';
import { User } from './core/auth/model';
import { hashPassword } from './core/auth/crypto';
import { Branch, Department, Position, Site, Unit } from './core/org/model';
import { Contract, Custody, Employee } from './modules/hr/model';
import { createEmployee } from './modules/hr/service';
import { SYSTEM_ACTOR } from './core/http/context';
import { nextNumber } from './core/numbering/service';
import { ProfileChangeRequest } from './modules/hr/profileChanges.model';
import { encrypt } from './core/auth/crypto';
import { Attachment } from './core/files/model';

/** Sample employees: Arabic names, one chain CEO → department managers → staff. Local testing only. */
const DAY = 86_400_000;
const d = (days: number) => new Date(Date.now() + days * DAY);
const iso = (days: number) => d(days).toISOString().slice(0, 10);

interface Row {
  first: string;
  last: string;
  gender: 'male' | 'female';
  dept: DepartmentCode;
  role: 'ceo' | 'manager' | 'staff';
  position: string;
  nationality?: string;
  idType?: 'national_id' | 'iqama';
  idExpiryDays?: number;
  hireDays: number;
  salary: number;
  contract?: { type: 'fixed_term' | 'open_ended'; endDays?: number; probationDays?: number };
  extraRole?: string;
}

const ROWS: Row[] = [
  {
    first: 'عبدالله',
    last: 'الشمري',
    gender: 'male',
    dept: 'executive',
    role: 'ceo',
    position: 'المدير التنفيذي',
    hireDays: -2000,
    salary: 3_500_000,
    extraRole: 'executive',
  },
  {
    first: 'نورة',
    last: 'العتيبي',
    gender: 'female',
    dept: 'hr',
    role: 'manager',
    position: 'مدير الموارد البشرية',
    hireDays: -1500,
    salary: 2_200_000,
    extraRole: 'hr_manager',
  },
  {
    first: 'سارة',
    last: 'الدوسري',
    gender: 'female',
    dept: 'hr',
    role: 'staff',
    position: 'أخصائي موارد بشرية',
    hireDays: -700,
    salary: 1_100_000,
    extraRole: 'hr_officer',
    contract: { type: 'fixed_term', endDays: 45 },
  },
  {
    first: 'فيصل',
    last: 'القحطاني',
    gender: 'male',
    dept: 'it',
    role: 'manager',
    position: 'مدير التقنية',
    hireDays: -1200,
    salary: 2_400_000,
  },
  {
    first: 'محمد',
    last: 'حسن',
    gender: 'male',
    dept: 'it',
    role: 'staff',
    position: 'أخصائي دعم فني',
    nationality: 'مصري',
    idType: 'iqama',
    idExpiryDays: 25,
    hireDays: -400,
    salary: 950_000,
    contract: { type: 'fixed_term', endDays: 300 },
  },
  {
    first: 'خالد',
    last: 'المطيري',
    gender: 'male',
    dept: 'ops',
    role: 'manager',
    position: 'مدير التشغيل',
    hireDays: -1700,
    salary: 2_100_000,
  },
  {
    first: 'راشد',
    last: 'العنزي',
    gender: 'male',
    dept: 'ops',
    role: 'staff',
    position: 'سائق',
    hireDays: -900,
    salary: 600_000,
  },
  {
    first: 'عمر',
    last: 'عبدالرحمن',
    gender: 'male',
    dept: 'ops',
    role: 'staff',
    position: 'عامل ميداني',
    nationality: 'سوداني',
    idType: 'iqama',
    idExpiryDays: 80,
    hireDays: -300,
    salary: 450_000,
    contract: { type: 'fixed_term', endDays: 200 },
  },
  {
    first: 'يوسف',
    last: 'خان',
    gender: 'male',
    dept: 'ops',
    role: 'staff',
    position: 'عامل ميداني',
    nationality: 'باكستاني',
    idType: 'iqama',
    idExpiryDays: 5,
    hireDays: -60,
    salary: 450_000,
    contract: { type: 'fixed_term', endDays: 305, probationDays: 30 },
  },
  {
    first: 'سلطان',
    last: 'الحربي',
    gender: 'male',
    dept: 'sales',
    role: 'manager',
    position: 'مدير المبيعات',
    hireDays: -1300,
    salary: 2_300_000,
  },
  {
    first: 'ريم',
    last: 'الغامدي',
    gender: 'female',
    dept: 'sales',
    role: 'staff',
    position: 'مندوب مبيعات',
    hireDays: -500,
    salary: 900_000,
  },
  {
    first: 'ماجد',
    last: 'الزهراني',
    gender: 'male',
    dept: 'sales',
    role: 'staff',
    position: 'مندوب مبيعات',
    hireDays: -20,
    salary: 850_000,
    contract: { type: 'fixed_term', endDays: 345, probationDays: 70 },
  },
  {
    first: 'هند',
    last: 'السبيعي',
    gender: 'female',
    dept: 'marketing',
    role: 'manager',
    position: 'مدير التسويق',
    hireDays: -1100,
    salary: 2_000_000,
  },
  {
    first: 'لمى',
    last: 'البقمي',
    gender: 'female',
    dept: 'marketing',
    role: 'staff',
    position: 'أخصائي محتوى',
    hireDays: -350,
    salary: 800_000,
  },
  {
    first: 'أحمد',
    last: 'الجهني',
    gender: 'male',
    dept: 'sustainability',
    role: 'manager',
    position: 'مدير التنمية المستدامة',
    hireDays: -1000,
    salary: 2_000_000,
  },
  {
    first: 'دانة',
    last: 'الراشد',
    gender: 'female',
    dept: 'sustainability',
    role: 'staff',
    position: 'أخصائي شراكات',
    hireDays: -450,
    salary: 850_000,
  },
  {
    first: 'منيرة',
    last: 'الصقر',
    gender: 'female',
    dept: 'cs',
    role: 'manager',
    position: 'مدير خدمة العملاء',
    hireDays: -950,
    salary: 1_800_000,
  },
  {
    first: 'أروى',
    last: 'القرني',
    gender: 'female',
    dept: 'cs',
    role: 'staff',
    position: 'موظف خدمة عملاء',
    hireDays: -200,
    salary: 650_000,
    contract: { type: 'fixed_term', endDays: 160 },
  },
  {
    first: 'بدر',
    last: 'الشهراني',
    gender: 'male',
    dept: 'cs',
    role: 'staff',
    position: 'موظف خدمة عملاء',
    hireDays: -130,
    salary: 650_000,
  },
  {
    first: 'ناصر',
    last: 'الرشيدي',
    gender: 'male',
    dept: 'procurement',
    role: 'manager',
    position: 'مدير المشتريات',
    hireDays: -1400,
    salary: 2_000_000,
  },
  {
    first: 'طلال',
    last: 'العمري',
    gender: 'male',
    dept: 'procurement',
    role: 'staff',
    position: 'أخصائي مشتريات',
    hireDays: -600,
    salary: 900_000,
  },
  {
    first: 'عبدالعزيز',
    last: 'الفهد',
    gender: 'male',
    dept: 'finance',
    role: 'manager',
    position: 'مدير المالية',
    hireDays: -1600,
    salary: 2_500_000,
    extraRole: 'finance_manager',
  },
  {
    first: 'شهد',
    last: 'المالكي',
    gender: 'female',
    dept: 'finance',
    role: 'staff',
    position: 'محاسب',
    hireDays: -800,
    salary: 1_000_000,
    extraRole: 'finance_staff',
  },
  {
    first: 'جواهر',
    last: 'التميمي',
    gender: 'female',
    dept: 'finance',
    role: 'staff',
    position: 'محاسب',
    hireDays: -250,
    salary: 950_000,
    contract: { type: 'fixed_term', endDays: 12 },
  },
  {
    first: 'تركي',
    last: 'الدخيل',
    gender: 'male',
    dept: 'it',
    role: 'staff',
    position: 'مطوّر أنظمة',
    hireDays: -100,
    salary: 1_300_000,
    contract: { type: 'fixed_term', endDays: 265, probationDays: -10 },
  },
];

const slug = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
const emailFor = (r: Row, i: number) =>
  `${['abdullah', 'noura', 'sara', 'faisal', 'mohammed', 'khalid', 'rashed', 'omar', 'yousef', 'sultan', 'reem', 'majed', 'hind', 'lama', 'ahmed', 'dana', 'munira', 'arwa', 'bader', 'nasser', 'talal', 'abdulaziz', 'shahad', 'jawaher', 'turki'][i] ?? slug(r.first) + i}@eayni.local`;

export async function seedHr(
  password: string,
): Promise<{ created: number; logins: { email: string; role: string }[] }> {
  if (await Employee.countDocuments()) return { created: 0, logins: [] };
  const depts = new Map<string, string>();
  for (const code of DEPARTMENT_CODES) {
    const dep = await Department.findOne({ code });
    if (dep) depts.set(code, String(dep._id));
  }
  const hq = await Branch.findOne({ code: 'hq' });
  const site = hq ? await Site.findOne({ branchId: hq._id }) : null;
  const units: Record<string, string> = {};
  for (const [code, nameAr] of [
    ['ops_field', 'الفرق الميدانية'],
    ['ops_fleet', 'الأسطول'],
    ['it_support', 'الدعم الفني'],
  ] as const) {
    const depCode = code.startsWith('ops') ? 'ops' : 'it';
    const u = await Unit.findOneAndUpdate(
      { departmentId: depts.get(depCode), nameAr },
      { $setOnInsert: { departmentId: depts.get(depCode), nameAr, active: true } },
      { upsert: true, new: true },
    );
    units[code] = String(u!._id);
  }
  const positions = new Map<string, string>();
  for (const r of ROWS) {
    if (positions.has(r.position)) continue;
    const code = `pos_${slug(r.position) || positions.size}`.slice(0, 30) + '_' + positions.size;
    const p = await Position.findOneAndUpdate(
      { titleAr: r.position },
      { $setOnInsert: { code, titleAr: r.position, departmentId: depts.get(r.dept), active: true } },
      { upsert: true, new: true },
    );
    positions.set(r.position, String(p!._id));
  }

  const ids: string[] = [];
  const managerOf = new Map<DepartmentCode, string>();
  const logins: { email: string; role: string }[] = [];
  let seq = 0;
  for (const [i, r] of ROWS.entries()) {
    const { employee, temporaryPassword } = await createEmployee(
      {
        firstNameAr: r.first,
        lastNameAr: r.last,
        gender: r.gender,
        birthDate: d(-(365 * (25 + (i % 20)) + i * 7)),
        nationality: r.nationality ?? 'سعودي',
        identity: {
          type: r.idType ?? 'national_id',
          number: `${r.idType === 'iqama' ? '2' : '1'}0${String(100000000 + i * 7919).slice(-8)}`,
          expiryDate: d(r.idExpiryDays ?? 365 + i * 30),
        },
        workEmail: emailFor(r, i),
        mobile: `+9665${String(10000000 + i * 1237).slice(-8)}`,
        address: {
          buildingNo: String(1000 + i),
          street: 'طريق الملك فهد',
          district: 'الفيصلية',
          city: 'الدمام',
          postalCode: '32241',
        },
        departmentId: depts.get(r.dept)!,
        unitId:
          r.position.includes('ميداني') || r.position === 'سائق'
            ? units.ops_field
            : r.position.includes('دعم')
              ? units.it_support
              : undefined,
        positionId: positions.get(r.position),
        grade: r.role === 'ceo' ? 'G12' : r.role === 'manager' ? 'G9' : `G${4 + (i % 3)}`,
        branchId: hq ? String(hq._id) : undefined,
        siteId: site ? String(site._id) : undefined,
        directManagerId: r.role === 'ceo' ? undefined : r.role === 'manager' ? ids[0] : managerOf.get(r.dept),
        employmentType: 'full_time',
        hireDate: d(r.hireDays),
        status: 'active',
        basicSalaryHalalas: r.salary,
        allowances: [
          { type: 'سكن', amountHalalas: Math.round(r.salary * 0.25) },
          { type: 'نقل', amountHalalas: 60_000 },
        ],
        bank: {
          bankName: ['الراجحي', 'الأهلي', 'الرياض', 'الإنماء'][i % 4],
          iban: `SA${String(10 + i).padStart(2, '0')}80000000${String(600000000000 + i * 97).slice(-12)}`,
        },
        medicalInsurance: i % 5 !== 0,
        createAccount: true,
      },
      SYSTEM_ACTOR,
    );
    ids.push(String(employee._id));
    if (r.role === 'manager') managerOf.set(r.dept, String(employee._id));
    if (temporaryPassword) {
      // Known password for local testing; manager/HR/finance roles added per DECISIONS §4.
      const roles: { role: string; departmentId?: string }[] = [{ role: 'employee' }];
      if (r.role === 'manager') roles.push({ role: 'department_manager', departmentId: depts.get(r.dept) });
      if (r.extraRole) roles.push({ role: r.extraRole });
      await User.updateOne(
        { _id: employee.userId },
        { $set: { passwordHash: await hashPassword(password), mustChangePassword: false, roles } },
      );
      if (r.role !== 'staff' || r.extraRole)
        logins.push({
          email: employee.workEmail,
          role: r.extraRole ?? (r.role === 'manager' ? `department_manager (${r.dept})` : r.role),
        });
    }
    // Contract per employee; some close to expiry / probation.
    const c = r.contract ?? { type: 'open_ended' as const };
    await Contract.create({
      employeeId: employee._id,
      number: await nextNumber('contract'),
      type: c.type,
      startDate: d(r.hireDays),
      endDate: c.endDays !== undefined ? d(c.endDays) : undefined,
      probationEndDate: c.probationDays !== undefined ? d(c.probationDays) : d(r.hireDays + 90),
      durationMonths: c.type === 'fixed_term' ? 12 : undefined,
      status: 'active',
    });
    if (i % 3 === 0)
      await Custody.create({
        employeeId: employee._id,
        itemName: 'حاسب محمول',
        assetTag: `IT-${String(100 + seq++).padStart(4, '0')}`,
        issuedAt: d(r.hireDays + 3),
      });
    if (r.dept === 'ops' && r.role === 'staff')
      await Custody.create({
        employeeId: employee._id,
        itemName: 'جوال ميداني',
        assetTag: `IT-${String(200 + seq++).padStart(4, '0')}`,
        issuedAt: d(r.hireDays + 1),
      });
  }
  // One pending bank-change request (from the last created staff member) so the Finance queue has an item [EP §8.1].
  const requester = await Employee.findOne({ workEmail: emailFor(ROWS[7], 7) });
  if (requester?.userId) {
    const proof = await Attachment.create({
      key: `seed/${requester._id}-iban.pdf`,
      originalName: 'iban-certificate.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      status: 'uploaded',
      uploadedBy: requester.userId,
      sensitive: true,
      uploadedAt: new Date(),
    });
    await ProfileChangeRequest.create({
      number: await nextNumber('profileChange'),
      employeeId: requester._id,
      userId: requester.userId,
      type: 'bank',
      payload: { bankName: 'الإنماء', ibanEnc: encrypt('SA6105000068203456789012'), ibanLast4: '9012' },
      proofAttachmentId: proof._id,
      notes: 'تغيير البنك بعد فتح حساب راتب جديد (بيانات تجريبية؛ ملف الإثبات غير موجود فعليًا على القرص)',
    });
  }
  // Cross-department manager chain: department managers report to the CEO (set above); CEO has no manager.
  return { created: ids.length, logins };
}

export const SEED_SAMPLE_LOGINS_NOTE = `Sample accounts use the password given by SEED_SAMPLE_PASSWORD (default: Sample12345!); the start date iso ${iso(0)}`;
