# Sales module [SAL] — plan, interfaces, integration and open questions

Written 2026-11-12 from the whole `# SAL — المبيعات` chapter of `docs/SPECS.md` (§1–§19), `CLAUDE.md` and `docs/DECISIONS.md`, as the spec's closing note asks: «تقديم تصور للواجهات وآلية الربط بين الأقسام، وتحديد المتطلبات التقنية التي تحتاج إلى تكامل خارجي، قبل البدء في مرحلة البرمجة والتنفيذ». **No Sales code is written until the owner approves this plan and answers (or defers) the questions in §9.** Owner decision 2026-11-12: Sales is built before phase 2 (attendance) — DECISIONS §7.

Conventions: Arabic labels in «…» are verbatim from the spec and go into the `ar` locale unchanged. Money is integer halalas, weights integer kilograms. Everything the spec leaves to "الصلاحيات" or "القائمة المعتمدة" is a setting or an admin-managed list, never a constant.

---

## 1. Scope

**Built here**
- The Sales module: customers and opportunities (CRM), the seven services and their requests, quotes, price list and discount matrix, contracts and the invoice register (read-only for Sales), calendar extensions, email, discussions, tags, targets, KPIs, dashboard, reports, notifications, OpenAPI.
- Shared pieces, built once in core / crm so later modules reuse them: `crm` (customers, contacts, leads, communication logs), `core/parties` (minimal party master, FIN §8), `core/tags`, `core/kpi`, `core/discussions`, `core/email` (adapter + saved messages), stage-log delay reasons in `core/workflow`.
- Thin hand-off stages for **المشتريات، المالية، التشغيل والمشاريع** on the **same Sales record and number**, each with a queue «الطلبات الواردة من المبيعات» and only the actions SAL §6.1 / §5 give that department. Every hand-off emits an outbox event so the real PRC / FIN / OPS modules take the stage over later on the same record (golden rule 6).
- The CS referral form «إحالة عميل محتمل إلى المبيعات» on the shared `leads` collection, for users in the Customer Service department.
- The Marketing notice from the Sales calendar (notification to the Marketing manager and members).

**Not built here**: the Procurement, Finance, Operations, Customer Service and Marketing modules; ZATCA signing/XML; the mobile app; the customer app / company portal; the PDF renderer (HTML output until DECISIONS §1 item 11).

**One place where I propose to go slightly beyond "Sales only" — needs the owner's yes:** invoices. SAL §7.3 and §19 say invoice and collection data belong to Finance and Sales only reads them. Golden rule 2 says only the owning module writes a collection. So the `invoices` collection should be owned by a Finance module from day one. I propose a **minimal `modules/finance/` directory containing only the invoice register** (model, zod schema, the thin Finance-stage service that records an invoice against a sales order, and the ZATCA-ready fields). It is the seed the Finance module grows from in phase 4/5, not a second home for invoices that would later need migrating. Alternative: keep invoices inside `modules/sales/` and move them later (one migration, more risk). **Default if unanswered: the minimal finance directory.**

---

## 2. External integrations and adapter seams

| Need | Spec | Adapter (interface in `core/`) | What works manually until connected | Blocked by |
|---|---|---|---|---|
| Send email from the employee's mailbox or the department mailbox, attachments, save to the customer file | §3, §7.3, §10.1, §19 | `core/email`: `MailboxProvider { sendAs(user \| department, message), capabilities }`. Implementations: `disabled` (default now), later `microsoft365` (Graph API) or `googleWorkspace` (Gmail API) with OAuth per user. Inbound (§10.1 «إرسال واستقبال») is a later adapter (`fetchInbound`) that files messages by the customer's email addresses | The message is composed in the system (to, cc, subject, body, attachments from the record), **saved to the customer file as «مسوّدة لم تُرسل»** with author and time, and a `mailto:` + "copy text" button lets the rep send it from their own mail client; the rep then marks it «أُرسل خارج النظام» (logged). Nothing is lost; the adapter later flips the same records to «أُرسل من النظام» | Q5 (provider), DECISIONS §1 item 4 (sending domain) |
| System mail (notifications) | §14 | exists: `notifications/channels.ts` (SES), switched off by `notifications.emailEnabled` | in-app notifications | DECISIONS §9 |
| E-invoicing (ZATCA / Fatoora) | §7.3, FIN §10 | `finance/zatca`: `EInvoiceProvider { validate(invoice), submit(invoice), status(id) }`; **not implemented** now, invoice model stores every ZATCA field (type tax/simplified, issue date-time, sequential number, UUID, tax category per line, QR payload placeholder, XML placeholder, integration state «بانتظار الإرسال», response) | Per Q4: Finance records the invoice issued in the current system (number, date, amounts, PDF) against the sales order, or prepares a draft here | Q4, open decision "ZATCA route" |
| Maps (meeting location, customer location, delivery address) | §5.3, §5.5, §9 | `core/geo`: `Geocoder { geocode(address), reverse(lat,lng) }` — not implemented; records store `locationUrl` (any maps link) plus optional `lat/lng` | Paste a Google Maps / Apple Maps link; the UI shows "افتح في الخرائط" | open decision "maps provider" |
| Market prices (weekly) | §3, §7.1, §11 | `sales/marketPrices`: manual entry by an authorized user, append-only with valid-from; a `MarketPriceSource` adapter can import later | Manual entry screen | Q6, Q11 |
| Finance budgets and spent figures on the manager dashboard | §8.3 | Read from the Finance module when it exists (`finance.budgets`) | Cards render «لا توجد بيانات مالية بعد» — **never an input** | Finance module (phase 4) |
| Customer app / company portal (customer-facing documents) | §7.3, CS §6.3 | Customer-facing DTOs and HTML templates are built now (quote, order, invoice copy); they are what the portal will serve | Download / email the document | CS module |
| PDF rendering | §7.3, §12 | exists as a seam: `core/templates/pdf.ts` (HTML now) | Printable RTL HTML, browser print | DECISIONS §1 item 11 |
| OpenAPI (§16 «واجهات برمجية») | §16, §18 | New: route metadata registered with `zod` schemas → `GET /api/v1/openapi.json` (library `@asteasolutions/zod-to-openapi`, a dev-time generator; adds one dependency — say if you object) | — | — |
| Backups | §16 | Not code: Atlas continuous backup / snapshot schedule documented in `docs/DEPLOY.md` | — | Atlas project (DECISIONS §1) |

