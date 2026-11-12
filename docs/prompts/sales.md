# Build the Sales module [SAL], complete and exactly as the spec

## 0. Context and ground rules
- **Source of truth:** the chapter `# SAL — المبيعات` in `docs/SPECS.md`. The owner sent the Sales PDF again on 2026-11-12, and its text is identical to `docs/specs/originals/sales.pdf`, so the chapter is current. Read the WHOLE chapter (§1 to §19) before planning, then `CLAUDE.md` and `docs/DECISIONS.md`.
- **Owner decision (2026-11-12): Sales is built now, before phase 2 (attendance).** Record it in DECISIONS §7 and in the CLAUDE.md build order. Phase 2 moves after Sales.
- **Coverage rule.** Every bullet in SAL §1–§19 ends up as a screen, field, rule, notification, report or test.
  - Keep `docs/SALES_COVERAGE.md` as a table: `SAL §x.y | the bullet (Arabic, verbatim) | where it is implemented | test`.
  - A bullet that can't be built yet stays in the table with the reason (e.g. "waits for the ZATCA decision"). Nothing is dropped silently.
- **Labels are verbatim.** Every Arabic status, list value and button label the spec names is copied exactly into the `ar` locale (e.g. «عميل جديد / فرصة بيعية جديدة», «الخدمات», «رفع مهمة»). Don't paraphrase.
- **Golden rule 11 applies.** Where the spec gives no number or list, ask (§2 below). Don't invent limits, prices, categories or reasons.
- **Carry-over fix (first commit):** `prune-web-assets.sh` keeps only files referenced by index.html, so assets referenced from JS/CSS (a logo, local fonts, lazy chunks) would be deleted once the last deploy is older than N days. Make `deploy-web.sh` upload the build's file list (Vite manifest or a generated list of every file in dist), and have prune keep every file in the current list. Add a test.

## 1. What "Sales only" means
- **Build:**
  - The Sales module.
  - The shared pieces Sales needs: CRM core (customers, contacts, leads, communication logs), a minimal party master (FIN §8), and the core capabilities still missing (tags, KPI framework, department discussions, email adapter).
  - Build these shared pieces once, so later modules reuse them.
- **Don't build** the Procurement, Finance, Operations, Customer Service or Marketing modules.
- **Thin hand-off stages for other departments.** SAL itself describes what other departments do on a Sales request (§3, §5, §6.1, §6.2, §14, §15 "الأقسام المرتبطة", §19), and requires that requests "تظهر في حساب القسم المستلم مع إشعار فوري".
  - Build those stages inside the Sales module as thin stages on the **same Sales record and number**.
  - Each receiving department (المشتريات، المالية، التشغيل والمشاريع) gets a queue «الطلبات الواردة من المبيعات» under its menu.
  - The queue offers only the actions and fields SAL §6.1 / §5 list for that department.
  - When the PRC/FIN/OPS modules are built later, they take over these stages on the same record (CLAUDE.md golden rule 6). Emit an outbox event at every hand-off (e.g. `sales.request.sent_to_procurement`, `sales.request.finance_decided`, `sales.request.sent_to_operations`) so those modules can subscribe.
- **Leads from Customer Service** (SAL §3, §8.1):
  - Build the shared `leads` collection (CRM core) and a small «إحالة عميل محتمل إلى المبيعات» form, available to users in the Customer Service department.
  - Lead states are CS §6.8 verbatim: جديد / تم التواصل / محال للقسم المختص / قيد المتابعة / فرصة قائمة / تم تحويله إلى عميل / غير مهتم / مغلق.
  - The full CS inbox comes with the CS module.
- **Marketing notice** (SAL §9): notify the Marketing department's manager and members. No Marketing module is needed.

