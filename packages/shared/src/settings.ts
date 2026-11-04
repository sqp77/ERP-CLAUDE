import { z } from 'zod';

/**
 * Settings registry: everything the specs want configurable lives here with a default and a schema
 * (golden rule 10). Values are stored in the `settings` collection and edited from the admin screen.
 */
export interface SettingDefinition<T = unknown> {
  key: string;
  labelAr: string;
  descriptionAr?: string;
  group: 'auth' | 'tickets' | 'hr' | 'notifications' | 'general';
  schema: z.ZodType<T>;
  default: T;
}

function def<T>(d: SettingDefinition<T>): SettingDefinition<T> {
  return d;
}

export const SETTING_DEFINITIONS = {
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
