/** Employee work status — merged list, DECISIONS §6 [HR §3.1.7, EP §5.3]. */
export const EMPLOYEE_STATUSES = [
  'active', // على رأس العمل
  'on_leave', // إجازة
  'field_work', // عمل ميداني (counts as on duty)
  'seconded', // انتداب
  'suspended', // موقوف
  'resigned', // مستقيل
  'terminated', // منتهي الخدمة
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_AR: Record<EmployeeStatus, string> = {
  active: 'على رأس العمل',
  on_leave: 'إجازة',
  field_work: 'عمل ميداني',
  seconded: 'انتداب',
  suspended: 'موقوف',
  resigned: 'مستقيل',
  terminated: 'منتهي الخدمة',
};

/** Account status [EP §5.3]. */
export const ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Priority used by tickets, tasks and requests. */
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_AR: Record<Priority, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  urgent: 'عاجلة',
};

/** Workflow state category — drives queues, SLA and "open items" counts. */
export const STATE_CATEGORIES = ['open', 'waiting', 'done', 'cancelled'] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

/** Audit actions. Views, downloads and sends of sensitive data are audited too (golden rule 4). */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'view',
  'download',
  'send',
  'export',
  'login',
  'logout',
  'transition',
  'approve',
  'reject',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Task statuses [EP §10.1, MKT §11]. */
export const TASK_STATUSES = ['new', 'in_progress', 'waiting_review', 'done', 'late', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_AR: Record<TaskStatus, string> = {
  new: 'جديدة',
  in_progress: 'قيد التنفيذ',
  waiting_review: 'بانتظار المراجعة',
  done: 'مكتملة',
  late: 'متأخرة',
  cancelled: 'ملغاة',
};

/** Calendar event types and statuses [EP §13, SAL §9]. */
export const EVENT_TYPES = ['meeting', 'visit', 'training', 'secondment', 'follow_up', 'event', 'task', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_STATUSES = ['scheduled', 'done', 'not_done', 'rescheduled', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_STATUS_AR: Record<EventStatus, string> = {
  scheduled: 'مجدول',
  done: 'تم',
  not_done: 'لم يتم',
  rescheduled: 'إعادة جدولة',
  cancelled: 'ملغي',
};
