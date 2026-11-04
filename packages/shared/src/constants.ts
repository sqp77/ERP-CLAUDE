/** Shared constants. Times are stored in UTC and rendered in Asia/Riyadh (CLAUDE.md "Language and locale"). */
export const TIMEZONE = 'Asia/Riyadh';
/** Friday and Saturday (JS getDay: 0 = Sunday). */
export const WEEKEND_DAYS: readonly number[] = [5, 6];
export const CURRENCY = 'SAR';
export const VAT_RATE_PERCENT = 15;
export const LOCALE = 'ar';
export const HIJRI_LOCALE = 'ar-SA-u-ca-islamic-umalqura';

/** Department codes. Seeded per DECISIONS §3: the nine of EP §9.1 plus executive management. */
export const DEPARTMENT_CODES = [
  'hr',
  'it',
  'ops',
  'sales',
  'marketing',
  'sustainability',
  'cs',
  'procurement',
  'finance',
  'executive',
] as const;
export type DepartmentCode = (typeof DEPARTMENT_CODES)[number];

export const DEPARTMENT_NAMES_AR: Record<DepartmentCode, string> = {
  hr: 'الموارد البشرية',
  it: 'التقنية',
  ops: 'التشغيل',
  sales: 'المبيعات',
  marketing: 'التسويق',
  sustainability: 'التنمية المستدامة والشراكات',
  cs: 'خدمة العملاء',
  procurement: 'المشتريات',
  finance: 'المالية',
  executive: 'الإدارة التنفيذية',
};