---

## 3. Data model

Owner in brackets; every collection has `createdAt/updatedAt`, soft delete via `deletedAt` where the spec allows deletion at all, audit on every write (golden rules 3–4). Ids are ObjectIds; numbers are `PREFIX-YYYY-#####` from the atomic counter.

### 3.1 `core/parties` [core] — FIN §8 minimal
`parties`: `legalNameAr`, `legalNameEn?`, `normalizedName` (Arabic-normalized), `roles: ['customer'|'supplier'][]`, `unifiedNumber?` (700…), `crNumber?`, `vatNumber?`, `nationalAddress?` {building, street, district, city, postalCode, additional}, `email?`, `phone?`, `bank?` (Finance-only fields: `vatNumber`, `bank` — field rules), `documents` (via core documents, owner type `party`), `status: active|inactive`.
Indexes: unique partial on `unifiedNumber`, `crNumber`, `vatNumber`; `normalizedName` text/exact for the duplicate check. Duplicate rule: same CR / unified / VAT → block; same normalized name → warn and require confirmation by a manager.

### 3.2 `modules/crm` [crm]
- `customers` (`CUS`): `kind: individual|organization`, `partyId?` (organizations), `nameAr`, `normalizedName`, `country`, `region`, `city`, `activity`, `organizationType` (list, Q8), `facilitySize` (list, Q7), `source` («وسائل التواصل الاجتماعي / الزيارات الميدانية / الترشيحات / خدمة العملاء / الاتصالات المباشرة / المعارض والمؤتمرات / مصادر أخرى»), `status` («عميل نشط / عميل محتمل / عميل غير مهتم / عميل متعاون / عميل متوقف عن التعامل»), `classification?` («استراتيجي / منتظم / عرضي», Q9), `ownerUserId` (الموظف المسؤول), `departmentId` (owning department: Sales now, Sustainability later), `tags[]`, `phones[]` (normalized digits for matching), `leadId?`, `lastContactAt` (derived from the log, denormalized for sorting), `nextFollowUpAt`, `appAccountId?`, `portalAccountId?` (CS later), `legacyId?` (ERPNext).
  Indexes: `{ownerUserId, status}`, `{departmentId}`, `normalizedName`, `phones`, `partyId`, `tags`, text index for search.
- `customerOwnerships` (append-only): `customerId`, `fromUserId`, `toUserId`, `byUserId`, `reason`, `at`, `bulkBatchId?` — history of «نقل العميل من موظف إلى موظف آخر» (§8.1, §19).
- `contacts`: `customerId`, `nameAr`, `jobTitle`, `phone`, `email`, `notes`; **server limit 3 per customer** (counted inside the transaction, 409 on the 4th).
- `communicationLogs` (**append-only, no PATCH/DELETE routes at all**): `customerId`, `opportunityId?`, `requestId?`, `authorUserId`, `at` (server time), `method` («اتصال / بريد إلكتروني / زيارة / اجتماع»), `details` (تفاصيل المحادثة والنتائج), `outcome`, `customerNeed`, `nextStep`, `nextFollowUpAt?`, `attachmentIds[]`, `followUpNotifiedAt?`. Index `{customerId, at}`. Survives owner changes because it hangs on the customer, not the owner.
- `leads` (`LED`): `type`, `interest`, `source`, `channel`, `customerName`, `contactName`, `phone`, `email`, `notes`, `referredByUserId` (CS user), `referredAt`, `targetDepartment: sales|sustainability`, `assigneeUserId?`, `assignedAt?`, `registeredAt?` (when converted/registered), `state` (CS §6.8 verbatim: «جديد / تم التواصل / محال للقسم المختص / قيد المتابعة / فرصة قائمة / تم تحويله إلى عميل / غير مهتم / مغلق»), `outcome?`, `customerId?`, `opportunityId?`, `overdueNotifiedAt?` (24 h rule, Q13).

### 3.3 `modules/sales` [sales]
- `opportunities` (`OPP`): `customerId`, `title`, `serviceType?` (one of the seven), `stage` («جديدة / قيد المعالجة / تم التواصل / جدولة اجتماع / عرض سعر مرسل / قيد التفاوض / ناجحة (تم إغلاق الصفقة) / خاسرة (لم تتم الصفقة)»), `expectedValueHalalas`, `ownerUserId`, `nextFollowUpAt`, `lostReason?` (list, Q7; **required when stage = خاسرة**, enforced by zod + service), `lostNote?`, `attachmentIds[]`, `tags[]`, `leadId?`, `wonAt?/lostAt?`. `opportunityStageLogs` (append-only) record every stage move with actor and time (feeds "last contact" and funnel reports).
- `salesRequests` (one collection, Mongoose discriminator on `type`; numbers by type):

  | `type` | Prefix | Own fields (verbatim lists in §5) |
  |---|---|---|
  | `containerSale` | CSR | region, containerType, size, count, color, dimensions, requestDate, agreedPriceHalalas, notes |
  | `sortingContract` | SRT | contractType, materialTypes[], expectedQuantitiesKg, customerLocation, contractDurationMonths, pickupSchedule, notes |
  | `cleaningContract` | CLN | serviceLocation, wasteType, serviceType, mode: provideContainer\|directCollection, containerCount?, visitCount, contractDurationMonths, contractStart, contractEnd |
  | `destruction` | DST | contactPersonName, contactPhone, customerLocation, materialType, estimatedQuantityKg, materialPhotoIds[], notes, opsEstimate {weightKg, quantity, byUserId, at}, assessmentVisitEventId? |
  | `containerRental` | RNT | contactPhone, address, region, containerSize, containerCount, color, dimensions, deliveryZone: insideEastern\|outsideEastern («داخل المنطقة الشرقية / خارجها»), requestDate, requestedDeliveryDate, rentalDurationDays, containerResponsibleUserId, notes, containerNumbers[] (free text until OPS registry) |
  | `scrap` | SCR | region, materialType (list or «مواد متنوعة»), mobile, address, contactPersonName, materialDescription, estimatedQuantityKg, proposedPriceHalalas, agreedPriceHalalas, followUpUserId, purchaseStatus, transferStatus («تم التحويل / لم يتم التحويل») |
  | `assetReturn` | ARO | region, facilitySize, tenderSource (list), tenderInfo, assetType, opportunityDate, lastContactAt, nextConversationAt, cooperationStatus («تم التعاون / لم يتم التعاون / قيد الدراسة / قيد التفاوض»), nonCooperationReason (required for لم يتم التعاون) |

  Common fields: `number`, `customerId` (**required** — §19 every request hangs off the customer file), `opportunityId?`, `ownerUserId` (الموظف المسؤول), `departmentId` (Sales), `title`, `attachmentIds[]`, `tags[]`, workflow fields (`state`, `stateEnteredAt`, `dueAt`), `currentDepartment` (sales|procurement|finance|operations — who holds it now, drives the queues), `needsProcurement` (bool, default per type), `quoteId?`, `salesOrderId?`, `contractId?`, `invoiceIds[]`, `closingOutcome?` («تم الإغلاق بنجاح / تم الإغلاق دون استكمال / تم إيقاف المشروع / تم إلغاء المشروع»), `closingNote`, hand-off sub-documents: `procurement {supplierPartyId?, supplierQuoteAttachmentIds[], receiptFormAttachmentId?, deliveryDate?, notes}`, `finance {decision, decidedByUserId, decidedAt, notes, rejectionReason, purchaseDocumentAttachmentIds[]}`, `operations {scheduledVisitEventIds[], quantitiesKg, weightsKg, receiptReportAttachmentIds[], deliveryReportAttachmentIds[], notes}`.
  Indexes: `{type, state}`, `{customerId}`, `{ownerUserId, state}`, `{currentDepartment, state}`, `number` unique, `tags`.
