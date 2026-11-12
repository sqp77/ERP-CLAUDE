# SAL coverage — every bullet of `docs/SPECS.md` `# SAL — المبيعات` → where it lives → the test that proves it

Rule (prompt §0): nothing is dropped silently. A row that is not built yet names its slice or the decision it waits for. Spec text is verbatim. Slices: S1 customer database, S2 services and requests, S3 pricing/contracts/invoicing, S4 management, S5 reports/integration (SAL §17). Tests are in `apps/api/src/**/*.test.ts` unless noted.

Status legend: ✅ built · 🔜 planned slice · ⏸ waits for an owner answer (DECISIONS §20) or another module.

## §3 آلية العمل الرئيسية

| § | Bullet | Implementation | Test | Status |
|---|---|---|---|---|
| §3 م1 | استقبال طلب العميل أو الفرصة البيعية | «عميل جديد / فرصة بيعية جديدة» → `POST /crm/customers` (+ `opportunity`), `POST /sales/opportunities` | `sales-s1.test.ts` «creates the customer and its first opportunity together» | ✅ S1 |
| §3 م1 | استقبال العملاء المحتملين (Leads) من قسم خدمة العملاء | `leads` collection, CS form `/cs/refer-lead`, `POST /crm/leads`, notification 1 to Sales managers | `crm.test.ts` «leads: Customer Service refers…» | ✅ S1 |
| §3 م1 | تسجيل العميل أو الفرصة في نظام CRM خلال 24 ساعة | setting `crm.leadRegistrationHours` (24 clock hours, DECISIONS §20 Q13); job `crm.leads.overdue` flags once, notifies rep + managers; `?overdue=true` filter and badge | same test, «the 24-hour rule fires once» | ✅ S1 |
| §3 م1 | تحديد الموظف المسؤول عن متابعة العميل | `ownerUserId` on customer and opportunity; manager assigns leads (`POST /crm/leads/:id/assign`) and names an owner on creation | `crm.test.ts` leads test; `sales-s1.test.ts` reassign | ✅ S1 |
| §3 م1 | تسجيل احتياج العميل والخدمة المطلوبة | log field `customerNeed`; opportunity `serviceType` (the seven services) | `crm.test.ts` log test | ✅ S1 |
| §3 م1 | توثيق جميع المحادثات والاتصالات والاجتماعات | `communicationLogs` append-only (`POST/GET /crm/customers/:id/logs`) | `crm.test.ts` «communication log is append-only…» | ✅ S1 |
| §3 م2 | تحديد نوع الخدمة أو المادة؛ إعداد عرض السعر وفق قائمة الأسعار المعتمدة؛ مراعاة أسعار السوق الأسبوعية؛ تطبيق الخصومات وفق مصفوفة الصلاحيات؛ اعتماد العرض من مدير المبيعات ضمن حدود صلاحياته؛ تحويل ما يتجاوزها إلى المدير التنفيذي | `quotes` built from `priceItems` (effective price + weekly market price shown), `computeLines` + `approvalLevelFor` (settings `sales.discountLimitBp` / `sales.quoteApprovalMode`; limits unset → executive, quote marked «حدود الخصم غير محددة»), `submit` → `pending_approval` → `approve` by the level's holder only | `sales-s3.test.ts` «discount matrix: with the limits unset…», «with limits set…» | ✅ S3 (Q1 numbers pending) |
| §3 م3 | إرسال عرض السعر للعميل من خلال النظام؛ إمكانية الإرسال من بريد الموظف؛ إرفاق المستندات والصور؛ متابعة العميل وتوثيق ردوده؛ تحديث حالة العرض (مقبول، مرفوض، قيد التفاوض)؛ تسجيل أسباب الرفض | `POST /sales/quotes/:id/send` (customer document generated and stored; mailbox adapter `core/email`, disabled per Q5 → draft + `mailto:`, «أُرسل خارج النظام»); `respond` with the three states, rejection reason from `sales.quoteRejectionReasons`; revisions as new versions | «discount matrix…» (send → draft_unsent + mailto, reject needs reason, revise v2) | ✅ S3 (sending from the system waits for Q5) |
| §3 م4 | الحصول على موافقة العميل؛ توقيع العقد أو أمر البيع؛ إحالة إلى المشتريات عند الحاجة → المالية → مستندات الشراء | quote `accepted` → `salesOrders` (net lines snapshot, signed file) and `customer_approve` on the linked request; Procurement / Finance stages (S2) | «acceptance → sales order…»; S2 container-sale test | ✅ S2+S3 |
| §3 م5 | التنفيذ والتسليم (التشغيل، الأوزان، محاضر الاستلام) | thin Operations stage with OPS §2.1 labels (DECISIONS §20 change 5) | — | 🔜 S2 |
| §3 م6 | إصدار الفاتورة الإلكترونية بناءً على أمر البيع والاعتمادات؛ إرسالها؛ متابعة التحصيل مع المالية؛ تسجيل حالة السداد والمبالغ المستحقة؛ إغلاق الصفقة | `modules/finance` invoice register (Q4 option A: Finance records the invoice issued in the current system against the order; lines/customer from the order), payments append-only, collection state مستحق / محصل جزئياً / محصل بالكامل / متأخر, order → مفوتر → مغلق; Sales reads only | «acceptance → sales order; Finance registers the issued invoice…» | ✅ S3 (e-invoice issuance itself waits for Q4 / ZATCA) |
| §3 ملاحظة | انتقال الطلب تلقائياً إلى القسم التالي مع إشعار للموظف المسؤول ومدير القسم | workflow definitions per service + hand-off events + notifications 7–10 | — | 🔜 S2 |