## 2. Step 0: plan and questions (stop and wait for the owner)
Write `docs/SALES_PLAN.md`, then stop and wait for approval. The spec's closing note asks for exactly this before any coding: «تقديم تصور للواجهات وآلية الربط بين الأقسام، وتحديد المتطلبات التقنية التي تحتاج إلى تكامل خارجي».
- **External integrations.** List each one (email provider, ZATCA, maps) with the adapter seam and what works manually until it's connected.
- **Data model.** Collections, owners and indexes; customer-facing DTOs vs internal views.
- **Route per service type.** The state diagram and which department acts at each step (from §5.1–§5.7 and §6.1).
- **Screens.** Every screen mapped to the SAL §18 deliverables list (20 items) and the menu placement for Sales, the manager, the executive and the receiving departments.
- **Slices** S1–S5 as in §3 below.
- **The questions below.** For each one, give your proposed default and what is blocked until it's answered.
  1. **Discount limits** for موظف المبيعات and مدير المبيعات (SAL §7.2): percentage or amount? Per line or per quote?
  2. **Does every quote need the manager's approval** (SAL §3 المرحلة الثانية «اعتماد العرض من مدير المبيعات ضمن حدود صلاحياته»), or only quotes above the rep's discount limit (§7.2)?
  3. **Finance approval on a Sales request** (§6.1 المرحلة الثالثة): who approves, and are there amount limits (financial authority matrix, FIN §12)? Proposed default until then: finance_manager approves all of them, and the approver is never the request's creator (FIN §12).
  4. **Invoices** (SAL §7.3): where are invoices issued today (the current ERPNext?), and what is the ZATCA route and wave (FIN §10)? Until that is decided:
     - **Option A:** Finance records the invoice issued in the current system (number, date, amounts, PDF) against the order, for collection tracking.
     - **Option B:** Finance prepares invoice drafts here and nothing is issued.
     - **Either way:** the invoice model stores every ZATCA field from day one, with no signing or XML (golden rule 8).
  5. **Email from the employee's own mailbox** (SAL §3, §7.3, §10.1) and the department's official mailbox: which provider (Microsoft 365, Google Workspace, other)? Until decided, emails are composed in the system and saved to the customer file, and sending goes through an adapter that is switched off (DECISIONS §9).
  6. **Price list content** (§7.1): material types and categories, unit vs ton, service prices, who may edit prices, and where weekly market prices come from (manual entry by an authorized user?).
  7. **Lists the spec names but doesn't fill.** Give initial values or start empty (all configurable):
     - container types, sizes, colours and dimensions (§5.1, §5.5)
     - contract types (§5.2, §7.4)
     - waste types and service types (§5.3)
     - material types for destruction (§5.4)
     - scrap categories and task types (§5.6)
     - tender sources (§5.7)
     - meeting types (§9)
     - opportunity loss reasons (§4.1)
     - quote rejection reasons (§3)
     - non-cooperation reasons (§5.7)
     - facility sizes «حجم المنشأة» (§4.1)
  8. **Organization type.** SAL §4.1 says «حكومي، خاص، عام» and CS §6.8 differs (CLAUDE.md open decisions). Proposed: SAL's list as the initial configurable list.
  9. **Customer classification** استراتيجي / منتظم / عرضي (§12): set by the manager by hand, or by a rule?
  10. **Rental delivery «داخل المنطقة الشرقية أو خارجها»** (§5.5): does it change the price or the route, or is it information only?
  11. **KPI targets and market average.** The targets from the annual plan (§11), and the source of «متوسط السوق» for «متوسط سعر الطن».
  12. **Who acts on the thin stages** in Procurement, Finance and Operations: the department manager only, or department staff too?
  13. **The 24-hour rule** (§3 «تسجيل العميل أو الفرصة في نظام CRM خلال 24 ساعة»): clock hours or business hours, and who is alerted when it's missed (proposed: the rep and the Sales manager)?

## 3. Slices: follow SAL §17 order
One slice at a time. Each slice: commits citing `[SAL §x.y]`, tests, an update to SALES_COVERAGE.md, a demo script in `docs/SALES.md`, then wait for the owner's approval.