- `rentalInspections` (append-only): `requestId`, `phase: beforeDelivery|afterDelivery|afterPickup` («قبل التسليم / بعد التسليم / بعد السحب»), `photoIds[]`, `at` (server), `byUserId`, `signatureAttachmentId?` / `receiptProofAttachmentId?`, `notes`, `containerCondition`, `containerNumber`.
- `scrapAssessments` (append-only): `requestId`, `visitEventId?`, `result`, `photoIds[]`, `quantitiesKg`, `categories[]`, `proposedPriceHalalas`, `agreedPriceHalalas?`, `nextAction`, `byUserId`, `at`. Scrap tasks are core `tasks` with `source {type:'sales_request'}` and a `payload.scrap {customersToContact, taskType, visitAt, agreedPriceHalalas, taskStatus: done|notDone («تمت / لم تتم»), transferStatus («تم التحويل / لم يتم التحويل»)}`.
- `priceItems`: `kind: material|service`, `nameAr`, `category`, `unit: ton|kg|piece|visit|month|contract`, `active`. `priceEntries` (**append-only**): `itemId`, `priceHalalas` (per unit), `validFrom`, `byUserId`, `at`, `note`. `marketPrices` (append-only): `itemId`, `weekOf` (Riyadh Sunday), `priceHalalas`, `source`, `byUserId`. Effective price = latest entry with `validFrom ≤ date`.
- `quotes` (`QUO`): `customerId`, `opportunityId?`, `requestId?`, `version`, `lines[] {itemId, descriptionAr, quantity, unit, listPriceHalalas (snapshot), discountPercentBp?, discountHalalas?, netUnitPriceHalalas, lineTotalHalalas, vatRateBp (1500), vatHalalas}`, `subtotal`, `discountTotal`, `vatTotal`, `total`, `maxDiscountPercentBp` (derived, for the matrix), `approval {requiredLevel: none|manager|executive, approvedByUserId?, approvedAt?}`, `state` (internal + customer states, §5.3), `sentAt?`, `sentVia`, `customerResponse {state, reason?, at, byUserId}`, `rejectionReason` (**required for مرفوض**), `attachmentIds[]`, `validUntil`. Append-only `quoteEvents` (created, edited, approval requested/granted/refused, sent, response recorded) — the internal audit trail §7.3 asks for.
- `salesOrders` (`SO`): from an accepted quote: `quoteId`, `customerId`, `requestId?`, snapshot of lines (net only), `signedFileAttachmentId`, `signedAt`, `state: open|invoiced|closed|cancelled`.
- `contracts` (`CNT` — prefix exists): `customerId`, `requestId?`, `salesOrderId?`, `contractType` (list, Q7), `startDate`, `endDate`, `durationMonths`, `items[] {itemId, quantity, unit, agreedPriceHalalas}`, `schedule[] {plannedAt, kind: delivery|pickup, status: planned|done|missed, doneAt?, note}` («متابعة تنفيذ كل موعد تسليم»), `signedFileAttachmentId`, `renewalOf?`, `alerts {threeMonthsSentAt?, renewalReminderSentAt?}`, `state: active|expiring|expired|renewed|terminated`. `contractEvents` (append-only log of operations §7.4). `cooperationCertificates` (`CRT`): `contractId`, `number`, `issuedAt`, `issuedByUserId`, `attachmentId` (HTML now), `sendLog[] {at, to, byUserId, via}`.
- `salesTargets` (**append-only versions**): `period` (YYYY-MM), `scope: department|user`, `userId?`, `dimension?: service|material`, `dimensionKey?`, `valueHalalas` or `valueKg`, `version`, `previousValue`, `reason`, `byUserId`, `at`, `withdrawn: bool`. Current target = latest non-withdrawn version per (period, scope, user, dimension).
- `modules/finance/invoices` (`INV`) — see §1: `salesOrderId`, `customerId`, `partyId`, `kind: tax|simplified`, `issueDateTime`, `sequence`, `uuid`, `lines[] {…, taxCategory}`, `subtotal`, `vatTotal`, `total`, `dueDate`, `collectedHalalas`, `remainingHalalas`, `collectionState` («مستحق / محصل جزئياً / محصل بالكامل / متأخر»), `payments[] {at, amountHalalas, proofAttachmentId, byUserId}` (append-only), `externalNumber?`, `externalPdfAttachmentId?` (Q4 option A), `zatca {state: pending|sent|accepted|rejected, qr?, xml?, response?, error?}`, `issuedByUserId`, `sentLog[]`. Written only by Finance-role users through the Finance thin stage; Sales reads.