## §4 إدارة العملاء والفرص البيعية (CRM)

| § | Bullet | Implementation | Test | Status |
|---|---|---|---|---|
| §4.1 | زر رئيسي باسم (عميل جديد / فرصة بيعية جديدة) | `SalesHomePage`, `CustomersPage` → `NewCustomerDialog` (customer + ≤3 contacts + first opportunity) | `sales-s1.test.ts` «creates the customer and its first opportunity together» | ✅ S1 |
| §4.1 أولاً | اسم الجهة، الدولة، المنطقة، المدينة، النشاط، نوع الجهة (حكومي، خاص، عام)، حجم المنشأة، مصدر العميل | `customers` fields; `crm.organizationTypes` (SAL list, Q8), `sales.facilitySizes` (provisional, Q7) settings; `GET /crm/meta` | `crm.test.ts` first test (create with all fields) | ✅ S1 |
| §4.1 مصادر العملاء | وسائل التواصل الاجتماعي، الزيارات الميدانية، الترشيحات، خدمة العملاء، الاتصالات المباشرة، المعارض والمؤتمرات، مصادر أخرى | `CUSTOMER_SOURCES` + `sales.sources.*` labels verbatim; a converted lead is forced to «خدمة العملاء» | `crm.test.ts` leads test (`source: 'customer_service'`) | ✅ S1 |
| §4.1 ثانياً | الأشخاص المسؤولون بحد أقصى 3 لكل جهة: الاسم، المسمى الوظيفي، رقم التواصل، البريد الإلكتروني، ملاحظات إضافية | `contacts` collection; server limit 3 (409 `max_contacts`, zod max 3 on create) | `crm.test.ts` «at most three contact persons…» | ✅ S1 |
| §4.1 ثالثاً | إضافة محادثة أو ملاحظة؛ اسم الموظف؛ التاريخ والوقت تلقائياً؛ وسيلة التواصل (اتصال، بريد إلكتروني، زيارة، اجتماع)؛ تفاصيل المحادثة والنتائج؛ احتياج العميل؛ الخطوة القادمة؛ موعد المتابعة القادمة؛ إرفاق صور أو مستندات؛ عرض بترتيب زمني | `communicationLogs`; author and `at` set by the server; `LogComposer` (phone-first); chronological `GET` | `crm.test.ts` log test (`authorName`, `at`, order) | ✅ S1 |
| §4.1 ثالثاً | عدم حذف سجل المحادثات السابقة مع الاحتفاظ بالتاريخ واسم الموظف | no PATCH/DELETE route exists (404); survives owner change | same test (`.patch` → 404, `.delete` → 404, log visible to the new owner) | ✅ S1 |
| §4.1 رابعاً | الفصل بين حالة العميل وحالة الفرصة البيعية | `customers.status` vs `opportunities.stage` | `sales-s1.test.ts` | ✅ S1 |
| §4.1 حالة العميل | عميل نشط، عميل محتمل، عميل غير مهتم، عميل متعاون، عميل متوقف عن التعامل | `CUSTOMER_STATUSES`, labels verbatim, status change event in history | `crm.test.ts` «classification is the manager's call…» (`status_changed`) | ✅ S1 |
| §4.1 حالة الفرصة | جديدة، قيد المعالجة، تم التواصل، جدولة اجتماع، عرض سعر مرسل، قيد التفاوض، ناجحة (تم إغلاق الصفقة)، خاسرة (لم تتم الصفقة) | `OPPORTUNITY_STAGES`, `POST /sales/opportunities/:id/stage`, append-only `opportunityEvents` | `sales-s1.test.ts` «stages move with history…» | ✅ S1 (quote_sent set automatically in S3) |
| §4.1 | تسجيل سبب خسارة الفرصة عند إغلاقها دون إتمام التعاقد | `lostReason` mandatory (zod + list `sales.lossReasons`, provisional Q7), «أخرى» needs a note | same test (400 without reason / outside list) | ✅ S1 |
| §4.2 | عرض الفرص الجديدة / قيد المتابعة / العروض المرسلة / قيد التفاوض / الناجحة / الخاسرة | `PipelinePage` Kanban columns + `?stage=` filter | `sales-s1.test.ts` pipeline summary | ✅ S1 |
| §4.2 | القيمة المالية المتوقعة، الموظف المسؤول، تاريخ آخر تواصل، موعد المتابعة القادمة، إرفاق المستندات | `expectedValueHalalas`, `ownerUserId`, `lastContactAt`, `nextFollowUpAt`, `attachmentIds` (claimed on the opportunity) | `sales-s1.test.ts` | ✅ S1 (attachments UI on the opportunity dialog: S2 with the request forms) |
| §4.2 | عرض جدولي أو لوحة مراحل (Kanban Board) | `PipelinePage` `?view=kanban|table` | web hygiene tests; manual RTL check | ✅ S1 |

