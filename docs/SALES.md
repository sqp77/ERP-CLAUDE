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

## S2 — إدارة الخدمات والطلبات [SAL §17 المرحلة الثانية] (built 2026-11-12)

Extra accounts: **nasser@eayni.local** (مدير المشتريات), **talal@** (مشتريات), **abdulaziz@** (مدير المالية, `finance_manager`), **shahad@** (`finance_staff`), **khalid@** (مدير التشغيل), **omar@** (تشغيل).

1. **Rep (reem)** → «المبيعات» → «الخدمات» lists the seven services; pick «بيع الحاويات» → the screen shows that service's own fields (lists such as نوع الحاوية are free text until the owner sends them — hint shown). Choose the customer, fill العدد, attach a file, save → the request `CSR-…` opens with «المبيعات» as holder.
2. **Request page**: «الإجراءات المتاحة لك» shows only what the workflow allows this user from this state: إعداد عرض السعر → إرسال العرض → موافقة العميل → رفع طلب إلى المشتريات. Each hop appears in «سجل انتقال الطلب بين الأقسام».
3. **Procurement (talal)** → «الطلبات الواردة من المبيعات» (menu item appears only for Procurement / Finance / Operations members): the request is there with its SLA; open it → the Sales data is read-only, the Procurement panel takes المورد + عرض المورد → «تحويل إلى المالية للاعتماد». Nasser and talal received «وصول طلب جديد إلى المشتريات».
4. **Finance (shahad)** → the request is in her queue; she may only «يحتاج استكمال بيانات» (with a reason) — the request returns to reem who «إعادة الإرسال إلى المالية». **abdulaziz** → «اعتماد»; reem and nasser get «اعتماد أو رفض الطلب من المالية». Try approving with reem's own Finance account: refused (approver ≠ creator).
5. **Procurement (nasser)**: بدأ التنفيذ → قيد المعالجة (تاريخ التسليم) → تم الإنجاز (نموذج الاستلام) → «إحالة إلى التشغيل»; reem gets «تحديث حالة الطلب من المشتريات» at each step.
6. **Operations (omar)**: the request shows OPS labels — جديد (3 business days to «مجدول», counted over Friday–Saturday and holidays; the row turns red when exceeded and the manager can add «سبب التأخر» with الجهة المسؤولة) → «جدولة الزيارة» creates a visit on the shared calendar with reem as participant → قيد التنفيذ → مكتمل with الكميات والأوزان and محاضر التسليم → reem gets «اكتمال التنفيذ من التشغيل».
7. **Rep (reem)**: «تم الإغلاق بنجاح» → Operations is notified; or «تم الإغلاق دون استكمال» (reason). Only the manager may «تم إيقاف المشروع» / «تم إلغاء المشروع».
8. **Rental (seeded `RNT-…`, at Operations, مجدول)**: omar opens it → «نموذج توثيق جديد» → اختر «نموذج قبل التسليم», photos (required), رقم الحاوية, حالة الحاوية, signature upload. Three phases, append-only, each with employee and time.
9. **Scrap (seeded `SCR-…`)**: visible to Sales and Operations from the start. Omar: «تسجيل تقييم» (photos, weight, categories, proposed price) → «تسجيل نتيجة التقييم»; majed: «الاتفاق على السعر»; omar: «جدولة السحب» → «تسجيل الوزن الفعلي ومحضر الاستلام» (Sales and Finance notified); sultan (allowed role, setting `sales.scrapTransferRoles`): «تسجيل تحويل المبلغ» with the proof file. «رفع مهمة» (khalid → omar): a task with حالة المهمة «تمت / لم تتم» and حالة تحويل المبلغ.
10. **Destruction (seeded `DST-…`, at Operations)**: omar records «تسجيل التقدير» (الوزن التقديري) → the request returns to reem at «إعداد عرض السعر»; after the customer approves → المالية → after approval → التشغيل (3 business days) → «مكتمل» requires محضر الاستلام.
11. **Asset return (seeded `ARO-…`)**: قيد الدراسة → قيد التفاوض → «لم يتم التعاون» requires a reason; the owner is reminded before موعد المحادثة القادمة.