### 3.4 Core additions [core]
- `core/tags`: `tags {scope: 'sales'|…, name (with #), normalizedName, color?, byUserId}`; records hold `tags: string[]` (names). Managed by the department manager (`tags:edit` department scope); search `?tag=`.
- `core/kpi`: `kpiDefinitions {code, nameAr, unit, period, direction: higher|lower, computeKey? | manual}`, `kpiTargets` (append-only versions, scope + period), `kpiActuals {code, period, scope, value, source: computed|manual|imported, computedAt}`. Sales registers five computers (§7 of this plan). Status achieved/below/exceeded and pace vs elapsed days are computed on read.
- `core/discussions` (`DSC`): `recordType`, `recordId`, `customerId?`, `title`, `details`, `targetDepartmentId`, `participantUserIds[]`, `openedByUserId`, `state` («جديدة / قيد المعالجة / بانتظار الرد / تم الحل / مغلقة»), `attachmentIds[]`; messages are core comments on `recordType: 'discussion'`. Notifies the target department's manager and members.
- `core/email`: `emailMessages {recordType, recordId, customerId, direction: out|in, fromUserId, fromMailbox: user|department, to[], cc[], subject, bodyHtml, attachmentIds[], state: draft|sentExternally|sent|failed, sentAt, provider}`, plus the `MailboxProvider` seam.
- `core/workflow` stage log gains `delayReason` and `delayResponsibleDepartmentId` set through `POST /…/:id/stage-log/:entryId/delay-reason` when a stage overran its SLA (§19 «سبب تأخر الطلب والجهة المسؤولة»). The engine already stores entered/left times, actor and department.
- `core/export`: Sales registers the resources in §7.5 of this plan; `core/calendar`: the event `link` gains `customer` and `sales_request` types; `EVENT_TYPES` gets `exhibition` (for the Marketing notice) and `meetingType` (list, Q7) is stored in `description`-independent field `meetingType`.

### 3.5 Customer-facing DTOs and templates vs internal views
- Internal API responses include list price, discount, approver and history **only for** `sales_manager`, `executive` and Finance roles (field rules on `sales.quotes`: `lines.listPriceHalalas`, `lines.discount*`, `approval`, `quoteEvents` are sensitive fields in `SENSITIVE_FIELDS_BY_RESOURCE`). The rep who built the quote sees their own discount while editing; nobody outside Sales management and Finance sees price history or costs (§16).
- Customer-facing: `toCustomerQuoteDto`, `toCustomerOrderDto`, `toCustomerInvoiceDto` return **net unit price, quantity, line total, VAT, total only** — no list price, discount, previous version or difference fields exist on the DTO type at all (a test asserts the serialized JSON and the rendered HTML contain none of them). Templates `quote.hbs`, `sales_order.hbs`, `invoice.hbs` (RTL HTML, `core/templates`) consume only those DTOs. These are what the future company portal (`/api/portal/*`) will serve.

---

## 4. Route per service type (workflow definitions, editable in /admin/workflows)

One workflow definition per type: `sales_request_container_sale`, `sales_request_sorting`, `sales_request_cleaning`, `sales_request_destruction`, `sales_request_rental`, `sales_request_scrap`, `sales_request_asset_return`. States share one vocabulary so the queues and the stage log read the same across types; each type's definition contains only the states it uses. Actor relations the Sales module computes for the engine: `owner` (الموظف المسؤول), `sales_manager`, `executive`, `procurement_staff`, `procurement_manager`, `finance_staff`, `finance_manager`, `operations_staff`, `operations_manager` (staff/manager of the department holding the stage — Q12 decides whether staff may act), plus role codes.

> **Approved with changes (DECISIONS §20):** the Finance stage gains `finance_needs_info` «يحتاج استكمال بيانات» (change 4); the Operations stage uses the OPS §2.1 labels verbatim — جديد / قيد المراجعة / مجدول / قيد التنفيذ / مكتمل / مؤجل / ملغي / مرفوض — instead of «لدى التشغيل» / «تم التنفيذ», and scrap follows OPS §2.2 (change 5). The table below is the pre-approval draft; S2 implements the approved version.

### Shared state vocabulary (code → «label», category, owner)
| Code | Label | Cat. | Holder |
|---|---|---|---|
| `new` | جديد | open | Sales owner |
| `quoting` | إعداد عرض السعر | open | Sales owner |
| `quote_sent` | عرض سعر مرسل | waiting | customer / Sales owner |
| `negotiating` | قيد التفاوض | open | Sales owner |
| `customer_approved` | تمت موافقة العميل | open | Sales owner (uploads contract / sales order) |
| `contracting` | التعاقد | open | Sales owner |
| `at_procurement` | لدى المشتريات | open, SLA (setting) | Procurement |
| `at_finance` | بانتظار اعتماد المالية | waiting, SLA (setting) | Finance |
| `finance_rejected` | مرفوض من المالية | open | Sales owner (fix and resubmit, or close) |
| `execution_started` | بدأ التنفيذ | open | Procurement |
| `execution_in_progress` | قيد المعالجة | open | Procurement |
| `execution_rejected` | تم الرفض | open | Sales owner |
| `execution_cancelled` | تم الإلغاء | cancelled | — |
| `execution_done` | تم الإنجاز | open | hands to Operations |
| `ops_estimate` | تقدير أولي من التشغيل | open | Operations (destruction photos) |
| `ops_assessment_visit` | زيارة تقييم | open | Operations |
| `at_operations` | لدى التشغيل | open, **SLA 3 business days** to schedule | Operations |
| `ops_scheduled` | مجدول | open | Operations |
| `ops_in_execution` | قيد التنفيذ | open | Operations |
| `ops_executed` | تم التنفيذ | open | Sales owner (close) |
| `closed_success` | تم الإغلاق بنجاح | done | — |
| `closed_incomplete` | تم الإغلاق دون استكمال | done | — |
| `suspended` | تم إيقاف المشروع | waiting | Sales manager |
| `cancelled` | تم إلغاء المشروع | cancelled | — |