## §5 إدارة الخدمات والطلبات البيعية

| § | Bullet | Implementation | Test (`apps/api/src/modules/sales/sales-s2.test.ts`) | Status |
|---|---|---|---|---|
| §5 | زر رئيسي (الخدمات) بقائمة منسدلة بجميع الخدمات؛ لكل خدمة واجهة مستقلة | `SalesHomePage` «الخدمات» → `/sales/requests/new/:type`; `NewRequestPage` renders each service's own field set (`SERVICE_FIELDS`) | «seven workflow definitions, one prefix per service…» | ✅ S2 |
| §5.1 | بيع الحاويات — البيانات: اسم العميل، الجهة، المنطقة، نوع الحاوية، الحجم، العدد، اللون، المقاسات، تاريخ الطلب، الموظف المسؤول، السعر المتفق عليه، المرفقات، ملاحظات | `containerSaleDetailsSchema`, prefix CSR; container type / size / colour from `sales.lists` (empty until Q7) | same | ✅ S2 |
| §5.1 | آلية العمل: تسجيل → عرض سعر → موافقة → رفع إلى المشتريات → اعتماد مالي → متابعة التصنيع أو التوريد → نموذج الاستلام وتاريخ التسليم → التنسيق مع التشغيل عند الحاجة → الإغلاق | workflow `sales_request_containerSale`: quote → customer_approved → at_procurement → at_finance → execution_* (receipt form, delivery date) → ops_* → closed | «container sale: Sales → Procurement → Finance … → closed» (15 stage-log hops) | ✅ S2 |
| §5.2 | الفرز — البيانات والآلية (تعاقد، اعتمادات عند الحاجة، إحالة للتشغيل، متابعة الكميات والاستلام، مدة العقد والتجديد) | `sortingContractDetailsSchema`, SRT; workflow with `contracting`, optional Procurement / Finance, Operations receipts and quantities; contract duration/renewal alerts → S3 | first test (creation) | ✅ S2 (renewal alerts S3) |
| §5.3 | عقد النظافة — البيانات (توفير حاوية أو جمع مباشر…) والآلية | `cleaningContractDetailsSchema` (`mode` «توفير حاوية / جمع مباشر»), CLN; same route as sorting | first test | ✅ S2 |
| §5.4 | الإتلاف — البيانات (صور المواد…) والآلية: صور إلى التشغيل لتقدير الوزن → زيارة اختيارية → تسعيرة → عرض → موافقة → المالية → بعد اعتماد المالية إحالة إلى التشغيل → جدولة خلال 3 أيام عمل → توثيق بمحضر | `destructionDetailsSchema`, DST, `photoIds`; workflow: send_for_estimate → ops_new/ops_review (estimate_done requires the weight) → quoting → … → at_finance → ops_new (SLA 3 business days) → ops_complete requires محضر | «destruction: photos to Operations for an estimate…» | ✅ S2 (invoice step per Q4 in S3) |
| §5.5 | تأجير الحاويات — البيانات، الإحالة المباشرة إلى التشغيل، النماذج الثلاثة (قبل التسليم / بعد التسليم / بعد السحب) برفع الصور والتاريخ والوقت واسم الموظف والتوقيع والملاحظات وحالة الحاوية | `containerRentalDetailsSchema` (`deliveryZone` «داخل المنطقة الشرقية أو خارجها», Q10 information only), RNT; `rentalInspections` append-only (`POST /sales/requests/:id/inspections`), container number free text until the OPS registry | «rental: straight to Operations, three separate inspection forms…» | ✅ S2 |
| §5.6 أولاً | السكراب — بيانات العميل والمواد | `scrapDetailsSchema`, SCR | «scrap: visible to Sales and Operations…» | ✅ S2 |
| §5.6 ثانياً | زر (رفع مهمة): الموظفون المكلفون، العميل، عدد العملاء، نوع المهمة، تاريخ التكليف، موعد الزيارة، حالة المهمة (تمت / لم تتم)، حالة تحويل المبلغ (تم التحويل / لم يتم التحويل)، السعر المتفق عليه، المرفقات، الملاحظات | `scrapTasks` (payload) + a core task (`createTask`, department rules); «تمت / لم تتم» from the task status; transfer status with proof by `sales.scrapTransferRoles` | same («رفع مهمة» section) | ✅ S2 |
| §5.6 ثالثاً | جدولة الزيارات والتقييم: موعد زيارة، نتيجة التقييم، صور، كميات وتصنيفات، السعر المقترح والمتفق عليه، الإجراء القادم | `scrapAssessments` append-only (`POST …/assessments`), `ops_schedule` creates a calendar visit | same | ✅ S2 |
| §5.6 متطلبات إضافية | ظهور الطلبات لدى المبيعات والمشاريع؛ موظف مسؤول لكل مهمة؛ إشعار القسم الآخر عند كل تحديث؛ سجل الزيارات والتقييمات؛ متابعة الشراء والتحويل حتى الإغلاق | `visibilityFilter` shows every scrap request to Operations from creation; `sales.request.updated` to the other department on each state change; OPS §2.2 steps assessed → price_agreed → pickup_scheduled → collected (actual weight + receipt, notify Sales and Finance) → transferred (proof) → closed | same | ✅ S2 |
| §5.7 | رجيع الأصول — البيانات، حالة التعاون (تم التعاون / لم يتم التعاون / قيد الدراسة / قيد التفاوض)، تذكير بموعد المحادثة القادمة، سبب عدم التعاون | `assetReturnDetailsSchema`, ARO; the cooperation status is the workflow state; `decline` needs a reason; job `sales.assetreturn.reminders` | «asset return: the cooperation status is the state…» | ✅ S2 |

