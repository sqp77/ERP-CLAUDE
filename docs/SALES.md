# Sales module — demo script per slice

Local: `npm run seed` then `npm run dev`; sample accounts use `Sample12345!` (see README). Staging: `seedStagingDemo` returns the passwords once.

## S1 — قاعدة بيانات المبيعات [SAL §17 المرحلة الأولى] (built 2026-11-12)

Accounts: **sultan@eayni.local** (مدير المبيعات: department manager of Sales, Sales-manager rights implied), **reem@eayni.local** and **majed@eayni.local** (موظفو مبيعات), **arwa@eayni.local** (خدمة العملاء), **abdullah@eayni.local** (الإدارة التنفيذية, read-only).

1. **Rep (reem)** → menu «المبيعات» → «الواجهة الرئيسية للمبيعات»: counters for my customers, follow-ups due today, open and overdue opportunities, leads assigned to me. Button «الخدمات» lists the seven services (screens arrive in S2).
2. «عميل جديد / فرصة بيعية جديدة»: type «شركة الخليج» in the name — the duplicate warning appears while typing (reem owns it, so the number shows). Type «مصنع الشرق للحديد» — only «هذه الجهة مسجلة لدى موظف آخر — راجع مدير القسم» (majed's file never leaks). Fill a new organization with 3 contacts (the 4th «إضافة» button disappears) and tick «إضافة فرصة بيعية»; save → the customer file opens.
3. **Customer file**: tabs سجل التواصل / الأشخاص المسؤولون / الفرص البيعية / بيانات الجهة / السجل. On a phone (375 px) the log composer sits under the log: pick «زيارة», write details, set «موعد المتابعة القادمة», attach a photo, save. The entry shows your name and the time; there is no edit or delete.
4. **Pipeline** «الفرص البيعية»: Kanban by the eight stages (column totals in SAR), table view, filters by stage / service / tag / follow-up overdue. Open «تأجير حاويات لمعرض» (lost) to see the reason; move another opportunity to «خاسرة» without a reason → refused; pick a reason from the provisional list.
5. **Manager (sultan)** → «العملاء»: sees both reps' files; filter by «الموظف المسؤول»; select several and «نقل … عميل» with a reason → both reps get notifications («إسناد عميل إلى موظف» / «تغيير الموظف المسؤول»); the file's «السجل» tab shows the transfer with the reason. «إدارة التصنيفات»: add «#منطقة_الشرقية», rename it, see the records follow. In a file's «بيانات الجهة» set «تصنيف العميل» (reps cannot).
6. **Customer Service (arwa)** → «إحالة عميل محتمل إلى المبيعات»: fill «مطعم النخيل» → sultan receives «وصول عميل جديد من خدمة العملاء». Arwa's list shows what Sales did with each referral.
7. **Manager** → «العملاء المحتملون»: the seeded «مجمع الواحة السكني» carries the red «متأخر عن التسجيل» badge (referred 30 h ago, 24 h rule); assign the new lead to reem → reem gets «إسناد عميل إلى موظف».
8. **Rep (reem)** → «العملاء المحتملون» → «المسندون إليّ» → open the lead → «تحويل إلى عميل» with an opportunity → a customer with source «خدمة العملاء», linked to the lead (file tab «بيانات الجهة» → «محال من خدمة العملاء»).
9. **Executive (abdullah)**: «العملاء» and «الفرص البيعية» list everything, read-only (no «عميل جديد» button; the API refuses creation).
10. **Admin** → «الإعدادات» → groups «إدارة العملاء (CRM)» and «المبيعات»: the 24-hour setting, organization types, provisional facility sizes and loss reasons, follow-up reminder hours. «الأدوار والصلاحيات»: `sales_rep` / `sales_manager` are editable system roles; editing your own role is refused.