Closing (§6.2) is available from any non-final state to the Sales owner / manager with the four outcomes; `closed_success` emits `sales.request.closed_success` and notifies Operations («اكتمال… / استكمال إجراءات التنفيذ أو جدولة الزيارات»). Suspension and cancellation need a reason.

### Per type
- **بيع الحاويات (CSR, §5.1):** new → quoting → quote_sent → (negotiating ↔) → customer_approved → **at_procurement** (default `needsProcurement = true`; the spec lists «رفع طلب إلى المشتريات» unconditionally) → at_finance → execution_started → execution_in_progress → execution_done → at_operations (only when `needsOperations`, «التنسيق مع التشغيل عند الحاجة») or directly → closed_success. Finance rejection → finance_rejected.
- **الفرز (SRT, §5.2)** and **عقد النظافة (CLN, §5.3):** new → quoting → quote_sent → customer_approved → contracting (creates the `contracts` record, signed file) → optional at_procurement / at_finance (`needsProcurement`, `needsFinanceApproval` flags set by the owner; «عند الحاجة») → at_operations → ops_scheduled → ops_in_execution (received quantities, visits and receipts logged repeatedly on the record) → ops_executed → closed_*. Renewal and duration follow the contract (§6.3, §7.4).
- **الإتلاف (DST, §5.4):** new → **ops_estimate** (customer photos go to Operations; they record weight and quantity) → optional **ops_assessment_visit** (calendar event, Operations) → quoting («إعداد التسعيرة بناءً على التقييم») → quote_sent → customer_approved → **at_finance** («تحويل الطلب إلى المالية لإصدار الفاتورة»; the invoice step depends on Q4) → at_operations (SLA 3 business days) → ops_scheduled → ops_in_execution → ops_executed (محضر أو مستند استلام attached, required) → closed_success.
- **تأجير الحاويات (RNT, §5.5):** new → **at_operations** directly («إحالة الطلب مباشرة إلى قسم التشغيل») → ops_scheduled → (inspection «قبل التسليم») → ops_in_execution = delivered (inspection «بعد التسليم») → ops_executed = picked up (inspection «بعد السحب») → closed_success. Pricing: the agreed price is on the request; a quote is optional (`quoting` reachable from `new` when the owner wants one).
- **السكراب (SCR, §5.6):** shared record, visible to Sales and Operations at every state: new → ops_assessment_visit (schedule, Operations or Sales) → `assessed` «تم التقييم» (assessment row with proposed/agreed price) → `purchase_agreed` «تم الاتفاق» → `collected` «تم الاستلام» → `transferred` «تم التحويل» → closed_success; tasks via «رفع مهمة» at any time. Every state change notifies the other department.
- **رجيع الأصول (ARO, §5.7):** states are the cooperation statuses: `under_study` «قيد الدراسة» (initial) → `negotiating` «قيد التفاوض» → `cooperated` «تم التعاون» (done; may spawn a service request) / `not_cooperated` «لم يتم التعاون» (done, reason required). `nextConversationAt` drives a reminder.

### Hand-off events (outbox) and queues
`sales.request.sent_to_procurement`, `sales.request.sent_to_finance`, `sales.request.finance_decided`, `sales.request.procurement_updated`, `sales.request.sent_to_operations`, `sales.request.operations_completed`, `sales.request.closed`, `sales.scrap.updated`, `crm.lead.referred`, `crm.customer.owner_changed`, `sales.quote.sent`, `sales.quote.decided`, `sales.contract.expiring`, `finance.invoice.issued`, `finance.invoice.overdue`, `sales.event.marketing_notice`. Each receiving department sees «الطلبات الواردة من المبيعات» = requests whose `currentDepartment` is theirs, and gets notifications 7–10 of §14. The stage log records department, actor, entered/left, SLA breach and the delay reason.

---

## 5. Permissions

New module roles (system roles, seeded, grants editable by the admin like every other role): **`sales_rep`** «موظف مبيعات» and **`sales_manager`** «مدير المبيعات» (department-scoped to Sales). Resources and default grants:

| Resource | sales_rep | sales_manager | executive | Procurement / Finance / Operations roles | CS dept users |
|---|---|---|---|---|---|
| `crm.customers`, `crm.contacts`, `crm.logs` | view/create/edit **own** | view/create/edit/export department; transfer | view all | view only the customers behind requests in their queue | view/create via lead referral only |
| `crm.leads` | view own (assigned) | view/edit/assign department | view | — | create + view own referrals |
| `sales.opportunities` | own | department | view | — | — |
| `sales.requests` | own | department (incl. state changes within rules) | view | stage actions on records in their queue (`currentDepartment`), view those records | — |
| `sales.quotes` | create/edit own; approve within rep limit | approve within manager limit | approve above manager limit | Finance: view (with internal fields) | — |
| `sales.pricelist` | view | edit (if in `sales.priceEditorRoles`, Q6) | view | Finance: view | — |
| `sales.contracts`, `sales.certificates` | own | department | view | Finance/Ops: view in queue | — |
| `finance.invoices` | view own customers' (read-only) | view department (read-only) | view | Finance: create/edit | — |
| `sales.targets`, `sales.kpi`, `sales.dashboard`, `sales.reports` | own | department | all (read) | — | — |
| `tags` (scope sales) | view | edit | view | — | — |
| `discussions` | create/view own | department | view | participants/target department | — |

Rules enforced in the service layer regardless of grants (golden rule 1, FIN §12): the Finance approver is never the request's creator or owner; a quote approver is never its author; discount approval level is computed from settings; `own` scope means `ownerUserId = me` (and for the manager `departmentId = Sales`). Duplicate check: `POST /crm/customers/check` returns only `{duplicate: true, message: «هذه الجهة مسجلة لدى موظف آخر — راجع مدير القسم»}` for a rep; the manager gets the matching customer and owner.