### S1: SAL §17 المرحلة الأولى (customer database)
**Customer file** (§4.1, §19):
- A main button «عميل جديد / فرصة بيعية جديدة».
- **أولاً, organization:** اسم الجهة، الدولة، المنطقة، المدينة، النشاط، نوع الجهة، حجم المنشأة، مصدر العميل.
- **Sources (verbatim):** وسائل التواصل الاجتماعي، الزيارات الميدانية، الترشيحات، خدمة العملاء، الاتصالات المباشرة، المعارض والمؤتمرات، مصادر أخرى.
- **One customer file per real organization** (§19 «ملف موحد»). An organization links to a party record (FIN §8); individuals are allowed too (CLAUDE.md CRM core).
- **Duplicate prevention across reps without leaking data.** Matching uses normalized Arabic name, CR/unified number and phone. A rep sees only «هذه الجهة مسجلة لدى موظف آخر — راجع مدير القسم», never the other rep's file.

**Contacts** (§4.1 ثانياً):
- At most **3 per organization**, enforced by the server.
- Fields: الاسم، المسمى الوظيفي، رقم التواصل، البريد الإلكتروني، ملاحظات إضافية.

**Communication log** (§4.1 ثالثاً, §10.2), append-only:
- Employee name, and date and time set automatically.
- Method: اتصال، بريد إلكتروني، زيارة، اجتماع.
- Details and outcome «تفاصيل المحادثة والنتائج», client need, next step, next follow-up date, attachments (images and documents).
- Shown in chronological order from the first contact.
- Never edited or deleted, and kept when the responsible employee changes (§19).
- A job notifies the employee when the follow-up date arrives (§10.2).

**Customer status vs opportunity status** (§4.1 رابعاً) are separate fields:
- **Customer status:** عميل نشط، عميل محتمل، عميل غير مهتم، عميل متعاون، عميل متوقف عن التعامل.
- **Opportunity stages:** جديدة، قيد المعالجة، تم التواصل، جدولة اجتماع، عرض سعر مرسل، قيد التفاوض، ناجحة (تم إغلاق الصفقة)، خاسرة (لم تتم الصفقة).
- **Loss reason is mandatory** for خاسرة.

**Pipeline** (§4.2):
- Table view and Kanban by stage.
- Expected value per opportunity (halalas), responsible employee, last contact date (derived from the log), next follow-up date, attachments.
- Filters: new, in progress, quotes sent, negotiating, won, lost.

**Leads from CS and distribution** (§3, §8.1):
- The CS referral form (see §1). The Sales manager receives leads and assigns them to reps.
- The 24-hour rule is a setting, with an alert.
- A lead converts into a customer and/or opportunity, keeping its link.

**Manager actions** (§8.1):
- Move a customer from one rep to another, one at a time or in bulk, with history kept and both reps notified (§14 «تغيير الموظف المسؤول»).
- Redistribute opportunities.
- Change request status within permissions.
- See all customers and opportunities in the department, and the reps' follow-up logs.

**Permissions** (§15):
- A rep adds customers and opportunities and sees only those assigned to them, plus their own tasks, targets, data and reports.
- The manager sees everything in the department.
- Executive management is read-only plus above-limit approvals.
- Others see nothing unless a later stage gives them the record.
- **Customizable permissions.** §15 ends with «يجب أن تكون الصلاحيات قابلة للتخصيص حسب طبيعة الوظيفة والمسؤولية», but today roles are defined in code and read-only. Propose in the plan how the system admin customizes Sales permissions (e.g. Sales roles plus an audited grants screen) without breaking segregation of duties.

**Phones:** reps log calls, visits and photos from a phone at 375px width (golden rule 9).

**Tags** (§10.4, core capability):
- Hashtags on customers, requests and opportunities, with search and filter.
- Added and edited by the department manager.
- Seed the examples from the spec: #عميل_جديد #عميل_استراتيجي #عقد_سنوي #تأجير_حاويات #سكراب #مناقصة #متابعة_مالية #يحتاج_زيارة.

### S2: SAL §17 المرحلة الثانية (services and requests)
**Services:**
- A main button «الخدمات» with a dropdown of all services.
- **One screen per service** (§5) with its own fields.
- **One collection with a discriminator** and these prefixes:

| Type | Prefix | Spec |
|---|---|---|
| containerSale | CSR | §5.1 |
| sortingContract | SRT | §5.2 |
| cleaningContract | CLN | §5.3 |
| destruction | DST | §5.4 |
| containerRental | RNT | §5.5 |
| scrap | SCR | §5.6 |
| assetReturn | ARO | §5.7 |

- **Every request** hangs off the customer file (§19) and has an automatic reference number.

**Fields per service** (verbatim from the spec):
- **§5.1 بيع الحاويات:** اسم العميل، الجهة، المنطقة، نوع الحاوية، الحجم، العدد، اللون، المقاسات، تاريخ الطلب، الموظف المسؤول، السعر المتفق عليه، المرفقات، ملاحظات إضافية.
- **§5.2 الفرز:** اسم العميل، نوع العقد، نوع المواد، الكميات المتوقعة، موقع العميل، مدة العقد، مواعيد الاستلام، الموظف المسؤول، المرفقات، الملاحظات.
- **§5.3 عقد النظافة:** اسم الجهة، موقع الخدمة، نوع النفايات، نوع الخدمة، توفير حاوية أو جمع مباشر، عدد الحاويات عند الحاجة، عدد الزيارات، مدة العقد، تاريخ بداية ونهاية العقد، الموظف المسؤول، المرفقات.
- **§5.4 الإتلاف:** اسم الجهة، اسم الشخص المسؤول، رقم التواصل، موقع العميل، نوع المواد المطلوب إتلافها، الكمية التقديرية، صور المواد، ملاحظات إضافية، الموظف المسؤول.
- **§5.5 تأجير الحاويات:** اسم العميل والجهة، رقم التواصل، العنوان، المنطقة، حجم الحاوية، عدد الحاويات، اللون، المقاسات، موقع التسليم (داخل المنطقة الشرقية أو خارجها)، تاريخ رفع الطلب، تاريخ التسليم المطلوب، مدة التأجير، الموظف المسؤول عن الحاوية، ملاحظات إضافية، المرفقات.
  - **Three separate inspection forms:** قبل التسليم، بعد التسليم، بعد السحب.
  - **Each form has:** photos, automatic date and time, responsible employee name, signature or proof of receipt, notes and container condition.
  - **Container number:** free text until the OPS container registry exists (golden rule 2: it becomes a reference then).
- **§5.6 السكراب:** a shared record with التشغيل/المشاريع.
  - **أولاً, data:** اسم الجهة، المنطقة، نوع المواد، رقم الجوال، العنوان، الشخص المسؤول، وصف المواد، الكمية التقديرية، السعر المتفق عليه، المرفقات والصور، الموظف المسؤول عن المتابعة.
  - **ثانياً, the «رفع مهمة» button:**
    - Fields: assignee dropdown, customer/organization, number of customers to contact or buy from, task type, assignment date, visit date, notes, attachments and photos, agreed price.
    - **«حالة المهمة» (تمت / لم تتم)** and **«حالة تحويل المبلغ» (تم التحويل / لم يتم التحويل)**: reuse core tasks with a scrap payload, and show these labels.
  - **ثالثاً, visits and assessments:** schedule an assessment visit, record the result, photos, quantities and categories, the proposed price and the agreed price, and the next action.
  - **Extra rules:** every scrap request is visible to Sales and Operations; every task has a responsible employee; the other department is notified on every status change; all visits and assessments are kept; purchase and money-transfer status is tracked until closure.
- **§5.7 رجيع الأصول (المناقصات):** اسم الجهة، المنطقة، حجم المنشأة، مصدر الحصول على المناقصة، معلومات إضافية عن المناقصة، نوع الأصول أو المواد، تاريخ الحصول على الفرصة، الموظف المسؤول، تاريخ آخر تواصل، موعد المحادثة القادمة، المرفقات.
  - **Cooperation status:** تم التعاون، لم يتم التعاون، قيد الدراسة، قيد التفاوض.
  - A reminder fires at the next conversation date, and a reason is required for لم يتم التعاون.