## §6 دورة الطلبات والاعتمادات بين الأقسام

| § | Bullet | Implementation | Test | Status |
|---|---|---|---|---|
| §6 | مسار إلكتروني موحد قابل للتخصيص حسب نوع الخدمة | seven workflow definitions (`SALES_WORKFLOWS`) seeded by the baseline and editable in /admin/workflows | first S2 test | ✅ S2 |
| §6.1 م1 المبيعات | تسجيل العميل والطلب، تحديد الخدمة، إعداد العرض، إرساله، موافقة العميل، رفع العقد أو أمر البيع والمرفقات | states new → quoting → quote_sent → customer_approved (+ contracting for SRT/CLN); attachments on the request | container-sale test | ✅ S2 (the quote document itself: S3) |
| §6.1 م2 المشتريات | استلام الطلب، مراجعة المتطلبات، عروض الموردين، تحديد المورد، إرفاق عرض المورد والمستندات، تحويل إلى المالية | `at_procurement` → `procurement_to_finance` with `supplierName` / `supplierPartyId`, `supplierQuoteAttachmentIds`; queue «الطلبات الواردة من المبيعات» (`?view=incoming`) | container-sale test | ✅ S2 |
| §6.1 م3 المالية | استلام، مراجعة السعر والتكلفة والمستندات، الموافقة أو الرفض، الملاحظات وأسباب الرفض، إشعار المبيعات والمشتريات | `at_finance`; `finance_approve` / `finance_reject` (reason) by `finance_manager` only; `finance_request_info` «يحتاج استكمال بيانات» by Finance staff (change 4); approver ≠ creator/owner; notification 8 to Sales and Procurement | container-sale test (`finance_approve` 403 for staff, needs-info loop, notification counts) | ✅ S2 |
| §6.1 م4 المشتريات بعد الاعتماد | الحالات: بدأ التنفيذ، قيد المعالجة، تم الرفض، تم الإلغاء، تم الإنجاز؛ بيانات المورد، نموذج الاستلام، تاريخ التسليم، الملاحظات، المستندات والصور، تحديث الحالة | states `execution_*` with verbatim labels; payload supplier / receipt form / delivery date / notes; notification 9 | container-sale test | ✅ S2 |
| §6.1 م5 التشغيل | إشعار التشغيل، جدولة الزيارات خلال 3 أيام عمل، تسجيل المواعيد، متابعة التنفيذ، توثيق الاستلام والتسليم | OPS §2.1 states (change 5), `ops_new` SLA 3 business days (`addBusinessDays`, Fri–Sat + holidays), `ops_schedule` → calendar visit, `ops_complete` with quantities / weights / reports; notification 10 | container-sale test (due date over a weekend and a holiday, overdue reminder once) | ✅ S2 |
| §6.2 | حالات الإغلاق: تم الإغلاق بنجاح / دون استكمال / إيقاف المشروع / إلغاء المشروع؛ الإغلاق بنجاح يُشعر التشغيل | `close_success` (notifies Operations, event `sales.request.closed_success`), `close_incomplete` (reason), `suspend` / `cancel` (manager, reason), `resume` | container-sale test; «a rep cannot act on another rep's request…» | ✅ S2 |
| §6.3 | عقد سنة أو أكثر: تسجيل البداية والنهاية؛ تنبيه قبل الانتهاء بثلاثة أشهر؛ تذكير الموظف المسؤول بالتجديد؛ إصدار شهادة تعاون قبل الانتهاء بثلاثة أشهر؛ توثيق إصدارها وإرسالها | `salesContracts` (`yearOrMore`), job `sales.contracts.alerts` (`sales.contractAlertDaysBefore` = 90) → notifications 13 + 14 once; `POST …/certificates` from the window (CRT number, stored HTML), `…/certificates/:id/send` with a send log | «contracts: schedule dates are tracked, a contract of a year or more alerts…» | ✅ S3 |
## §7 إدارة الأسعار والخصومات والفواتير