**Customizable permissions (§15 last line).** Correction to the prompt's premise: roles are *not* read-only today — the admin screen `/admin/roles` already creates custom roles, edits grants (resource × action × scope) and deletes non-system roles, and every role change is audited with a diff and alerts the other admins (DECISIONS §14 A). What is code-defined is only the **field-level rules of system roles** (default-deny of sensitive fields) and the **grantable-roles matrix**. Proposal, no new engine:
1. Ship `sales_rep` / `sales_manager` as system roles; the admin tunes their grants or clones them into custom roles (e.g. «مشرف مبيعات» with department view but no approve).
2. Add the Sales sensitive fields (list price, discounts, approver, price history, costs) to `SENSITIVE_FIELDS_BY_RESOURCE`; the admin can grant them to a custom role through field rules in the same screen (field rules on custom roles are already editable).
3. Segregation of duties stays in code and is never grantable: self-approval, approving above your limit, Sales writing financial figures, and non-Finance writing invoices are refused whatever the grants say.
4. Extend `GRANTABLE_ROLES`: `sales_manager` may grant `sales_rep` to users of the Sales department (like HR grants `employee`), audited.
Nothing more is needed to satisfy «قابلة للتخصيص حسب طبيعة الوظيفة».

---

## 6. Screens (SAL §18 — twenty deliverables) and menu placement