**Routes** (§5 «آلية العمل» per service, §6.1). They live in workflow config, one route per type, editable (§6, §19 «مسارات الاعتماد مرنة»):
- **§6.1 المرحلة الأولى, Sales:** register customer and request → service/product → quote → send → customer approval → upload the contract or sales order and attachments.
- **المرحلة الثانية, Procurement** (thin stage, only when supply, manufacturing or an outside supplier is needed: §3 المرحلة الرابعة, §5.1): receive, review requirements, collect supplier quotes when needed, choose the supplier (a party with the supplier role), attach the supplier offer and documents, send to Finance.
- **المرحلة الثالثة, Finance** (thin stage):
  - receive; review price, cost and documents; approve or reject;
  - notes, and reasons on rejection;
  - notify Sales and Procurement;
  - after approval, record or attach the purchase documents Finance issues for that type of operation (§3 المرحلة الرابعة «إصدار مستندات الشراء اللازمة من المالية وفق نوع العملية»).
- **المرحلة الرابعة, Procurement after approval:**
  - Visible states: بدأ التنفيذ، قيد المعالجة، تم الرفض، تم الإلغاء، تم الإنجاز.
  - Actions: supplier data, receipt form, delivery date, notes, documents and photos, status updates.
- **المرحلة الخامسة, Operations:**
  - Notified after successful completion.
  - Schedules visits with the customer **within 3 business days** (SLA on business days, Fri–Sat weekend plus holidays).
  - Records visit dates, follows up execution, and documents receipt and delivery: quantities and weights, receipt and delivery reports (§3 المرحلة الخامسة).
- **Destruction route** (§5.4): customer photos go to Operations for a preliminary weight and quantity estimate → optional field visit for assessment → price based on the assessment → offer → approval → Finance (invoice per §7.3 and Q4) → after Finance approval, Operations → schedule within 3 business days → execution documented with a report or receipt document.
- **Rental route** (§5.5): straight to Operations, with the three forms.
- **Sorting and cleaning** (§5.2, §5.3): contracting, then Finance/Procurement approvals when needed, then Operations for execution, then received quantities, visits and receipts are documented, plus contract duration and renewal follow-up.
- **Closing outcomes** (§6.2): تم الإغلاق بنجاح، تم الإغلاق دون استكمال، تم إيقاف المشروع، تم إلغاء المشروع. Closing successfully automatically notifies Operations (§6.2).
- **Stage log** (§19): department, responsible employee, entered and left times, and a **delay reason with the responsible party** when an SLA is exceeded. It is visible on the request.
- **Hand-off visibility** (§3 ملاحظة, §19): every transfer appears at once in the receiving department's queue and notifies the responsible employee and the department manager. Updates notify the Sales employee and the Sales manager.

### S3: SAL §17 المرحلة الثالثة (pricing, contracts, invoicing)
**Central price list** (§7.1):
- Material types and categories; unit or ton price per material; service prices.
- Weekly market price updates.
- Valid-from date on every price.
- **Append-only price history** (golden rule 3).
- Only authorized employees edit prices (a permission).
- Quotes take their lines from the approved list.

**Discount and approval matrix** (§7.2):
- Limits for the rep and the manager come from settings (values from Q1).
- Anything above the manager's limit escalates to the executive.
- The server refuses an approval from anyone not authorized.
- Every discount and approval is logged.
- The name of whoever approved the final price is shown.

**Quotes** (§3 المرحلة الثانية والثالثة):
- Built from the price list, taking the weekly market price into account.
- Attachments and images can be added.
- Sent to the customer from the system (Q5).
- The customer's replies are recorded.
- **Status:** مقبول، مرفوض، قيد التفاوض, plus the internal draft and approval states your plan proposes (add their Arabic labels to DECISIONS).
- A rejection reason is required.
- Sending a quote moves the opportunity to «عرض سعر مرسل».

**Customer-facing documents** (§7.3 «متطلب مهم», CLAUDE.md):
- Quotes, orders and invoices sent to the customer show **only the final approved net price**.
- They never show internal discounts, the previous price or the difference.
- Use dedicated templates and DTOs. The internal log keeps every change for audit.

**Sales order / contract** (§3 المرحلة الرابعة):
- The customer's approval leads to a sales order or contract, with the signed file attached.