| § | Bullet | Implementation | Test (`sales-s3.test.ts`) | Status |
|---|---|---|---|---|
| §7.1 | إضافة أنواع المواد وتصنيفاتها؛ سعر الوحدة أو الطن لكل مادة؛ أسعار الخدمات؛ التحديث وفق أسعار السوق الأسبوعية؛ تاريخ سريان السعر؛ حفظ سجل التغييرات؛ الموظفون المخولون بالتعديل؛ ربط العروض بالقائمة المعتمدة | `priceItems` (material / service, unit, category), `priceEntries` append-only with `validFrom` (future prices scheduled), `marketPrices` weekly rows, `sales.priceEditorRoles` (Q6 default: Sales manager), quotes take lines from the effective price only | «price list: only editor roles write; every price change is a new append-only entry…» | ✅ S3 (content from the screen, Q6) |
| §7.2 | حد الخصم لموظف المبيعات؛ حد مدير المبيعات؛ تحويل ما يتجاوزها إلى المدير التنفيذي؛ منع اعتماد الخصم من غير مخول؛ سجل الخصومات والاعتمادات؛ اسم معتمد السعر النهائي | `sales.discountLimitBp` {rep, manager} (unset → executive, change 7), `approvalLevelFor`, `decideQuote` refuses the wrong level and the author (403), `quoteEvents` + audit per approval, `approval.approvedByName` shown | «with limits set: within the rep limit auto-approves, above it the manager, above the manager the executive…» | ✅ S3 (numbers pending Q1) |
| §7.3 | ربط أمر البيع بالفاتورة؛ تعبئة بيانات العميل تلقائياً؛ الخدمة والكمية والسعر؛ الضريبة والإجمالي؛ الإصدار بعد الاعتمادات؛ الإرسال من النظام؛ المشاركة من بريد الموظف؛ إرفاق المستندات؛ حفظ نسخة في ملف العميل؛ متابعة الفاتورة والسداد | `invoices` register from the order (lines, totals, customer legal data from the party), ZATCA fields stored (uuid, sequence, state «بانتظار الإرسال», kind tax/simplified), customer copy HTML, payments and collection state; email through the mailbox adapter | «acceptance → sales order; Finance registers the issued invoice (option A)…» | ✅ S3 (issuance in the system + Fatoora: Finance phase 3 / Q4) |
| §7.3 متطلب مهم | لا تظهر للعميل تفاصيل الخصم الداخلية ولا السعر السابق ولا الفرق؛ الفاتورة النهائية المعتمدة فقط؛ سجل التعديلات داخليًا | `toCustomerQuoteDto` + `renderCustomerQuoteHtml` carry net prices only (no list price / discount keys exist on the DTO); the order snapshot stores net prices; internal fields (`listPriceHalalas`, discounts, `approval`, `events`) only for the owner, Sales management, Finance and the executive | «discount matrix…» (document contains no «خصم» and no list price) | ✅ S3 |
| §7.4 | بيانات العميل؛ نوع العقد؛ المدة؛ المواد أو الخدمات؛ الكميات؛ مواعيد التسليم والاستلام؛ الأسعار المتفق عليها؛ العقد الموقع؛ متابعة كل موعد تسليم؛ تنبيهات التجديد والانتهاء؛ سجل العمليات | `salesContracts` with `items`, `schedule[]` (planned / done / missed per date), signed file, `contractEvents` append-only, renewal (`renewalOf` / `renewedById`), alerts job | «contracts: schedule dates are tracked…» | ✅ S3 (contract types list pending Q7) |

