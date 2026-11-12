import { z } from 'zod';
import { DEFAULT_HR_REQUEST_ROUTES, hrRequestRoutesSchema } from './schemas/hrRequests';
import { DEFAULT_TICKET_DEPARTMENT_FIELDS, ticketDepartmentFieldsSchema } from './schemas/tickets';
import { DEFAULT_REPORT_TYPES, reportTypesSchema } from './schemas/hrReports';
import { DEFAULT_ORGANIZATION_TYPES } from './schemas/crm';
import { DEFAULT_FACILITY_SIZES, DEFAULT_LOSS_REASONS } from './schemas/sales';
import { SALES_LIST_KEYS } from './schemas/salesRequests';

/**
 * Settings registry: everything the specs want configurable lives here with a default and a schema
 * (golden rule 10). Values are stored in the `settings` collection and edited from the admin screen.
 */
export interface SettingDefinition<T = unknown> {
  key: string;
  labelAr: string;
  descriptionAr?: string;
  group: 'auth' | 'tickets' | 'hr' | 'notifications' | 'general' | 'system' | 'crm' | 'sales';
  schema: z.ZodType<T>;
  default: T;
}

function def<T>(d: SettingDefinition<T>): SettingDefinition<T> {
  return d;
}

export const SETTING_DEFINITIONS = {
  // ---- CRM / Sales [SAL §3, §4.1, DECISIONS §20]
  'crm.leadRegistrationHours': def({
    key: 'crm.leadRegistrationHours',
    labelAr: 'مهلة تسجيل العميل المحتمل المحال من خدمة العملاء (ساعات)',
    descriptionAr:
      'ساعات زمنية من وقت الإحالة؛ عند تجاوزها يُنبَّه الموظف المسؤول ومدير المبيعات مرة واحدة [SAL §3]',
    group: 'crm',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 14),
    default: 24, // DECISIONS §20 Q13
  }),
  'crm.organizationTypes': def({
    key: 'crm.organizationTypes',
    labelAr: 'أنواع الجهات',
    descriptionAr: 'القائمة الأولية من SAL §4.1؛ تُضاف قيم خدمة العملاء لاحقًا (DECISIONS §20 Q8)',
    group: 'crm',
    schema: z.array(z.string().trim().min(1).max(80)).max(50),
    default: DEFAULT_ORGANIZATION_TYPES,
  }),
  'sales.facilitySizes': def({
    key: 'sales.facilitySizes',
    labelAr: 'أحجام المنشآت (مؤقتة حتى اعتماد المالك)',
    group: 'sales',
    schema: z.array(z.string().trim().min(1).max(80)).max(50),
    default: DEFAULT_FACILITY_SIZES, // provisional (DECISIONS §20 Q7)
  }),
  'sales.lossReasons': def({
    key: 'sales.lossReasons',
    labelAr: 'أسباب خسارة الفرصة (مؤقتة حتى اعتماد المالك)',
    group: 'sales',
    schema: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
    default: DEFAULT_LOSS_REASONS, // provisional (DECISIONS §20 Q7)
  }),
  'sales.lists': def({
    key: 'sales.lists',
    labelAr:
      'قوائم طلبات المبيعات (أنواع الحاويات وأحجامها وألوانها، أنواع العقود، أنواع النفايات والخدمة، مواد الإتلاف، تصنيفات السكراب وأنواع مهامه، مصادر المناقصات)',
    descriptionAr:
      'تبدأ فارغة قابلة للتعديل حتى يرسلها المالك (DECISIONS §20 Q7)؛ النماذج تقبل نصًا حرًا عندما تكون القائمة فارغة',
    group: 'sales',
    schema: z.record(z.enum(SALES_LIST_KEYS), z.array(z.string().trim().min(1).max(120)).max(100)),
    default: Object.fromEntries(SALES_LIST_KEYS.map((k) => [k, [] as string[]])) as Record<
      (typeof SALES_LIST_KEYS)[number],
      string[]
    >,
  }),
  'sales.scrapTransferRoles': def({
    key: 'sales.scrapTransferRoles',
    labelAr: 'الأدوار المخوّلة بتسجيل «حالة تحويل المبلغ» في السكراب',
    descriptionAr:
      'إلى أن يجيب المالك عن Q16 (DECISIONS §20): التحويل حالة مع إثبات إلزامي ويُشعَر القسم المالي [OPS §2.2]',
    group: 'sales',
    schema: z.array(z.string()).min(1),
    default: ['sales_manager', 'finance_manager', 'finance_staff'],
  }),
  'sales.followUpReminderHours': def({
    key: 'sales.followUpReminderHours',
    labelAr: 'التنبيه قبل موعد متابعة العميل (ساعات)',
    descriptionAr: 'إشعار «قرب موعد متابعة العميل» للموظف المسؤول [SAL §10.2, §14]',
    group: 'sales',
    schema: z
      .number()
      .int()
      .min(0)
      .max(24 * 7),
    default: 24,
  }),
  'auth.sessionIdleMinutes': def({
    key: 'auth.sessionIdleMinutes',
    labelAr: 'مهلة الخمول للجلسة (دقائق)',
    group: 'auth',
    schema: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
    default: 30, // DECISIONS §2
  }),
  'auth.sessionMaxHours': def({
    key: 'auth.sessionMaxHours',
    labelAr: 'الحد الأقصى لعمر الجلسة (ساعات)',
    group: 'auth',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 7),
    default: 12, // DECISIONS §2
  }),
  'auth.mfaRequiredRoles': def({
    key: 'auth.mfaRequiredRoles',
    labelAr: 'الأدوار التي يُلزم فيها التحقق الثنائي',
    group: 'auth',
    schema: z.array(z.string()),
    default: ['system_admin', 'hr_officer', 'hr_manager', 'finance_staff', 'finance_manager'], // DECISIONS §2
  }),
  'auth.maxFailedLogins': def({
    key: 'auth.maxFailedLogins',
    labelAr: 'عدد محاولات الدخول الفاشلة قبل القفل المؤقت',
    group: 'auth',
    schema: z.number().int().min(3).max(20),
    default: 5,
  }),
  'auth.lockoutMinutes': def({
    key: 'auth.lockoutMinutes',
    labelAr: 'مدة القفل المؤقت (دقائق)',
    group: 'auth',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    default: 15,
  }),
  'auth.passwordMinLength': def({
    key: 'auth.passwordMinLength',
    labelAr: 'الحد الأدنى لطول كلمة المرور',
    group: 'auth',
    schema: z.number().int().min(8).max(64),
    default: 10,
  }),
  'auth.mfaMaxFailuresPerUser': def({
    key: 'auth.mfaMaxFailuresPerUser',
    labelAr: 'عدد رموز التحقق الخاطئة قبل قفل المصادقة للمستخدم',
    group: 'auth',
    schema: z.number().int().min(3).max(50),
    default: 10, // slice 5 review follow-up 1
  }),
  'auth.mfaFailureWindowMinutes': def({
    key: 'auth.mfaFailureWindowMinutes',
    labelAr: 'نافذة احتساب رموز التحقق الخاطئة (دقائق)',
    group: 'auth',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    default: 30,
  }),
  'auth.mfaLockMinutes': def({
    key: 'auth.mfaLockMinutes',
    labelAr: 'مدة قفل المصادقة الثنائية للمستخدم (دقائق)',
    group: 'auth',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    default: 30,
  }),
  'auth.temporaryPasswordHours': def({
    key: 'auth.temporaryPasswordHours',
    labelAr: 'صلاحية كلمة المرور المؤقتة (ساعات)',
    descriptionAr: 'بعدها يُرفض الدخول بكلمة المرور المؤقتة ويلزم إعادة تعيينها من مدير النظام',
    group: 'auth',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    default: 72, // security review A8
  }),
  'tasks.unassignedReminderBusinessDays': def({
    key: 'tasks.unassignedReminderBusinessDays',
    labelAr: 'تذكير مدير القسم بالمهام غير المسندة بعد (أيام عمل)',
    group: 'notifications',
    schema: z.number().int().min(1),
    default: 1, // EP §16: the manager distributes department work
  }),
  'news.staffAuthoringDepartments': def({
    key: 'news.staffAuthoringDepartments',
    labelAr: 'موظفو القسم يكتبون أخبار قسمهم ويرسلونها لاعتماد المدير (لكل قسم؛ الافتراضي مفعّل)',
    group: 'general',
    schema: z.record(z.string(), z.boolean()),
    default: {}, // slice 5 review change: missing department = on [EP §12.2, §12.3.3]
  }),
  'news.directPublishRoles': def({
    key: 'news.directPublishRoles',
    labelAr: 'الأدوار التي تنشر مباشرة دون اعتماد (مع قسم من أقسام النشر المباشر)',
    group: 'general',
    schema: z.array(z.string()),
    default: ['hr_officer', 'hr_manager', 'executive'], // go-live review E4
  }),
  'news.directPublishDepartments': def({
    key: 'news.directPublishDepartments',
    labelAr: 'أقسام تنشر أخبارها وتعاميمها مباشرة دون اعتماد',
    group: 'general',
    schema: z.array(z.string()),
    default: ['hr', 'executive'], // DECISIONS §10
  }),
  'tickets.hiddenTargets': def({
    key: 'tickets.hiddenTargets',
    labelAr: 'أقسام لا تظهر كوجهة للتذاكر حتى تُبنى وحداتها (المالية والمشتريات)',
    group: 'tickets',
    schema: z.array(z.string()),
    default: ['finance', 'procurement'], // DECISIONS §8: same record as FIN §3 / PRC §2 once those modules exist
  }),
  'tickets.managersOnlyTargets': def({
    key: 'tickets.managersOnlyTargets',
    labelAr: 'أقسام تظهر كوجهة لمديري الأقسام فقط',
    group: 'tickets',
    schema: z.array(z.string()),
    default: ['finance', 'procurement'], // EP §9.1 note
  }),
  'tickets.departmentFields': def({
    key: 'tickets.departmentFields',
    labelAr: 'حقول التذاكر الخاصة بكل قسم (نوع، تسميات الأولوية…)',
    group: 'tickets',
    schema: ticketDepartmentFieldsSchema,
    default: DEFAULT_TICKET_DEPARTMENT_FIELDS, // IT §7.1
  }),
  'tickets.staffQueueDepartments': def({
    key: 'tickets.staffQueueDepartments',
    labelAr: 'موظفو القسم يرون قائمة تذاكر قسمهم ويستلمون غير المسند منها (لكل قسم؛ الافتراضي مفعّل)',
    group: 'tickets',
    schema: z.record(z.string(), z.boolean()),
    default: {}, // slice 4 review change 1: missing department = enabled
  }),
  'tickets.remindAfterBusinessDays': def({
    key: 'tickets.remindAfterBusinessDays',
    labelAr: 'تذكير مقدّم الطلب بعد الحل (أيام عمل)',
    group: 'tickets',
    schema: z.number().int().min(1),
    default: 3, // DECISIONS §8
  }),
  'tickets.autoCloseAfterBusinessDays': def({
    key: 'tickets.autoCloseAfterBusinessDays',
    labelAr: 'الإغلاق التلقائي بعد الحل (أيام عمل)',
    group: 'tickets',
    schema: z.number().int().min(1),
    default: 5, // DECISIONS §8
  }),
  'tickets.reopenWithinDays': def({
    key: 'tickets.reopenWithinDays',
    labelAr: 'السماح بإعادة الفتح خلال (أيام)',
    group: 'tickets',
    schema: z.number().int().min(1),
    default: 10, // DECISIONS §8
  }),
  'outbox.retentionDays': def({
    key: 'outbox.retentionDays',
    labelAr: 'الاحتفاظ بالأحداث المُسلَّمة في صندوق الأحداث (أيام)',
    descriptionAr:
      'تُحذف الأحداث المُسلَّمة الأقدم من هذه المدة يوميًا. الأحداث الفاشلة أو غير المعالَجة لا تُحذف.',
    group: 'system',
    schema: z.number().int().min(7).max(3650),
    default: 90, // go-live review G8
  }),
  'outbox.replayWindowDays': def({
    key: 'outbox.replayWindowDays',
    labelAr: 'إعادة تشغيل الأحداث غير المعالَجة لمشترك جديد خلال (أيام)',
    descriptionAr:
      'حدث لم يكن له مشترك ويزيد عمره عن هذه المدة يُعلَّم "منتهيًا" بدل إعادة تشغيله، ويمكن للمسؤول إعادته يدويًا.',
    group: 'system',
    schema: z.number().int().min(1).max(3650),
    default: 30, // go-live review G8
  }),
  'hr.advanceLimitHalalas': def({
    key: 'hr.advanceLimitHalalas',
    labelAr: 'الحد الأقصى للسلفة (هللة). فارغ = غير محدد بعد، يُعلَّم الطلب للموارد البشرية',
    group: 'hr',
    schema: z.number().int().positive().nullable(),
    default: null, // DECISIONS §5: not decided
  }),
  'hr.probationAlertDaysBefore': def({
    key: 'hr.probationAlertDaysBefore',
    labelAr: 'تنبيه انتهاء فترة التجربة قبل (أيام)',
    group: 'hr',
    schema: z.array(z.number().int().min(0)),
    default: [30, 7], // slice 1 review: time for HR to decide on an extension
  }),
  'hr.secondmentReportFirstReminderDays': def({
    key: 'hr.secondmentReportFirstReminderDays',
    labelAr: 'تذكير برفع تقرير الانتداب بعد انتهائه بـ (أيام)',
    group: 'hr',
    schema: z.number().int().min(0),
    default: 1, // slice 2 review: the day after the end date
  }),
  'hr.secondmentReportSecondReminderBusinessDays': def({
    key: 'hr.secondmentReportSecondReminderBusinessDays',
    labelAr: 'التذكير الثاني بعد الأول بـ (أيام عمل)',
    group: 'hr',
    schema: z.number().int().min(1),
    default: 3, // slice 2 review
  }),
  'hr.reportTypes': def({
    key: 'hr.reportTypes',
    labelAr: 'أنواع تقارير الموظفين إلى المدير المباشر',
    group: 'hr',
    schema: reportTypesSchema,
    default: [...DEFAULT_REPORT_TYPES] as { code: string; labelAr: string }[], // EP §14.1
  }),
  'hr.requestRoutes': def({
    key: 'hr.requestRoutes',
    labelAr: 'مسارات طلبات الموظفين: عبر المدير المباشر؟ ومن يعتمد نهائيًا',
    group: 'hr',
    schema: hrRequestRoutesSchema,
    default: DEFAULT_HR_REQUEST_ROUTES, // DECISIONS §5
  }),
  'hr.requestStageSlaBusinessDays': def({
    key: 'hr.requestStageSlaBusinessDays',
    labelAr: 'مهلة كل مرحلة في طلبات الموظفين (أيام عمل)',
    group: 'hr',
    schema: z.number().int().min(1),
    default: 2, // DECISIONS §5
  }),
  'notifications.emailEnabled': def({
    key: 'notifications.emailEnabled',
    labelAr: 'تفعيل قناة البريد الإلكتروني للإشعارات',
    group: 'notifications',
    schema: z.boolean(),
    default: false, // DECISIONS §9: off until the sending domain is verified
  }),
  'notifications.taskReminderDaysBefore': def({
    key: 'notifications.taskReminderDaysBefore',
    labelAr: 'تذكير بالمهمة قبل الاستحقاق بـ (أيام)',
    group: 'notifications',
    schema: z.number().int().min(0),
    default: 1,
  }),
  'documents.expiryAlertOffsetsDays': def({
    key: 'documents.expiryAlertOffsetsDays',
    labelAr: 'تنبيهات انتهاء الوثائق قبل (أيام)',
    group: 'general',
    schema: z.array(z.number().int().min(0)),
    default: [90, 30, 7],
  }),
  'general.organizationNameAr': def({
    key: 'general.organizationNameAr',
    labelAr: 'اسم الجهة',
    group: 'general',
    schema: z.string().min(1),
    default: 'جمعية عيني لإعادة التدوير التعاونية',
  }),
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFINITIONS)[K]['default'];
export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];