**Periodic contracts** (§7.4):
- Customer, contract type, duration, materials or services, quantities, delivery and pickup schedule (**each scheduled delivery tracked**), agreed prices, signed contract, renewal and expiry alerts, and a log of operations.
- **For contracts of a year or more** (§6.3):
  - start and end dates;
  - an alert **3 months before the end**, and a renewal reminder to the responsible employee;
  - a **cooperation certificate** can be issued from 3 months before the end, from a template, numbered, with an issue and send log.

**Invoices and collection** (§7.3, per Q4):
- The order links to the invoice; customer data fills in automatically; service or material, quantity and price come from the order.
- VAT 15% and totals per the approved accounting treatment.
- Issued only after the required approvals.
- Sent from the system or from the employee's email with attachments (Q5).
- A copy is saved in the customer file.
- Invoice and payment status are tracked.
- **Finance owns invoice and collection data.** Sales sees it read-only (§19 «ربط الإيرادات والفواتير بالبيانات المالية المعتمدة، وليس بإدخال يدوي»).

### S4: SAL §17 المرحلة الرابعة (management and follow-up)
**Calendar** (§9, extending the core calendar, whose statuses already match: مجدول، تم، لم يتم، إعادة جدولة، ملغي):
- Fields: meeting title, customer/organization (linked to the customer file), responsible employee, date, time, meeting type, location (map link), online meeting link, notes.
- Monthly, weekly and daily views, with a colour per status.
- A reminder before the meeting.
- Reschedule and cancel.
- Record the outcome after the meeting and set the next follow-up.
- **Marketing notice:** an event, exhibition, conference or occasion that needs Marketing sends a notice with name, date, location and organizer.

**Email** (§10.1), per Q5:
- Send from the employee's account or the department's official mailbox.
- Attach quotes, contracts, images and documents.
- Every message is saved in the customer file with sender and date, and older correspondence stays browsable.

**Department discussions** (§10.3, a core capability linked to a customer or request):
- Target department, participants, problem details, attachments.
- The department is notified; replies and actions are recorded.
- **Status:** جديدة، قيد المعالجة، بانتظار الرد، تم الحل، مغلقة.
- The thread is kept until the issue is closed.

**Tasks and visits:** «واجهة إدارة المهام والزيارات» (§18), on top of core tasks, including the scrap tasks.

**Manager documents** (§8.2):
- Upload procedures and instructions as PDF to a Sales documents library.
- See the reports the reps submit (EP §14 reports filtered to Sales).
- Follow secondment and field-visit reports.
- Review customer documents.

**Targets** (§11.1):
- Monthly targets for the department, for each rep, and split by service or material.
- Actual achievement, achievement %, achieved or not.
- **Every edit or withdrawal is a new version** with old value, new value, editor, date and reason; nothing is replaced.
- Compare reps across months; monthly and yearly reports.

**KPIs** (§11, core KPI framework):

| KPI | Calculation | Target | Period |
|---|---|---|---|
| إجمالي الإيرادات | sum of issued invoices | annual plan | monthly |
| الكمية المباعة | total tons per material | annual plan | monthly |
| نسبة تحويل العروض | accepted ÷ sent × 100 | 40% | monthly |
| متوسط سعر الطن | revenue ÷ quantity per material | not below the market average | monthly |
| متوسط مدة التحصيل | days from invoice to payment | 45 days or less | monthly |

- **KPI board** (§11.2): monthly target, sales achieved, achievement %, remaining, new customers, opportunities, quotes sent, quotes accepted and rejected, total revenue, unpaid invoices, average collection days.
- Filters: employee, department, service, period.

**Sales dashboard** (§13). Its content depends on the role, and **every card drills down to its records**:
- **أولاً, sales:** total revenue, sales achieved, monthly target, achievement %, remaining, value of open deals, won and lost.
- **ثانياً, customers:** total, new, potential, active, needing follow-up (next follow-up passed), referred from CS.
- **ثالثاً, opportunities:** new, in progress, quotes sent, accepted, rejected, past their follow-up date.
- **رابعاً, employees:** performance, target per rep, achieved per rep, completion, open tasks, scheduled visits and meetings.
- **خامساً, collection:** total invoices, paid, unpaid, overdue amounts, average collection days.