## §8 صلاحيات مدير قسم المبيعات

| § | Bullet | Implementation | Test | Status |
|---|---|---|---|---|
| §8.1 | نقل العميل من موظف إلى موظف آخر | `POST /crm/customers/transfer` (one or many), reason mandatory, `customerEvents.owner_changed`, both reps notified, open opportunities follow | `crm.test.ts` log/transfer test | ✅ S1 |
| §8.1 | إعادة توزيع العملاء والفرص البيعية | bulk selection on `CustomersPage`; `POST /sales/opportunities/reassign` | `sales-s1.test.ts` reassign test | ✅ S1 |
| §8.1 | استقبال العملاء المحتملين (Leads) من خدمة العملاء؛ توجيه العملاء وتوزيعهم على موظفي القسم | `LeadsPage` department view; `POST /crm/leads/:id/assign` (manager only, 403 for a rep) | `crm.test.ts` leads test | ✅ S1 |
| §8.1 | تعديل حالة الطلب وفق الصلاحيات المعتمدة | request states | — | 🔜 S2 |
| §8.1 | الاطلاع على جميع العملاء والفرص البيعية داخل القسم؛ الاطلاع على سجل متابعة الموظفين | department scope for `sales_manager` (implied for the Sales department manager, DECISIONS §20 change 3); logs readable per customer | `crm.test.ts` first test; `rbac-sales.test.ts` change 3 | ✅ S1 |
| §8.2 | رفع ملفات وآليات العمل PDF، التعليمات، تقارير الموظفين، تقارير الانتداب والزيارات، مستندات العملاء | Sales documents library + EP §14 reports filtered to Sales | — | 🔜 S4 |
| §8.3 | KPIs، المستهدفات، الإيرادات، المصروف، المتبقي (للعرض فقط من المالية) | KPI framework, targets, read-only Finance cards | — | 🔜 S4 (budget data waits for the Finance module) |

## §9 التقويم — 🔜 S4 (core calendar already has the five statuses) · §10.1 البريد — 🔜 S3/S4 (Q5) · §10.3 الدردشة الداخلية — 🔜 S4

## §10.2 سجل المحادثات

