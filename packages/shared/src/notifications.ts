/** Notification types. The first 18 are the portal list [EP §15]; others come from modules. */
export const NOTIFICATION_TYPES = [
  'task.assigned', // 1 إسناد مهمة جديدة
  'task.due_soon', // 2 اقتراب موعد مهمة
  'task.overdue', // 3 تأخر مهمة عن موعدها
  'meeting.created', // 4 إضافة اجتماع جديد
  'meeting.reminder', // 5 تذكير بموعد اجتماع
  'ticket.created', // 6 وصول طلب أو تذكرة جديدة
  'ticket.updated', // 7 تحديث حالة التذكرة
  'request.decided', // 8 الموافقة على طلب أو رفضه
  'news.published', // 9 نشر خبر أو تعميم جديد
  'contract.expiring', // 10 اقتراب انتهاء العقد
  'probation.ending', // 11 انتهاء فترة التجربة
  'employee.birthday', // 12 يوم ميلاد الموظف
  'report.requested', // 13 طلب رفع تقرير
  'secondment.report_reminder', // 14 تذكير برفع تقرير الانتداب
  'employee.manager_or_department_changed', // 15 تغيير المدير المباشر أو القسم
  'employee.promotion', // 16 اعتماد ترقية أو تغيير وظيفي
  'training.added', // 17 إضافة دورة تدريبية
  'employee.data_updated', // 18 تحديث بيانات الموظف
  // platform
  'document.expiring',
  'comment.mention',
  'auth.password_reset',
  'auth.new_login',
  'security.alert',
  // tasks distribution [EP §10, EP §16]
  'task.review_requested',
  'task.approved',
  'task.returned',
  'task.reassigned',
  'task.unassigned_reminder',
  // tickets [EP §9]
  'ticket.assigned',
  'ticket.info_requested',
  'ticket.resolved',
  'ticket.confirm_reminder',
  'ticket.auto_closed',
  'ticket.reopened',
  'ticket.closed',
  // Sales / CRM [SAL §14] — numbers are the spec's list
  'crm.lead.referred', // 1 وصول عميل جديد من خدمة العملاء
  'crm.customer.assigned', // 2 إسناد عميل إلى موظف
  'crm.followup.due', // 3 قرب موعد متابعة العميل
  'crm.owner_changed', // 16 تغيير الموظف المسؤول عن العميل أو الطلب
  'crm.lead.overdue', // the 24-hour rule [SAL §3, DECISIONS §20 Q13]
  'sales.opportunity.assigned',
  // Sales requests [SAL §14 7–10, §19, OPS §2.2]
  'sales.request.to_procurement', // 7 وصول طلب جديد إلى المشتريات
  'sales.request.finance_decided', // 8 اعتماد أو رفض الطلب من المالية
  'sales.request.procurement_updated', // 9 تحديث حالة الطلب من المشتريات
  'sales.request.operations_completed', // 10 اكتمال التنفيذ من التشغيل
  'sales.request.to_finance',
  'sales.request.to_operations',
  'sales.request.updated',
  'sales.request.closed',
  'sales.request.overdue',
  'sales.scrap.transfer',
  'sales.assetreturn.reminder',
  // Quotes, invoices, contracts [SAL §14 5, 6, 11–14]
  'sales.quote.status', // 5 تحديث حالة عرض السعر
  'sales.quote.decided', // 6 اعتماد أو رفض عرض السعر
  'sales.quote.approval_requested',
  'finance.invoice.issued', // 11 إصدار فاتورة جديدة
  'finance.invoice.overdue', // 12 تأخر سداد الفاتورة
  'sales.contract.expiring', // 13 اقتراب انتهاء عقد
  'sales.contract.renewal_due', // 14 اقتراب موعد تجديد التعاون
  // S4 [SAL §9, §10.3, §11.1, §14 (15)]
  'discussion.opened', // 15 وجود مشكلة أو استفسار من قسم آخر
  'discussion.replied',
  'discussion.state_changed',
  'sales.marketing_notice', // §9 فعالية تحتاج دعم التسويق
  'sales.target.changed',
  'generic',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TITLES_AR: Record<NotificationType, string> = {
  'task.assigned': 'تم إسناد مهمة جديدة إليك',
  'task.due_soon': 'اقترب موعد استحقاق مهمة',
  'task.overdue': 'تأخرت مهمة عن موعدها',
  'meeting.created': 'تمت إضافة اجتماع جديد',
  'meeting.reminder': 'تذكير بموعد اجتماع',
  'ticket.created': 'وصلت تذكرة جديدة',
  'ticket.updated': 'تم تحديث حالة التذكرة',
  'request.decided': 'تم البت في طلبك',
  'news.published': 'نُشر خبر أو تعميم جديد',
  'contract.expiring': 'اقترب انتهاء العقد',
  'probation.ending': 'انتهاء فترة التجربة',
  'employee.birthday': 'كل عام وأنت بخير',
  'report.requested': 'مطلوب منك رفع تقرير',
  'secondment.report_reminder': 'تذكير برفع تقرير الانتداب',
  'employee.manager_or_department_changed': 'تم تغيير المدير المباشر أو القسم',
  'employee.promotion': 'تم اعتماد تغيير وظيفي',
  'training.added': 'تمت إضافة دورة تدريبية',
  'employee.data_updated': 'تم تحديث بياناتك',
  'document.expiring': 'اقترب انتهاء وثيقة',
  'comment.mention': 'تمت الإشارة إليك في تعليق',
  'auth.password_reset': 'طلب إعادة تعيين كلمة المرور',
  'auth.new_login': 'تسجيل دخول جديد إلى حسابك',
  'security.alert': 'تنبيه أمني',
  'task.review_requested': 'مهمة بانتظار مراجعتك',
  'task.approved': 'تم اعتماد إنجاز مهمتك',
  'task.returned': 'أُعيدت إليك مهمة للاستكمال',
  'task.reassigned': 'أُعيد إسناد مهمة',
  'task.unassigned_reminder': 'مهام في قائمة القسم بلا مكلّف',
  'ticket.assigned': 'أُسندت إليك تذكرة',
  'ticket.info_requested': 'تذكرتك بحاجة إلى معلومات إضافية',
  'ticket.resolved': 'تم حل تذكرتك — يرجى التأكيد أو إعادة الفتح',
  'ticket.confirm_reminder': 'تذكير: تذكرتك بانتظار تأكيدك',
  'ticket.auto_closed': 'أُغلقت تذكرتك تلقائيًا',
  'ticket.reopened': 'أُعيد فتح تذكرة',
  'ticket.closed': 'أُغلقت التذكرة',
  'crm.lead.referred': 'وصول عميل جديد من خدمة العملاء',
  'crm.customer.assigned': 'إسناد عميل إلى موظف',
  'crm.followup.due': 'قرب موعد متابعة العميل',
  'crm.owner_changed': 'تغيير الموظف المسؤول عن العميل أو الطلب',
  'crm.lead.overdue': 'عميل محتمل لم يُسجَّل خلال المهلة',
  'sales.opportunity.assigned': 'إسناد فرصة بيعية إليك',
  'sales.request.to_procurement': 'وصول طلب جديد إلى المشتريات',
  'sales.request.finance_decided': 'اعتماد أو رفض الطلب من المالية',
  'sales.request.procurement_updated': 'تحديث حالة الطلب من المشتريات',
  'sales.request.operations_completed': 'اكتمال التنفيذ من التشغيل',
  'sales.request.to_finance': 'وصول طلب من المبيعات إلى المالية',
  'sales.request.to_operations': 'وصول طلب من المبيعات إلى التشغيل',
  'sales.request.updated': 'تحديث على طلب مبيعات',
  'sales.request.closed': 'إغلاق طلب مبيعات',
  'sales.request.overdue': 'طلب مبيعات تجاوز مهلة المرحلة',
  'sales.scrap.transfer': 'تحويل مبلغ سكراب',
  'sales.assetreturn.reminder': 'موعد المحادثة القادمة لفرصة رجيع أصول',
  'sales.quote.status': 'تحديث حالة عرض السعر',
  'sales.quote.decided': 'اعتماد أو رفض عرض السعر',
  'sales.quote.approval_requested': 'عرض سعر بانتظار اعتمادك',
  'finance.invoice.issued': 'إصدار فاتورة جديدة',
  'finance.invoice.overdue': 'تأخر سداد الفاتورة',
  'sales.contract.expiring': 'اقتراب انتهاء عقد',
  'sales.contract.renewal_due': 'اقتراب موعد تجديد التعاون',
  'discussion.opened': 'وجود مشكلة أو استفسار من قسم آخر',
  'discussion.replied': 'رد جديد في نقاش بين الأقسام',
  'discussion.state_changed': 'تحديث حالة نقاش بين الأقسام',
  'sales.marketing_notice': 'فعالية تحتاج دعم قسم التسويق',
  'sales.target.changed': 'تحديث مستهدفك الشهري',
  generic: 'إشعار',
};