**Manager budget figures** (§8.3):
- Department revenue, spent and remaining budget, **read-only and taken from Finance data**.
- Until Finance budgets exist, the cards say there is no Finance data yet. **There is never a manual entry in Sales.**

### S5: SAL §17 المرحلة الخامسة (testing, reports, integration)
**Reports** (§12, core export builder):
- **أولاً, sales:** daily, weekly and monthly sales; revenue by material; revenue by service; quantities sold; average selling prices.
- **ثانياً, customers:** customer database, new, active, non-cooperating, classification استراتيجي / منتظم / عرضي.
- **ثالثاً, opportunities:** new, in progress, quotes sent, accepted, rejected, won, lost, loss reasons.
- **رابعاً, employees:** performance, customers registered, visits and meetings, quotes sent, sales achieved, target %, tasks done and not done.
- **خامساً, financial** (read-only from Finance data): invoices issued, paid, unpaid, amounts due, average collection days.
- **Export:** period, department or employee, service type, field picker, filters, preview, Excel and PDF (HTML until the PDF renderer exists, DECISIONS §1 item 11). The server respects the user's permissions.

**Notifications** (§14). Every one of these, in-app (email later):
1. وصول عميل جديد من خدمة العملاء
2. إسناد عميل إلى موظف
3. قرب موعد متابعة العميل
4. اقتراب موعد اجتماع أو زيارة
5. تحديث حالة عرض السعر
6. اعتماد أو رفض عرض السعر
7. وصول طلب جديد إلى المشتريات
8. اعتماد أو رفض الطلب من المالية
9. تحديث حالة الطلب من المشتريات
10. اكتمال التنفيذ من التشغيل
11. إصدار فاتورة جديدة
12. تأخر سداد الفاتورة
13. اقتراب انتهاء عقد
14. اقتراب موعد تجديد التعاون
15. وجود مشكلة أو استفسار من قسم آخر
16. تغيير الموظف المسؤول عن العميل أو الطلب

**Technical requirements** (§16):
- APIs documented with OpenAPI for every Sales endpoint, ready for future apps.
- Audit of every action and change.
- Advanced search and filtering with Arabic normalization.
- Protection of customer, contract, price and financial data through field rules: price history, discounts and costs are hidden from anyone outside Sales management and Finance.
- Backups: an Atlas backup policy noted in DEPLOY.md.

**Acceptance checklist:** walk through the SAL §18 list of 20 deliverables and the §19 recommendations one by one in SALES_COVERAGE.md.

## 4. Tests (definition of done, per slice)
API tests for every validation, every workflow transition and every role's allowed and forbidden actions. At least:
- **Visibility:** a rep can't see another rep's customer, and the duplicate check doesn't leak it; a 4th contact is refused; the communication log can't be edited or deleted and survives an owner change.
- **Opportunities and leads:** خاسرة needs a loss reason; the 24-hour lead alert fires.
- **Requests:** every service route moves step by step with stage-log entries; the Finance approver can't be the creator; Operations' 3-business-day SLA counts over a weekend and a holiday; closing successfully notifies Operations.
- **Quotes and documents:** a discount above the rep's limit needs the manager, and above the manager's limit the executive; the customer-facing quote and invoice contain no discount and no previous price.
- **Versioning:** price history and target versions are append-only.
- **Contracts and money:** a contract of a year or more alerts at 3 months; Sales can't write any financial figure.
- **Scrap:** a scrap request is visible to Operations, and a status change notifies the other department.
- **Delivery:** every one of the 16 notifications fires; exports respect permissions.
- **Web:** screens checked in RTL at 375px and at desktop width, all copy in `ar`.

## 5. Reporting back after each slice
A table: SAL §x.y → commit → test name; anything you disagreed with or couldn't do; the open questions still blocking. Update DECISIONS with every behaviour choice. Don't deploy.