| § | Bullet | Implementation | Test | Status |
|---|---|---|---|---|
| §10.2 | إضافة تعليق أو ملاحظة؛ اسم الموظف؛ التاريخ والوقت تلقائياً؛ إرفاق الملفات والصور؛ ترتيب زمني؛ نتيجة التواصل؛ موعد المتابعة القادمة | same log as §4.1 ثالثاً (`outcome`, `nextFollowUpAt`, attachments) | `crm.test.ts` log test | ✅ S1 |
| §10.2 | إشعار الموظف عند حلول موعد المتابعة | job `crm.followups` + `sales.followups` (opportunities), setting `sales.followUpReminderHours`, once per date | `crm.test.ts` «the follow-up reminder reaches the responsible employee once…» | ✅ S1 |

## §10.4 نظام التصنيفات (Hashtags)

| § | Bullet | Implementation | Test | Status |
|---|---|---|---|---|
| §10.4 | تصنيف العملاء والطلبات والفرص البيعية مع البحث والتصفية | `core/tags` (scope `sales`), `tags[]` on customers and opportunities, `?tag=` filters | `crm.test.ts` tags test | ✅ S1 (requests in S2) |
| §10.4 | الأمثلة #عميل_جديد #عميل_استراتيجي #عقد_سنوي #تأجير_حاويات #سكراب #مناقصة #متابعة_مالية #يحتاج_زيارة | `DEFAULT_SALES_TAGS` seeded by the baseline | same test (eight names) | ✅ S1 |
| §10.4 | قابلة للإضافة والتعديل وفق صلاحيات مدير القسم | `POST/PATCH/DELETE /tags` need `tags:create/edit/delete` (sales_manager, department); reps pick existing tags only; rename rewrites records | same test (403 for rep, rename reflected) | ✅ S1 |

## §11 KPIs — 🔜 S4 (change 6: tons from invoices) · §12 التقارير — 🔜 S5 · §13 لوحة التحكم — 🔜 S4 (the S1 landing already drills down: عملائي، متابعات مستحقة، فرص مفتوحة، فرص متأخرة، عملاء محتملون)

## §14 الإشعارات

| # | Notification (verbatim) | Type | Where | Test | Status |
|---|---|---|---|---|---|
| 1 | وصول عميل جديد من خدمة العملاء | `crm.lead.referred` | `createLead` → Sales managers | `crm.test.ts` leads | ✅ S1 |
| 2 | إسناد عميل إلى موظف | `crm.customer.assigned` | lead assignment, customer created for another owner, transfer recipient | `crm.test.ts` leads + transfer | ✅ S1 |
| 3 | قرب موعد متابعة العميل | `crm.followup.due` | jobs `crm.followups`, `sales.followups` | `crm.test.ts` follow-up | ✅ S1 |
| 4 | اقتراب موعد اجتماع أو زيارة | `meeting.reminder` (core) | calendar | core tests | ✅ core (Sales fields S4) |
| 5 | تحديث حالة عرض السعر | `sales.quote.status` | send / accepted / rejected / negotiating → Sales managers | `sales-s3.test.ts` «discount matrix…» | ✅ S3 |
| 6 | اعتماد أو رفض عرض السعر | `sales.quote.decided` (+ `sales.quote.approval_requested` to the approvers) | `decideQuote` → the quote's owner | same | ✅ S3 |
| 7 | وصول طلب جديد إلى المشتريات | `sales.request.to_procurement` | `send_to_procurement` → Procurement managers and members | S2 container-sale test | ✅ S2 |
| 8 | اعتماد أو رفض الطلب من المالية | `sales.request.finance_decided` | Finance decisions (incl. «يحتاج استكمال بيانات») → Sales owner + managers + Procurement | same | ✅ S2 |
| 9 | تحديث حالة الطلب من المشتريات | `sales.request.procurement_updated` | `execution_*` → Sales | same | ✅ S2 |
| 10 | اكتمال التنفيذ من التشغيل | `sales.request.operations_completed` | `ops_complete`, `estimate_done`, `record_collection` (+ Finance for scrap, OPS §2.2) → Sales | same; scrap test | ✅ S2 |
| 11 | إصدار فاتورة جديدة | `finance.invoice.issued` | `registerInvoice` → Sales owner + managers | «acceptance → sales order…» | ✅ S3 |
| 12 | تأخر سداد الفاتورة | `finance.invoice.overdue` | daily job → Sales owner, managers, Finance, once | same | ✅ S3 |
| 13 | اقتراب انتهاء عقد | `sales.contract.expiring` | daily job, 90 days before, once → Sales | «contracts…» | ✅ S3 |
| 14 | اقتراب موعد تجديد التعاون | `sales.contract.renewal_due` | same job → the owner | same | ✅ S3 |
| 15 | وجود مشكلة أو استفسار من قسم آخر | — | S4 (discussions) | — | 🔜 |
| 16 | تغيير الموظف المسؤول عن العميل أو الطلب | `crm.owner_changed`, `crm.customer.assigned` | transfer and reassignment → previous owner; a request created for another owner → that owner | `crm.test.ts` transfer; `sales-s1.test.ts` reassign | ✅ S1/S2 |

