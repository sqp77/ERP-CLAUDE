import type { WorkflowDefinitionInput } from '@eayni/shared';

/**
 * Employee ticket [EP §9.4] — eight states; only the requester closes; reopen within N days (DECISIONS §8).
 * IT adds "متعثر" in its own copy of this config when the IT module arrives.
 */
export const TICKET_WORKFLOW: WorkflowDefinitionInput = {
  type: 'ticket',
  nameAr: 'تذكرة داخلية',
  initialState: 'new',
  states: {
    new: { labelAr: 'جديدة', category: 'open', slaBusinessDays: 1, owner: 'department' },
    under_review: { labelAr: 'قيد المراجعة', category: 'open', slaBusinessDays: 2, owner: 'department' },
    in_progress: { labelAr: 'قيد المعالجة', category: 'open', slaBusinessDays: 3, owner: 'assignee' },
    waiting_requester: { labelAr: 'بانتظار معلومات من الموظف', category: 'waiting', owner: 'requester' },
    resolved: { labelAr: 'تم الحل', category: 'waiting', owner: 'requester' },
    awaiting_confirmation: { labelAr: 'بانتظار تأكيد مقدم الطلب', category: 'waiting', owner: 'requester' },
    closed: { labelAr: 'مغلقة', category: 'done' },
    reopened: { labelAr: 'معاد فتحها', category: 'open', slaBusinessDays: 2, owner: 'assignee' },
  },
  transitions: [
    { code: 'review', labelAr: 'بدء المراجعة', from: ['new', 'reopened'], to: 'under_review', allow: ['department_manager', 'department_staff', 'assignee'] },
    { code: 'assign', labelAr: 'إسناد', from: ['new', 'under_review', 'reopened'], to: 'in_progress', allow: ['department_manager', 'department_staff'], requiredFields: ['assigneeId'] },
    { code: 'start', labelAr: 'بدء المعالجة', from: ['under_review', 'waiting_requester', 'reopened'], to: 'in_progress', allow: ['assignee', 'department_manager'] },
    { code: 'request_info', labelAr: 'طلب معلومات من الموظف', from: ['under_review', 'in_progress'], to: 'waiting_requester', allow: ['assignee', 'department_manager'], requireReason: true },
    { code: 'provide_info', labelAr: 'تزويد المعلومات', from: ['waiting_requester'], to: 'in_progress', allow: ['requester'] },
    { code: 'resolve', labelAr: 'تم الحل', from: ['in_progress', 'under_review', 'reopened'], to: 'resolved', allow: ['assignee', 'department_manager'], requiredFields: ['resolution'] },
    { code: 'ask_confirmation', labelAr: 'طلب تأكيد مقدم الطلب', from: ['resolved'], to: 'awaiting_confirmation', allow: ['assignee', 'department_manager', 'system'] },
    { code: 'close', labelAr: 'إغلاق', from: ['resolved', 'awaiting_confirmation'], to: 'closed', allow: ['requester', 'system'] },
    { code: 'reopen', labelAr: 'إعادة فتح', from: ['resolved', 'awaiting_confirmation', 'closed'], to: 'reopened', allow: ['requester'], requireReason: true },
  ],
  reopen: { from: ['closed'], to: 'reopened', allow: ['requester'], withinDays: 10 },
};

/** HR self-service request [HR §3.5]; the per-type route (skip manager or not) is applied by the HR module (DECISIONS §5). */
export const HR_REQUEST_WORKFLOW: WorkflowDefinitionInput = {
  type: 'hr_request',
  nameAr: 'طلب موظف',
  initialState: 'new',
  states: {
    new: { labelAr: 'جديد', category: 'open', owner: 'requester' },
    under_review: { labelAr: 'قيد المراجعة', category: 'open', slaBusinessDays: 2, owner: 'department' },
    awaiting_manager: { labelAr: 'بانتظار موافقة المدير', category: 'open', slaBusinessDays: 2, owner: 'direct_manager' },
    awaiting_hr: { labelAr: 'بانتظار الموارد البشرية', category: 'open', slaBusinessDays: 2, owner: 'department' },
    awaiting_final: { labelAr: 'بانتظار الاعتماد النهائي', category: 'open', slaBusinessDays: 2, owner: 'approver' },
    needs_completion: { labelAr: 'يحتاج استكمال', category: 'waiting', owner: 'requester' },
    approved: { labelAr: 'معتمد', category: 'done' },
    rejected: { labelAr: 'مرفوض', category: 'done' },
    closed: { labelAr: 'مغلق', category: 'done' },
  },
  transitions: [
    { code: 'submit_to_manager', labelAr: 'إرسال للمدير المباشر', from: ['new', 'needs_completion'], to: 'awaiting_manager', allow: ['requester'] },
    { code: 'submit_to_hr', labelAr: 'إرسال للموارد البشرية', from: ['new', 'needs_completion'], to: 'awaiting_hr', allow: ['requester'] },
    { code: 'manager_approve', labelAr: 'موافقة المدير', from: ['awaiting_manager'], to: 'awaiting_hr', allow: ['direct_manager'] },
    { code: 'manager_reject', labelAr: 'رفض المدير', from: ['awaiting_manager'], to: 'rejected', allow: ['direct_manager'], requireReason: true },
    { code: 'hr_return', labelAr: 'إعادة للاستكمال', from: ['awaiting_hr', 'awaiting_final'], to: 'needs_completion', allow: ['hr_officer', 'hr_manager'], requireReason: true },
    { code: 'hr_approve', labelAr: 'اعتماد الموارد البشرية', from: ['awaiting_hr'], to: 'approved', allow: ['hr_officer', 'hr_manager'] },
    { code: 'hr_forward_final', labelAr: 'تحويل للاعتماد النهائي', from: ['awaiting_hr'], to: 'awaiting_final', allow: ['hr_officer', 'hr_manager'] },
    { code: 'hr_reject', labelAr: 'رفض', from: ['awaiting_hr'], to: 'rejected', allow: ['hr_officer', 'hr_manager'], requireReason: true },
    { code: 'final_approve', labelAr: 'الاعتماد النهائي', from: ['awaiting_final'], to: 'approved', allow: ['approver', 'hr_manager', 'finance_manager', 'executive'] },
    { code: 'final_reject', labelAr: 'رفض نهائي', from: ['awaiting_final'], to: 'rejected', allow: ['approver', 'hr_manager', 'finance_manager', 'executive'], requireReason: true },
    { code: 'close', labelAr: 'إغلاق', from: ['approved', 'rejected'], to: 'closed', allow: ['hr_officer', 'hr_manager', 'system'] },
  ],
};

export const DEFAULT_WORKFLOWS: WorkflowDefinitionInput[] = [TICKET_WORKFLOW, HR_REQUEST_WORKFLOW];
