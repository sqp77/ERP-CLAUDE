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
  generic: 'إشعار',
};