## §15 الصلاحيات

| § | Bullet | Implementation | Test | Status |
|---|---|---|---|---|
| موظف المبيعات | إضافة العملاء والفرص؛ متابعة العملاء المسندين إليه؛ تسجيل المحادثات والاجتماعات؛ الاطلاع على بياناته | role `sales_rep` (own scope on `crm.customers`, `crm.leads`, `sales.opportunities`) | `crm.test.ts` first test (rep B sees nothing of rep A) | ✅ S1 (quotes, requests, targets: S2–S4) |
| مدير المبيعات | جميع عملاء القسم؛ التوزيع؛ النقل؛ متابعة الأداء | role `sales_manager` (department), implied for the Sales department manager | `crm.test.ts`, `rbac-sales.test.ts` | ✅ S1 (quotes approval, targets: S3–S4) |
| الإدارة التنفيذية | الاطلاع على المؤشرات والإيرادات والتقارير؛ اعتماد ما يتجاوز صلاحيات المدير | `executive` gets view-all on `crm.*`, `sales.opportunities`, `tags`; create → 403 | `crm.test.ts` first test | ✅ S1 (above-limit approvals S3) |
| الأقسام المرتبطة | المشتريات، المالية، التشغيل، خدمة العملاء، التسويق | CS referral built; the three thin stages S2; Marketing notice S4 | `crm.test.ts` leads | ✅/🔜 |
| | قابلة للتخصيص حسب طبيعة الوظيفة والمسؤولية | admin edits grants of `sales_rep`/`sales_manager` or clones them; admin edits survive restarts (change 1); nobody edits a role they hold (change 2) | `rbac-sales.test.ts` changes 1–2 | ✅ S1 |

## §16 المتطلبات التقنية

| Bullet | Implementation | Status |
|---|---|---|
| ربط قسم المبيعات بنظام CRM؛ ربط بيانات العملاء بقسم خدمة العملاء | shared `crm` module, CS referral form | ✅ S1 |
| APIs للتكامل | OpenAPI document | 🔜 S5 |
| سجل تدقيق لجميع الإجراءات | `recordAudit` on every write (customers, contacts, logs, leads, opportunities, tags, transfers) | ✅ S1 |
| البحث والتصفية المتقدمة | Arabic-normalised search on name/city/activity, phone digits, number; filters by status/source/classification/tag/owner/follow-up | ✅ S1 |
| حماية بيانات العملاء والعقود والأسعار | scope rules, duplicate check without leakage; quote internals (list price, discounts, approvals, history) only for the owner, Sales management, Finance and the executive; invoice views audited as sensitive | ✅ |
| النسخ الاحتياطية | Atlas backup note in DEPLOY.md | 🔜 S5 |

## §18 المخرجات (20) — S1: 1, 2, 3, 4, 18; S2: 5 and the PRC/FIN/OPS part of 19; S3: 6 (quotes), 7 (price list), 8 (discount matrix view), 9 (periodic contracts), 10 (invoices and collection). Remaining: 11–17, 20 (S4–S5).

## §19 التوصيات — S1: ملف موحد ✅ · رقم مرجعي تلقائي ✅ · الاحتفاظ بالمحادثات عند تغيير الموظف ✅ · عدم تجاوز الصلاحيات ✅ · S2: كل الخدمات مرتبطة بملف العميل نفسه ✅ (`customerId` required) · مسارات اعتماد مرنة ✅ (workflow definitions) · الطلبات المحولة تظهر في حساب القسم المستلم مع إشعار فوري ✅ (`?view=incoming`, notifications 7/to_finance/to_operations) · سجل انتقال الطلب بين الأقسام واسم الموظف في كل مرحلة ✅ (stage log) · سبب تأخر الطلب والجهة المسؤولة ✅ (`delay-reason`) · البقية (ربط الإيرادات بالمالية، البريد، التقارير) S3–S5.