Menu groups in the shell: **المبيعات** (for Sales roles), **الطلبات الواردة من المبيعات** (under each receiving department's group), **خدمة العملاء → إحالة عميل محتمل** (CS department users), **الإدارة التنفيذية → مؤشرات المبيعات** (executive, read-only). All screens RTL, 375 px and desktop; phone-first for the rep's log/visit/photo screens.

| # | §18 deliverable | Screen(s) and route | Slice |
|---|---|---|---|
| 1 | الواجهة الرئيسية لقسم المبيعات | `/sales` landing: the two main buttons «عميل جديد / فرصة بيعية جديدة» and «الخدمات» (dropdown of the seven services), my follow-ups due today, my open requests, my targets | S1 (buttons grow in S2) |
| 2 | واجهة إدارة العملاء والفرص (CRM) | `/sales/customers` (table, filters, tags, search with Arabic normalization), `/sales/pipeline` (Kanban by stage + table toggle, filters §4.2) | S1 |
| 3 | واجهة ملف العميل وسجل التواصل | `/sales/customers/:id` tabs: البيانات، الأشخاص المسؤولون (≤3), سجل التواصل (chronological, add-only, attachments, phone-first composer), الفرص، الطلبات، العقود، الفواتير (read-only), المراسلات، النقاشات، الوسوم، السجل | S1 (tabs filled by later slices) |
| 4 | واجهة استقبال وتوزيع العملاء المحتملين | `/sales/leads` (manager: assign one or many, 24 h indicator; rep: mine), CS form `/cs/refer-lead` | S1 |
| 5 | واجهات الخدمات والطلبات البيعية | `/sales/requests` (list by type/state/department), `/sales/requests/new/:type` (one form per type with its own field set), `/sales/requests/:number` (header, stage log with delay reasons, hand-off panels, attachments, discussions, scrap tasks/assessments, rental inspections) | S2 |
| 6 | واجهة إدارة عروض الأسعار | `/sales/quotes`, quote builder from the price list (live market price hint), approval banner with the required level, send dialog (email adapter / mailto fallback), customer response dialog with rejection reason, customer-facing preview | S3 |
| 7 | واجهة قائمة الأسعار المركزية | `/sales/pricelist` (items, current price, valid-from, history drawer, weekly market price entry) | S3 |
| 8 | واجهة مصفوفة الخصومات والاعتمادات | `/sales/discount-matrix` (read-only view of the settings + the approvals log; editing in `/admin/settings` group «المبيعات») | S3 |
| 9 | واجهة إدارة العقود الدورية | `/sales/contracts`, `/sales/contracts/:number` (schedule with per-delivery status, alerts, renewal, certificate issue + send log) | S3 |
| 10 | واجهة إصدار الفواتير ومتابعة التحصيل | `/finance/sales-requests` (thin Finance queue: approve/reject, record invoice per Q4, record payments) and read-only `/sales/invoices` for Sales | S3 |
| 11 | واجهة إدارة المهام والزيارات | `/sales/tasks` (core tasks filtered to Sales + scrap task labels «حالة المهمة / حالة تحويل المبلغ»), visits from the calendar | S4 (scrap tasks in S2) |
| 12 | واجهة التقويم والاجتماعات | existing `/calendar` with Sales fields (customer link, meeting type, map link, online link, outcome + next follow-up) and the Marketing notice action | S4 |
| 13 | واجهة التواصل الداخلي بين الأقسام | discussion panel on customer / request + `/discussions` inbox per department | S4 |
| 14 | لوحة تحكم مدير المبيعات | `/sales/dashboard` (§13 five groups, role-dependent, every card drills down to a filtered list; §8.3 budget cards read-only from Finance or «لا توجد بيانات مالية بعد») | S4 |
| 15 | لوحة مؤشرات الأداء (KPIs) | `/sales/kpi` (§11.2 board, filters employee / department / service / period; targets with version history `/sales/targets`) | S4 |
| 16 | نظام التقارير والتصدير | `/sales/reports` on the core export builder (five report groups of §12, field picker, preview, Excel, HTML-PDF) | S5 |
| 17 | نظام الإشعارات | the 16 §14 types in the notification center (groups «المبيعات», «الطلبات الواردة») | S1–S5 as each flow lands; hygiene test in S5 |
| 18 | نظام الصلاحيات | roles `sales_rep` / `sales_manager`, field rules, admin role screen (existing) | S1 |
| 19 | الربط مع الأقسام الأخرى | queues «الطلبات الواردة من المبيعات» under المشتريات / المالية / التشغيل; CS referral; Marketing notice; outbox events | S2 (CS referral and Marketing notice in S1/S4) |
| 20 | توثيق واجهات الربط البرمجية (APIs) | `GET /api/v1/openapi.json` + `/api/v1/docs` (static viewer) covering every Sales/CRM endpoint | S5 (generated from S1 on) |

Receiving-department queue screen (one component, three mounts): list of requests with `currentDepartment = mine`, state, SLA countdown, Sales owner, customer; detail shows the Sales data read-only plus **only** that department's panel: Procurement (supplier party, supplier quote attachments, receipt form, delivery date, notes, status buttons بدأ التنفيذ / قيد المعالجة / تم الرفض / تم الإلغاء / تم الإنجاز, send to Finance), Finance (approve / reject with reason, notes, purchase documents, invoice record, payments), Operations (schedule visit → calendar, visit dates, quantities and weights, receipt/delivery reports, preliminary estimate for destruction, rental inspections, execution done).

---

## 7. Cross-cutting designs

### 7.1 KPI computers (core/kpi, Sales definitions)
| Code | Formula (per period, scope) | Target | Direction |
|---|---|---|---|
| `sales.revenue` «إجمالي الإيرادات» | Σ `invoices.total` with `issueDateTime` in period (Finance data) | annual plan (Q11) | higher |
| `sales.tons_sold` «الكمية المباعة» | Σ sales-order line quantities in kg ÷ 1000 per material | annual plan | higher |
| `sales.quote_conversion` «نسبة تحويل العروض» | accepted ÷ sent × 100 | **40%** (spec) | higher |
| `sales.avg_price_per_ton` «متوسط سعر الطن» | revenue ÷ tons per material vs market average of the period | ≥ market average (Q11 source) | higher |
| `sales.avg_collection_days` «متوسط مدة التحصيل» | mean(payment date − invoice date) over invoices fully collected in period | **≤ 45 days** (spec) | lower |
Actuals are recomputed by a daily job and on demand; status achieved / below / exceeded and pace vs elapsed days come from the core.

### 7.2 Jobs (core/jobs)
Frequent (5 min): follow-up due notifications (log `nextFollowUpAt`, lead 24 h rule), meeting reminders (existing), asset-return next-conversation reminders. Daily: contract 3-month alert and renewal reminder, invoice overdue (Q4), KPI recompute, targets achievement snapshot, 24 h lead digest to the Sales manager.

### 7.3 Notifications (§14) → type codes
`crm.lead.referred` (1), `crm.customer.assigned` (2), `crm.followup.due` (3), `meeting.reminder` exists (4), `sales.quote.status` (5), `sales.quote.decided` (6), `sales.request.to_procurement` (7), `sales.request.finance_decided` (8), `sales.request.procurement_updated` (9), `sales.request.operations_completed` (10), `finance.invoice.issued` (11), `finance.invoice.overdue` (12), `sales.contract.expiring` (13), `sales.contract.renewal_due` (14), `discussion.opened` / `discussion.replied` (15), `crm.owner_changed` (16). A hygiene test asserts each is emitted by code and has an Arabic title.

### 7.4 Audit and search
Every write through the existing audit middleware; views and downloads of customer-facing documents, price history and invoices are audited as sensitive. Search: `normalizedName` (أ إ آ→ا, ة→ه, ى→ي, strip tashkeel — `packages/shared/arabic.ts`), phone digits, number, tags, text index on details.

### 7.5 Export resources (core/export)
`sales_sales` (daily/weekly/monthly sales, revenue by material/service, quantities, average prices), `sales_customers` (database, new, active, non-cooperating, classification), `sales_opportunities` (stages, loss reasons), `sales_employees` (per-rep performance), `sales_financial` (from invoices; read-only). Field lists are permission-filtered; exports with internal price fields are audited `sensitive: true`.

---

## 8. Slices (SAL §17 order) — each ends with commits citing `[SAL §x.y]`, tests, `docs/SALES_COVERAGE.md` rows, a demo script in `docs/SALES.md`, and a stop for approval

| Slice | SAL §17 phase | Builds | Key tests |
|---|---|---|---|
| **S1** | المرحلة الأولى — قاعدة بيانات المبيعات | `core/parties`, `crm` (customers, contacts ≤3, append-only log, leads + CS referral form, 24 h rule), opportunities + pipeline (table/Kanban), owner transfer single/bulk with history and two notifications, roles `sales_rep`/`sales_manager`, `core/tags` with the eight seeded hashtags, follow-up job, phone-first log composer, Sales landing | rep can't see another rep's customer; duplicate check leaks nothing; 4th contact → 409; log has no PATCH/DELETE and survives owner change; خاسرة needs a reason; 24 h alert fires; bulk transfer notifies both reps |
| **S2** | المرحلة الثانية — الخدمات والطلبات | the seven request types and forms, seven workflow definitions, stage log + delay reasons, thin queues for Procurement / Finance / Operations, hand-off events and notifications 7–10, rental inspections, scrap tasks/assessments and Sales↔Operations visibility, asset-return reminders, closing outcomes | every route moves step by step with stage-log entries; Finance approver ≠ creator; Operations SLA counts over Fri–Sat and a holiday; closed_success notifies Operations; scrap change notifies the other department; procurement actions refused for Sales users |
| **S3** | المرحلة الثالثة — التسعير والتعاقد والفوترة | price items/entries/market prices (append-only), discount matrix settings and approval levels, quotes with internal/customer states, customer-facing DTOs and templates, sales orders, contracts with schedule and 3-month alerts, cooperation certificate, `modules/finance` invoice register per Q4 with ZATCA fields, email adapter (disabled) with saved messages | price history append-only; discount above rep limit needs manager, above manager needs executive; unauthorized approval refused; customer DTO/HTML has no discount or previous price; contract ≥ 1 year alerts at 3 months; Sales can't write any financial figure (403) |
| **S4** | المرحلة الرابعة — الإدارة والمتابعة | calendar extensions and Marketing notice, discussions, Sales tasks view, manager documents library, targets with versions, `core/kpi` + five computers, KPI board, Sales dashboard with drill-downs and read-only budget cards | target edit creates a version, never replaces; dashboard counts match lists; budget cards have no write path; discussion notifies target department; Marketing notice reaches manager + members |
| **S5** | المرحلة الخامسة — الاختبار والتكامل | five report groups on the export builder, OpenAPI, notification hygiene test (16 types), Atlas backup note, SALES_COVERAGE acceptance walk of §18 (20) and §19 (13), seed data for every state, 375 px / desktop RTL check | exports respect permissions; every notification emitted; OpenAPI lists every Sales route; coverage table complete |

Estimated size: S1 ≈ 25 API tests / 6 pages, S2 ≈ 35 / 10, S3 ≈ 30 / 8, S4 ≈ 25 / 7, S5 ≈ 15 / 2.

---

## 9. Questions for the owner (golden rule 11) — proposed default and what is blocked

| # | Question | Proposed default (used if you say "go with defaults") | Blocked until answered |
|---|---|---|---|
| 1 | **Discount limits** (§7.2) for موظف المبيعات and مدير المبيعات: percentage or amount? Per line or per quote? | Percentage of the list price, checked **per line and per quote total** (the stricter applies); settings `sales.discountLimitPercentBp.rep` and `.manager`, **both unset** until you give numbers; while unset, every discount escalates to the manager and anything the manager approves needs no executive (flagged `limits_unset`) | S3 approval thresholds (code works with unset = escalate) |
| 2 | **Does every quote need manager approval**, or only above the rep's limit? | **Only above the rep's limit** (§7.2); §3 «ضمن حدود صلاحياته» reads as the limit. Setting `sales.quoteApprovalMode: above_limit \| always` | nothing; default is a setting |
| 3 | **Finance approval on a Sales request**: who, and amount limits (FIN §12)? | `finance_manager` approves all; `finance_staff` may review and return «يحتاج استكمال»; the approver is never the creator/owner; no amount tiers until the authority matrix exists (setting `sales.financeApprovalRoles`) | S2 Finance thin stage uses the default; tiers later |
| 4 | **Invoices** (§7.3): where are invoices issued today (ERPNext?), ZATCA route and wave? Option A (record the externally issued invoice) or B (drafts here, nothing issued)? | **Option A**: Finance records number, date, amounts, PDF of the invoice issued in the current system against the sales order; collection and payments tracked here; ZATCA fields stored, no XML/signing | S3 invoice step of the destruction route and notifications 11–12 behave per the chosen option; KPI «إجمالي الإيرادات» source |
| 5 | **Email provider** for employee and department mailboxes (Microsoft 365, Google Workspace, other)? | Adapter `disabled`: compose in the system, save to the customer file, `mailto:` + copy, mark «أُرسل خارج النظام» | Actual sending from the system (§3, §7.3, §10.1) |
| 6 | **Price list content** (§7.1): material types/categories, unit vs ton, service prices, who edits, source of weekly market prices? | Start **empty**; units {ton, kg, piece, visit, month, contract}; editors = `sales_manager` (setting `sales.priceEditorRoles`); market prices entered manually weekly by an editor with a source note | Quotes need at least one price item; S3 demo uses sample items marked as such |
| 7 | **Lists the spec names but doesn't fill** (container types/sizes/colours/dimensions; contract types; waste and service types; destruction material types; scrap categories and task types; tender sources; meeting types; loss reasons; quote rejection reasons; non-cooperation reasons; facility sizes) | All are admin-managed lists in settings group «المبيعات», **start empty except**: meeting types {اجتماع، زيارة ميدانية، اتصال، عرض تقديمي}, facility sizes {صغيرة، متوسطة، كبيرة}, and loss / rejection / non-cooperation reasons {السعر، المنافس، التوقيت، لا حاجة حالياً، أخرى (مع توضيح)} — say if you want these removed | Forms show an empty dropdown with "يُضاف من الإعدادات" until filled; nothing blocks code |
| 8 | **Organization type**: SAL §4.1 «حكومي، خاص، عام» vs CS §6.8 | SAL's list as the initial configurable list; CS adds its values when built | nothing |
| 9 | **Customer classification** استراتيجي / منتظم / عرضي (§12): manual by the manager or by rule? | **Manual by the manager**, with a history row per change; a rule can be added later as a job | nothing |
| 10 | **Rental delivery «داخل المنطقة الشرقية أو خارجها»** (§5.5): price, route or information only? | **Information only**, shown to Operations; no price effect | nothing |
| 11 | **KPI targets** from the annual plan (§11) and the source of «متوسط السوق» | Targets entered by the Sales manager as versions (empty until given); market average = mean of the period's weekly market prices entered in the price list | KPI status shows «لا يوجد مستهدف» until targets exist |
| 12 | **Who acts on the thin stages** in Procurement / Finance / Operations: the department manager only, or staff too? | **Manager and staff** of that department may act; the manager is notified on every arrival, staff on assignment; Finance approve/reject is `finance_manager` only (Q3) | S2 actor relations |
| 13 | **The 24-hour rule** (§3): clock or business hours, who is alerted? | **24 clock hours** from referral; at breach the rep (if assigned) and the Sales manager are notified once, the lead is flagged «متأخر عن التسجيل»; setting `crm.leadRegistrationHours` | nothing |
| 14 | *(new)* **Invoice ownership**: minimal `modules/finance/` invoice register now (see §1)? | Yes | S3 |
| 15 | *(new)* **Operations' 3-business-day SLA** applies to every type reaching Operations, or only destruction (§5.4) and «حسب طبيعة الخدمة» (§6.1)? | Applies to **all** types as the default SLA of `at_operations`, editable per type in the workflow definition | nothing |
| 16 | *(new)* **Scrap money**: SAL §5.6 is about *buying* scrap (money flows out: «حالة تحويل المبلغ»). Is the transfer recorded here as a status only (default), or does it need a Finance thin step like a purchase? | Status only («تم التحويل / لم يتم التحويل») with proof attachment, no Finance approval step | nothing |

---

## 10. Things I disagree with or will do differently from the prompt (for your decision)
1. **"Roles are defined in code and read-only"** — not the case today (see §5); I propose no new permissions engine, only Sales roles, field rules and a grantable-roles extension.
2. **Container sale → Procurement "only when needed"**: SAL §5.1 lists «رفع طلب إلى المشتريات» unconditionally for container sales. I make `needsProcurement` default **true** for CSR and **false** for the contracts (SRT/CLN «عند الحاجة»), both overridable on the request.
3. **Invoices in a minimal Finance directory** rather than inside Sales (§1, Q14).
4. **Rental quote**: §5.5 has no quote step; I keep it optional rather than forced.
5. **Scrap and the Finance route**: §5.6 does not route scrap through Finance; I keep money transfer as a status unless Q16 says otherwise.

---

## 11. Acceptance
`docs/SALES_COVERAGE.md` will carry one row per bullet of SAL §1–§19 (Arabic verbatim → implementation → test), including the 20 deliverables of §18 and the 13 recommendations of §19, with a reason on any row that waits (ZATCA, email provider, Finance budgets, PDF renderer, OPS registry). Nothing is dropped silently. Each slice report lists SAL §x.y → commit → test, disagreements, and the questions still blocking. Nothing is deployed.
