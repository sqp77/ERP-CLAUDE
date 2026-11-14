# CLAUDE.md — Eayni ERP

## What this project is
A web ERP for **جمعية عيني لإعادة التدوير التعاونية** (Eayni Recycling Cooperative): one module per department on a shared platform. The Employee Portal is the single entry point for all staff (EP closing note).

- Stack: React (frontend) · Express + MongoDB (backend) · serverless deployment.
- Goal across all specs: every request moves between departments inside one system, with a clear owner, status, history and notification at each step, and managers see live KPIs per department.

### Specs (source of truth)
All ten department specs are in **one file: `docs/SPECS.md`** (Arabic, transcribed verbatim from the original PDFs, original section numbers kept). Cite them as `[CODE §x.y]` in code comments, commit messages and PRs; the code is the chapter, the number is the document's own section. When section `x` has no subsection `y`, `§x.y` means item `y` of section `x`'s numbered list (e.g. `[HR §7.11]`).

| Code | Chapter heading in `docs/SPECS.md` | Module |
|---|---|---|
| HR | `# HR — الموارد البشرية` | الموارد البشرية |
| EP | `# EP — البوابة الداخلية للموظفين` | البوابة الداخلية للموظفين |
| SAL | `# SAL — المبيعات` | المبيعات |
| CS | `# CS — خدمة العملاء` | خدمة العملاء |
| OPS | `# OPS — التشغيل` | التشغيل |
| PRC | `# PRC — المشتريات` | المشتريات |
| FIN | `# FIN — المالية` | المالية |
| MKT | `# MKT — التسويق` | التسويق |
| SUS | `# SUS — التنمية المستدامة والشراكات` | التنمية المستدامة والشراكات |
| IT | `# IT — التقنية` | التقنية |

- The file is large: don't load it whole. Find the chapter for the module you're working on (search for its heading) and read that chapter, plus any chapter a hand-off touches.
- Before building a feature, re-read its spec section; this CLAUDE.md is a summary, `docs/SPECS.md` wins when they differ.
- The original PDFs are kept in `docs/specs/originals/` for reference only; use `docs/SPECS.md`.
- **`docs/DECISIONS.md` settles what the specs leave open or contradict, and overrides CLAUDE.md defaults.** Read it before building a feature; add to it when the user decides something new.

## Golden rules
1. **The server is the source of truth.** Permissions, workflow transitions, approval limits and validation are enforced in the API. The UI only hides what the API already forbids.
2. **One record per real-world thing.** One employee file (HR owns it, the portal displays it — EP §20.1). One customer file shared by Sales, CS, Operations and Sustainability (SAL §19, CS §6.3). One container and vehicle registry (OPS §2.3). One party master for every outside organization, whether customer, supplier or both, with duplicate prevention (FIN §8). Modules reference records; they never copy them (except snapshots on issued documents such as quotes, invoices, certificates).
3. **History is append-only.** Communication logs, stage logs, price entries, target versions, approvals, document versions, attendance and movement logs are inserted, never updated or deleted. Business records use soft delete (`deletedAt`) only.
4. **Everything is audited.** Every write, plus views, downloads and sends of sensitive data (CS §6.6, EP §5.2, HR §7.6).
5. **Financial figures outside Finance are read-only** and come from Finance data, never typed in by another department (SAL §8.3, MKT §6.7, SUS §13).
6. **A financial request keeps its identity** (FIN §11): when a request moves to Finance it keeps the same reference number, attachments and approval log. Finance never re-creates it; Finance's own data attaches to the original.
7. **Segregation of duties** (FIN §12): the same user can't create, approve and pay the same request. Approval limits come from the financial authority matrix. The system admin has no automatic financial approval right.
8. **E-invoicing ready from day one** (FIN §10): outgoing invoices store every field ZATCA needs from the first release. The Fatoora integration itself comes in Finance phase 3, following the official ZATCA technical guides. Don't hand-roll signing or XML before the integration route is decided (Open decisions).
9. **Mobile-first.** Field staff, attendance and tasks are used from phones (OPS §7, HR §3.4, EP §17). The API is designed so a mobile app can be built later without backend rewrites.
10. **Configurable where the specs ask for it.** KPIs, targets, fields in analysis forms, statuses lists, impact factors, reward policies and approval limits come from config or admin screens, not hard-coded constants (MKT §4, §12, §15.9, HR §7.11, SUS §11, CS §6.2).
11. **Ask when the spec is silent or two specs disagree.** See "Open decisions". Don't invent limits, prices, statuses or categories.

## Language and locale
- Talk to the user in Arabic. Code, identifiers and commit messages in English.
- UI is Arabic-first and right-to-left: `<html lang="ar" dir="rtl">`, all copy in `ar` translation files (no hard-coded strings), Tailwind logical utilities (`ms-*`, `me-*`, `ps-*`, `start-*`).
- Calendars show Gregorian and Hijri with a toggle (EP §13, EP §17.4). Store dates as UTC Gregorian; render Hijri with `Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', …)`.
- Time zone Asia/Riyadh. Weekend is Friday–Saturday.
- Currency SAR, VAT 15%. Money as integer halalas; weights as integer kilograms; convert only for display.
- Normalize Arabic for search (أ إ آ → ا, ة → ه, ى → ي, strip tashkeel).

## Stack (defaults — change only after asking)
| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Frontend | React + Vite, React Router, TanStack Query, react-hook-form + zod, Tailwind, react-i18next, Recharts |
| Backend | Express, Mongoose, zod validation |
| Runtime | AWS Lambda + API Gateway via Serverless Framework; Express wrapped with `serverless-http` |
| Database | MongoDB Atlas |
| Files | S3 with presigned upload/download URLs |
| Async work | Scheduled Lambdas for time-based jobs; an outbox worker for domain events |
| Email | Amazon SES for system mail; employee mailboxes per Open decisions |
| PDF | HTML templates rendered with headless Chromium (correct Arabic shaping) in a dedicated function |
| QR | QR generation server-side; camera scanning in the browser for containers (OPS §2.3) |
| Tests | Vitest, Supertest, mongodb-memory-server |

## Architecture: modular monolith
- Each module in `apps/api/src/modules/<module>/` owns its collections. **Only the owning module writes them.** Other modules call its service functions or react to its events. No cross-module model imports.
- **Domain events** (e.g. `ops.visit.completed`, `procurement.request.approved`) are written to an `outbox` collection in the same transaction as the change; a worker delivers them to subscribers (notifications, other modules). A cross-department hand-off must never be lost because one step failed.
- Start with one API Lambda. Run heavy or slow work in separate functions: PDF, exports, scheduled jobs, inbound webhooks (WhatsApp, email).
- **Two user realms:** staff (employees) and external (customer app users, company portal). Separate auth and routes: `/api/v1/*` for staff, `/api/portal/*` for external. External responses come from dedicated DTOs and never include internal notes, internal discounts or other departments' discussions (SAL §7.3, CS §6.6).

### Repo layout
```
apps/
  web/                          # staff web app (React)
    src/modules/<module>/       # pages, components, hooks per module
    src/shared/                 # layout, RTL components, calendar, kanban, export dialog, KPI widgets, file uploader
    src/locales/ar/
  api/
    src/core/                   # auth, rbac, audit, files, numbering, workflow, outbox/events, notifications,
                                # calendar, tasks, kpi, export, documents, templates, comments, tags, dates
    src/modules/
      hr/ portal/ crm/ sales/ cs/ ops/ procurement/ finance/ marketing/ sustainability/ it/
    src/handlers/               # lambda entry points: api, pdf, export, jobs, outbox, webhooks
packages/
  shared/                       # zod schemas, enums, permission matrix, workflow configs, KPI definitions, types
docs/SPECS.md                   # all department specs (source of truth)
docs/specs/originals/*.pdf      # original PDFs, reference only
serverless.yml
```
`crm` is a shared module (customers, contacts, leads, communication logs) used by Sales, CS, Operations and Sustainability.

Inside a module: `model.ts`, `schema.ts` (zod), `service.ts` (business logic), `routes.ts` (parse, authorize, call service), `events.ts`, `*.test.ts`.

## Commands (create these scripts in Phase 0)
```bash
npm install
npm run dev          # api (localhost:4000) + web (localhost:5173)
npm run test
npm run lint
npm run typecheck
npx serverless deploy --stage staging
```
Never deploy to `prod` from a local machine.

## Serverless rules
- Reuse the Mongo connection across invocations: connect once outside the handler, cache the promise, small `maxPoolSize`.
- Files go from the browser straight to S3 with presigned URLs, never through Lambda.
- Keep API handlers fast; PDFs, Excel exports and bulk jobs run in their own functions with their own memory and timeout.
- Webhooks verify signatures, store the raw payload, are idempotent, and hand off to the outbox.
- Secrets in SSM Parameter Store / Secrets Manager. No `.env` files committed.

## Platform core (build once, reuse in every module)
| Capability | What it does | Specs |
|---|---|---|
| Auth | Login page with the cooperative's logo; password reset and change; clear message on wrong credentials; hashed passwords; login/logout log; active sessions with revoke; optional second factor; account disabled at end of service | EP §3, HR §3.10 |
| Org structure | Departments, units, branches and operating sites (with geofence), positions, direct-manager chain | HR §3.1 |
| Parties | One master for outside organizations: legal name, role (عميل / مورد / كليهما), unified number or CR, VAT number, national address, email, phone, bank details, documents (CR, VAT certificate, IBAN), status نشطة / غير نشطة. Blocks duplicates. Tax and bank fields are edited by Finance only | FIN §8 |
| RBAC | Permission = resource × action (view, create, edit, approve, delete, export) × scope (own, team, department, all), plus field-level rules for sensitive fields. "Direct manager" and "team" come from the org chart, not from a role | HR §6, EP §16, MKT §15.8, SAL §15 |
| Audit | Every write with before/after; views/downloads/sends of sensitive data | all |
| Files | S3 presigned; several attachments per record (PDF, Excel, images); in-app preview before download; document versions with uploader and time; electronic archive | MKT §7.1, FIN §13 |
| Numbering | `PREFIX-YYYY-#####` per document type from an atomic counter | all |
| Workflow engine | Config per request type: states (each with a category: open / waiting / done / cancelled), transitions (roles, conditions, required fields), SLA in business days, notifications, stage log with delay reason, reopen rules | SAL §6, HR §3.5, EP §9.4, PRC §4–6, MKT §8.2, §10.2, CS §6.7, OPS §2.1 |
| Notifications | In-app center (history, read/unread) + email; push and WhatsApp later | EP §15 and every module |
| Calendar | One events store; day/week/month views; colors by type/status; filters by department, region, employee; shared calendars across departments; Gregorian/Hijri; reminders; links to customer/project/task | EP §13, OPS §3, MKT §9, §11, SAL §9, SUS §8 |
| Tasks | One tasks store with a link to its source record; assigner, assignee, priority, start/due, status, comments, attachments; reminders before due and on overdue. "My Tasks" aggregates every module | EP §10, MKT §11, SAL §5.6, IT §7.2 |
| KPI framework | KPI definitions (computed or manual, unit, period, higher/lower is better); targets per period and scope (versioned, with reason and editor); actuals with source (computed / manual / imported, plus timestamp); status achieved / below / exceeded; pace vs elapsed time; drill-down to records | all KPI sections, SAL §11, MKT §12–13 |
| Export builder | Choose fields (from a permission-filtered allow-list), filters, preview, Excel/PDF | HR §4, SAL §12, all report sections |
| Documents & expiry | Typed documents with issue/expiry dates and alert offsets | HR §3.9, EP §5.2, §6, IT §7.4, SAL §6.3 |
| Templates & certificates | HTML → PDF templates auto-filled from data, numbered, with an issue/send log | HR §3.5, SAL §6.3, CS §6.2, SUS §6.2 |
| Comments | Threads on any record, mentions, attachments, department routing | SAL §10.3, EP §9.5 |
| Tags | Tags on records, managed by department managers | SAL §10.4 |
| Business days | Fri–Sat weekend + `holidays` collection; used by every SLA | SAL §6.1, SUS §6.2 |
| Drafts | Any long form can be saved as a draft and completed later | HR §3.2, HR §7.5 |

## Cross-department hand-offs
Each row is a workflow config plus domain events. The receiving department sees the item in its queue immediately and is notified (SAL §19).

| Flow | Route | Specs |
|---|---|---|
| Sales service request | Sales → Procurement (if supply needed) → Finance → Procurement (execution) → Operations → closed | SAL §6 |
| Purchase request | Requesting dept (managers only) → Procurement (quotes, comparison, recommendation) → Finance → Procurement (supply, receipt) → Finance (supplier invoice, payment), same number throughout | PRC §2–6, MKT §10, EP §9.1, FIN §11 |
| Department financial request | Dept manager (single invoice or weekly/monthly batch) → Finance review → approver → payment → archive | FIN §3–5, §15 |
| Expense request | Marketing (or any dept) → Finance → disbursement | MKT §8, FIN §3 |
| Customer invoicing | Approved sales order / contract → Finance issues the invoice → e-invoicing → collection status visible to Sales | SAL §7.3, FIN §7 |
| HR self-service request | Employee → direct manager → HR → final approval (by type) | HR §3.5 |
| Employee ticket | Employee → target department → assignee → requester confirms close or reopens | EP §9 |
| Customer Service transfer | CS → Sales / Sustainability / Operations / Finance / IT / Marketing → result back to CS → CS informs the customer and closes | CS §6.7 |
| Lead | Any channel → CS → Sales or Sustainability → outcome reported back | CS §6.8, SAL §3 |
| Operations request | Sales / Sustainability / Procurement / CS → Operations (review, schedule, execute) → source dept and Finance notified | OPS §2.1, §4 |
| Scrap deal | Sales ⇄ Operations on one shared record | SAL §5.6, OPS §2.2 |
| Initiative | Sustainability → Operations (visit, weights, photos) → Sustainability (quantities, revenue, certificate) | SUS §6.2 |
| Container request from an initiative | Sustainability → Sales follow-up | SUS §6.2 |
| Event needing Marketing | Sales calendar event → Marketing notice | SAL §9 |
| Weights to impact | Operations weights form + daily receipts → Sustainability reports | SUS §10–11 |
| Supplier delivery of containers/equipment | Procurement → Operations inventory | OPS §4 |
| Payroll, allowances, advances, employee claims | HR → Finance | HR §3.6, FIN §11 |
| End of service | HR → IT (accounts, assets) and custody return | HR §3.10 |
| Inactive app customers | CS → Marketing reactivation campaign | CS §6.2 |

## Roles
Most departments have **Manager** and **Staff**; Operations adds **Field staff**. Cross-cutting: **Executive management** (read KPIs/reports, approve above limits), **Direct manager** (derived from the `directManager` field on the employee record, never a role), **Department manager** (a role scoped to one department; not automatically anyone's direct manager — DECISIONS §4), **System admin** (IT; manages settings, users and integrations but has no financial approval right — FIN §12). Department-specific rights:

| Department | Notable rights and limits |
|---|---|
| HR | HR officer manages files, attendance, requests, contracts; HR manager approves; salary data restricted (HR §6) |
| Finance | Dept manager raises requests and tracks own dept; authorized employee uploads documents and answers completion requests; Finance staff review and record; Finance manager approves within limits; executive approves above them (FIN §12). Only Finance edits financial figures. Salaries and bank accounts visible only to authorized users |
| Sales | Rep sees own customers only; manager sees all, assigns and transfers, approves within limit; executive approves above it (SAL §15) |
| Customer Service | Agent handles conversations and transfers; manager manages agents, transfers, reports (CS §6.12) |
| Operations | Field staff see only their assigned tasks and record visits, photos, weights, location; other departments create requests and track status but can't edit approved operational data (OPS §7) |
| Procurement | Other departments view status only and can't edit quotes or approve financially (MKT §10) |
| Marketing / Sustainability / IT | Staff and manager per their specs (MKT §14, SUS §13, IT) |
| News publishing | Each department publishes news in its own category, per EP §12.1 |

## Modules

### HR — foundation [HR]
Everything hangs on the org chart and employee records, so HR comes first (HR §8).
- **Collections:** departments, units, branches/sites, positions, employees (job history, status history), contracts, employeeDocuments, custody (links to IT assets), jobRequisitions, applicants, interviews, offers, shifts, shiftAssignments, attendance, attendanceCorrections, hrRequests, payrollRuns, payslips, advances, goals, appraisals, improvementPlans, disciplinaryActions, promotions, trainingPlans, trainings, offboardings.
- **Employee status:** على رأس العمل / إجازة / عمل ميداني / انتداب / موقوف / مستقيل / منتهي الخدمة (merged from HR §3.1 and EP §5.3; confirmed in DECISIONS §6). Field work counts as on duty. Account status: نشط / غير نشط.
- **Recruitment** (HR §3.2): requisition → approval → posting → applications → screening → interviews → offer → acceptance → contracting → registration in Qiwa/GOSI (manual record first).
- **Attendance** (HR §3.4): shifts and schedules incl. field and shift work; check-in/out records time and GPS; geofence per site; block outside the geofence unless an approved exception; **location is captured only at check-in/out, never tracked otherwise**; lateness, absence, actual hours, overtime; alerts for missed check-in/out; correction requests with approval; daily and monthly reports.
- **Self-service requests** (HR §3.5): leave, permission, remote work, salary certificate (detailed or not, Chamber attestation flag), experience certificate (from template), advance, data update, official letter. States: جديد / قيد المراجعة / بانتظار موافقة المدير / بانتظار الموارد البشرية / بانتظار الاعتماد النهائي / يحتاج استكمال / معتمد / مرفوض / مغلق.
- **Payroll** (HR §3.6): basic, allowances, deductions per policy and Saudi Labor Law, linked to attendance and approved overtime, review then send to Finance, full history, restricted access.
- **Performance and training** (HR §3.7–3.8): goals linked to department KPIs, semi-annual and annual appraisals, improvement plans, warnings, promotions (notify employee), annual training plan, needs per department, certificates.
- **Contracts and documents** (HR §3.9): expiry alerts for contracts, IDs and iqamas.
- **End of service** (HR §3.10): request → reason/date → approval → final settlement → custody return → close accounts → exit interview → experience certificate → status terminated → keep file.
- **Exports** (HR §4): field-picker export via the core export builder.
- **Dashboard** (HR §5): headcount by department/branch/nationality/type, attendance exceptions, expiring documents, request queues, appraisal completion, trainings, promotions.

### Employee Portal [EP]
- **Entry point** (EP §3–4): login, then a role-dependent dashboard: profile, contract, financial details, requests and tickets, tasks, calendar, reports, news, notifications.
- **Profile** (EP §5–8) is a view on the HR employee record, never a copy. Field-level edit rights: the employee edits contact info, national address, bank details and photo (some need HR/Finance approval); HR edits official data. Every change is logged.
- **Sensitive fields** (identity number, religion, salary, allowances, advances, IBAN): visible only to the employee and authorized HR/Finance users; encrypted at rest at field level.
- Birthday notification and dashboard greeting; ID/iqama expiry, probation end and contract end alerts.
- **Secondment** (EP §5.3): period and destination, report upload after the mission notifies the direct manager, full history.
- **Tickets** (EP §9): target department list; **Procurement and Finance targets are shown only to department managers**; types طلب / شكوى / حل مشكلة / استفسار / طلب دعم; priority; states جديدة / قيد المراجعة / قيد المعالجة / بانتظار معلومات من الموظف / تم الحل / بانتظار تأكيد مقدم الطلب / مغلقة / معاد فتحها. **Only the requester closes a ticket**; the department can't close it finally; the requester can reopen.
- **My Tasks** (EP §10): open tasks, follow-ups due, meetings, assigned opportunities and projects, trainings.
- **"رفع طلب" button** (EP §11): opens the HR self-service requests, routed to HR or the direct manager by request type, with status tracking and history.
- **News** (EP §12): per-department publishing rights, approval, pin, target audience (all or one department), publish window, archive, notify on publish.
- **Employee reports** (EP §14): auto number and date, sent to the direct manager, manager notes, export PDF/Excel, search by employee/period/type.
- **Notification center** (EP §15): all 18 types listed there.

### CRM core — shared [SAL §4, CS §6.2–6.3, §6.6, §6.8]
- **customers**: kind (individual / organization); an organization links to its party record for legal, tax and bank data (FIN §8); organization type, region, city, activity, size, source, status, classification (استراتيجي / منتظم / عرضي), owner, tags, app account link, company-portal account link.
- **contacts**: max 3 per organization (SAL §4.1): name, job title, phone, email, notes.
- **leads**: type, interest, source, assigned department (Sales or Sustainability), assignee, outcome. States: جديد / تم التواصل / محال للقسم المختص / قيد المتابعة / فرصة قائمة / تم تحويله إلى عميل / غير مهتم / مغلق (CS §6.8). Sales must register a referred lead within 24 h (SAL §3).
- **communicationLogs** (append-only): method, details, outcome, need, next step, next follow-up, attachments, author, time (SAL §4.1, §10.2).
- **Customer 360**: requests, visits, weights, contracts, last invoice, certificates, complaints. What each role may see or share is configured per field (CS §6.6).

### Sales [SAL]
- **Opportunities** (SAL §4.1–4.2): stages جديدة / قيد المعالجة / تم التواصل / جدولة اجتماع / عرض سعر مرسل / قيد التفاوض / ناجحة / خاسرة; lost reason required; expected value; Kanban and table views. Customer status is separate: عميل نشط / محتمل / غير مهتم / متعاون / متوقف عن التعامل.
- **Service requests** (SAL §5) — one collection with a discriminator per type:

| Type | Arabic | Prefix | Spec |
|---|---|---|---|
| containerSale | بيع حاويات | CSR | §5.1 |
| sortingContract | عقد فرز | SRT | §5.2 |
| cleaningContract | عقد نظافة | CLN | §5.3 |
| destruction | إتلاف | DST | §5.4 |
| containerRental | تأجير حاويات (inspections before delivery / after delivery / after pickup with photos, time, employee, signature, condition) | RNT | §5.5 |
| scrap | سكراب (shared record with Operations; tasks with done/not done and transfer status) | SCR | §5.6 |
| assetReturn | رجيع أصول / مناقصات (cooperation status, reason when not cooperated) | ARO | §5.7 |

- Routes per type in workflow config; not every type passes every stage (rental goes straight to Operations; destruction goes through an Operations assessment first). Closing outcomes: closed successfully / closed incomplete / suspended / cancelled (SAL §6.2). Operations schedules within 3 business days.
- **Pricing** (SAL §7.1–7.2): items (materials per ton, services), append-only price entries with valid-from, weekly market prices, discount limits per role with escalation to the executive, approver recorded.
- **Quotes → orders → invoices** (SAL §3, §7.3): Finance issues the invoice from the approved order or contract without re-entry (FIN §7); Sales sees invoice and collection status read-only. Customer-facing documents show the final net price only, never internal discounts or previous prices.
- **Contracts** (SAL §6.3, §7.4): schedule, quantities, signed file, alert 90 days before end, cooperation certificate with issue log.
- **Targets** (SAL §11): monthly per rep and department, by service/material; every edit is a new version with reason and editor.
- **KPIs**: revenue, tons sold per material, quote conversion (target 40%), average price per ton vs market, average collection days (target ≤ 45).
- Calendar with meeting statuses مجدول / تم / لم يتم / إعادة جدولة / ملغي (SAL §9); internal discussions with states جديدة / قيد المعالجة / بانتظار الرد / تم الحل / مغلقة (SAL §10.3); manager dashboard with read-only budget figures (SAL §8.3).

### Customer Service [CS]
- **Individual app customers** (CS §6.2): registration with phone verification, address and map location; collection request (material, estimated quantity, preferred time) auto-routed to the nearest rep or collection route by coverage; pickup with weighing and photos; points/rewards calculated by a configurable policy; recycling and environmental-impact certificates issued automatically when criteria are met; service rating; alert for customers inactive more than 60 days and reactivation campaigns with Marketing.
- **Organization customers** (CS §6.3): contracts (by permission), requests and visits, shareable invoices/certificates/reports, weights collected, complaints, and a company portal account (external realm).
- **Unified inbox** (CS §6.4–6.5): WhatsApp Business, Instagram, X, Snapchat, official email, unified phone number, app, website. Link to an existing customer or create one, assign to agents, attachments, reply and email from inside, call logging (summary, outcome, follow-up), source channel recorded. Official integrations only.
  - Conversation types: شكوى / اقتراح / استفسار / طلب خدمة / متابعة طلب سابق / طلب فاتورة أو عقد أو تقرير / عميل محتمل / غير مصنف. Priority: عالية / متوسطة / منخفضة. States: جديد / قيد المعالجة / بانتظار رد / محال لقسم آخر / مكتمل / مغلق. Resolution and customer rating on close.
- **Data sharing** (CS §6.6): CS sees only pre-approved fields; financial data and contracts need specific rights; views, downloads and sends are logged; internal notes are never shown to customers.
- **Transfers** (CS §6.7): Sales (prices, contracts, services, leads) · Sustainability (initiatives, partnerships, impact certificates) · Operations (late pickups, visits, containers, receipts) · Finance (invoices, payments, dues) · IT (app issues, accounts, login) · Marketing (campaigns, media). Each transfer has priority, description, attachments, follow-up owner, target date, status and result.
- **KPIs** (CS §6.10–6.11): response time, resolution time, closed within target, satisfaction, new customers, leads transferred and converted, reactivated customers, repeated complaints, first-time-right routing.

### Operations [OPS]
- **Request intake** (OPS §2.1) from Sales, Sustainability, Procurement and CS. States: جديد / قيد المراجعة / مجدول / قيد التنفيذ / مكتمل / مؤجل / ملغي / مرفوض (reason required).
- **Scrap** (OPS §2.2): visit → material, estimated quantity and weight → photos and inspection report → agreed price with Sales → schedule pickup → actual weight and receipt report → notify Sales and Finance.
- **Container registry** (OPS §2.3): number + QR code, type (Eayni clothing containers, waste containers, more types configurable), size/capacity, current location, status متاحة / محجوزة / تم تسليمها / تحت الصيانة / غير صالحة, holder and location, delivery/return dates, photos and condition notes. Movements are append-only.
- **Vehicles**: number, type, suitable services, capacity, branch, regions/cities served, status متاحة / في مهمة / تحت الصيانة / غير متاحة, driver, bookings.
- **Availability search**: by region, city, address, container type and count, vehicle type, date; also shows resources in other regions that could be moved.
- **Delivery flow**: receive → define type/count/location → check availability → assign container, vehicle and employee → schedule and notify source dept → photo proof and receipt confirmation → update container location/status → on return, record date, condition and storage location.
- **Field visits** (OPS §2.4): states مجدولة / تم تأكيدها / قيد التنفيذ / تمت / لم تتم / مؤجلة / ملغاة (reason required); location, before/after photos, materials and weights, notes; result notifies the requesting dept.
- **Operational calendar** (OPS §3): all tasks, visits, deliveries and pickups; filters by dept/region/employee; colors by type; late and done.
- **Weights form for Sustainability** ("أوزان الجمعيات والمبادرات") and a daily receipts report (SUS §10).
- **Field-staff phone UX**: today's tasks, map link, camera upload, weight entry, location capture.
- **Dashboard and reports** (OPS §5–6): incoming / new / pending / late / completed requests, visits scheduled vs done, pickups, weights by material, containers available / in use / in maintenance, vehicles available / busy, distribution by region and city, team performance. Reports by department, status, visits, weights, container stock and movement, vehicles, scrap, delays and reasons; filters by period, region, city, service, employee.

### Procurement [PRC]
- **Purchase requests** (PRC §2): requesting dept and employee, type (أجهزة / أدوات / مواد تشغيلية / خدمات / صيانة / أخرى), description, quantity, need date, priority (عاجل / متوسط / منخفض), attachments, estimated budget.
- **Suppliers and quotes** (PRC §3): suppliers are parties with the supplier role (shared with IT vendor contracts), RFQs, quotes (value, delivery time, validity), comparison, recommendation.
- **To Finance** (PRC §4): states بانتظار اعتماد المالية / معتمد / مرفوض (reason) / يحتاج استكمال بيانات.
- **Supply and receipt** (PRC §5): expected vs actual date, quantity requested vs received, receipt report or supplier invoice; states بانتظار التوريد / قيد التوريد / تم الاستلام / استلام جزئي / متأخر / ملغي. Containers/equipment received update the Operations registry.
- **Supplier invoices to Finance** (PRC §6): states جديدة / بانتظار المراجعة / معتمدة / مرفوضة / تم الصرف.
- Marketing tickets use the states in MKT §10.2.
- **KPIs** (PRC §8): processing time, on-time requests, supplier on-time delivery, late count, fully received rate, finance approval time.
- **Dashboard** (PRC §7): total, new and pending requests, awaiting Finance, approved and rejected, not yet supplied, complete and partial receipts, total value, invoices sent to Finance.

### Finance [FIN]
- **Dashboard** (FIN §2), live for the Finance manager: incoming invoices, awaiting review, incomplete, approved, awaiting payment, paid, total revenue, total expenses, receivables and payables, weekly / monthly / yearly reports.
- **Department financial request** (FIN §3), "طلب مالي جديد", raised by department managers (EP §9.1): auto number, department, requester, type (فاتورة مورد / مصروف تشغيلي / عهدة / تعويض / اشتراك / أخرى), supplier, supplier invoice number and date, due date, description, amount before VAT, VAT rate, VAT amount, total, project or contract, cost center, attachments (invoice, quote, PO, receipt report…), priority (عادي / عاجل / عاجل جداً), notes. **Managers never enter accounting details**; Finance completes the classification.
- **Single invoice or batch statement** (FIN §4): a batch has period (weekly / monthly), from/to, department, uploader, invoice count and total (computed), statement file, state مسودة / مرسل / تحت المراجعة / مكتمل. Finance sees invoices by department and period, which departments submitted and which didn't, and a configurable monthly cut-off date.
- **Duplicate prevention** (FIN §4, §13): block the same supplier + invoice number; warn on the same supplier + amount.
- **Review states** (FIN §5): مسودة / مرسل للمالية / تحت المراجعة / يحتاج استكمال / بانتظار الاعتماد / معتمد / مرفوض (reason) / بانتظار السداد / مدفوع / مغلق. Every action logs actor, time and notes. These are the canonical Finance-stage states; other modules show their own labels mapped to them (PRC §4, MKT §8).
- **Expenses** (FIN §6): auto number, date, type (تشغيلي / إداري / تسويقي / صيانة / رواتب / أخرى), department, supplier, project, amount, payment method (تحويل بنكي / بطاقة / نقدي / أخرى), payment state (غير مدفوع / مدفوع جزئياً / مدفوع), payment proof.
- **Payments** (FIN §6): required, paid, remaining, actual payment date, transfer proof, overdue list, search by supplier / invoice number / department. Every payment links to its original invoice so nothing is paid twice.
- **Revenue and collection** (FIN §7): customer and customer number, contract or project, service (بيع مواد / عقد نظافة / فرز / إتلاف / تأجير حاويات / أخرى), invoice date, amount before VAT, VAT, total, due date, collected, remaining, state مستحق / محصل جزئياً / محصل بالكامل / متأخر.
- **Customer invoices** (FIN §7): generated from Sales orders and contracts without re-entry. Content: logo and official data, legal name, VAT number, national address, invoice number and issue date, customer data and VAT number if registered, description, quantity, unit price, subtotal, VAT rate and amount, total, payment and due details, QR and technical data per invoice type. Output: PDF, print, Excel register, email to the customer. Credit and debit notes by permission and regulation. Archived copy and issue log.
- **ZATCA readiness** (FIN §10), stored on every invoice from day one: invoice type (tax / simplified), issue date and time, sequential number, UUID, tax category per line, QR, XML, integration state (بانتظار الإرسال / تم الإرسال / مقبول / مرفوض), ZATCA response and error message. Future flow: build from the transaction → validate → generate the required format → send to Fatoora via API → store the result → show state and handle errors → keep invoice, data and submission log. Requirements differ between tax and simplified invoices and depend on ZATCA waves; follow the official guides linked in FIN §10.
- **Inputs from other departments** (FIN §11): Sales (orders, contracts, invoices, collection) · Procurement (approved POs, quotes, supplier invoices, receipt reports) · HR (payroll, allowances, advances, dues, employee claims) · Operations (operating expenses, maintenance, fuel, operational purchases) · Marketing (campaign budgets, ad invoices, influencers, project expenses) · Sustainability (initiative expenses, grants, donations and related revenue) · IT (subscriptions, devices, maintenance, vendor contracts).
- **Budgets**: per department / cost center with spent and remaining, shown read-only on other departments' dashboards (SAL §8.3, MKT §8.2).
- **Alerts** (FIN §13): new invoice, completion requested, before due date, after overdue.
- **Reports** (FIN §9): revenue, expenses, incoming invoices, outgoing invoices, payments, collection, VAT, suppliers, departments, projects, monthly, annual. Filters by date, department, project, supplier, customer; Excel and PDF.
- **Phases** (FIN §16): 1 — financial request form, review and approval, expenses and payments, archive, basic reports. 2 — revenue and collection, customer invoicing, links to Sales / contracts / Procurement, advanced reports. 3 — ZATCA integration and e-invoicing automation. The spec's own advice: start with three screens (department request, Finance review, reports) and keep it easy for department managers.

### Marketing [MKT]
- **Projects are the core unit** (MKT closing note): each project links its plan, campaigns, platforms, budget, tasks, procurement tickets, contracts, reports and KPIs.
- **Project fields** (MKT §7.1): name, logo, profile file, operating plan, strategy, active platforms (several), account access (**never stored in plain text** — OAuth or encrypted secrets), collaboration and influencer contracts (several), official documents, reports, owner, dates. States: مخطط / قيد التنفيذ / متوقف / مكتمل / ملغي.
- **Plans and content** (MKT §2): annual plan and monthly content calendar approved by top management; target segments (families, residential compounds, schools and universities, restaurants, companies and factories); material approval before publishing for brand compliance; campaign report within 7 days of campaign end.
- **Campaign tracking** (MKT-01): a tracking link or promo code per campaign to attribute downloads, sign-ups and orders.
- **Content counts per platform**: posts, photos, videos and reels recorded separately per platform, not just a total (MKT §4 note).
- **Expenses** (MKT §8): states جديد / بانتظار اعتماد المالية / معتمد / مرفوض / قيد الصرف / تم الصرف / ملغي; monthly report vs approved budget.
- **Procurement tickets** (MKT §10): states جديد / قيد المراجعة / بانتظار اعتماد المالية / معتمد / قيد التنفيذ / قيد المعالجة / تم التسليم / مرفوض / ملغي; Marketing confirms receipt.
- **Shared calendar** with Sales and Sustainability (MKT §9): event, type, responsible and participating depts, location, prep requirements, prep start date, prep status, reminders.
- **Task calendar** (MKT §11): states جديدة / قيد التنفيذ / بانتظار المراجعة / مكتملة / متأخرة / ملغاة; colors red = late, orange = high priority, blue = in progress, green = done, grey = not started.
- **Per-project analysis builder** (MKT §12): manager picks metrics per project (posts, photos, videos, reels, views, likes, comments, shares, saves, visits, additions, leads, customers from promotion, top regions, notes), adds new metrics, sets monthly targets, records actuals per platform and campaign; manual and imported numbers are kept apart with source and timestamp.
- **KPIs** (MKT §4): CAC, new downloads, download → first order (≥ 30%), engagement rate (≥ 3%), B2B leads to Sales, content plan adherence, content counts by type.
- **Dashboard** (MKT §13): target vs actual, status achieved / below / exceeded, pace vs schedule, drill-down to project/campaign.
- Later: targeted notifications by segment (MKT-02), brand guide and asset library (MKT-03), referral program in the app (MKT-05), content scheduling and publishing (MKT-06). Phases in MKT §16.

### Sustainability & Partnerships [SUS]
- **Initiatives** (SUS §6): beneficiary entity, contact person and numbers, location link and region, material types, optional vehicle request, visit date and the entity's working hours, attachments. Flow: create → notify Operations → visit scheduled → Operations uploads photos and weights on the same record → quantities and revenue visible to Sustainability → state تم الإنجاز بنجاح. Certificate for the entity when the weight criterion is met. A container request from the entity creates a Sales follow-up.
- **Free destruction requests** (SUS §9): entity and contacts, material type and estimated quantity, location, requested pickup date, attachments, status (**no serial-number field**); routed to Operations.
- **CSR free-container requests** (SUS §7): **future feature, not active now** — design for it, don't build it yet.
- **Weights and impact** (SUS §10–11): Operations weights form and daily report flow in automatically; monthly totals by material; impact = tons × impact factor, factors editable by authorized users and documented with source and unit.
- **Partnerships** (SUS §2.2): prospects, feasibility, MoUs and agreements for approval, owner and action plan per partnership, review every 6 months, grants and funding applications.
- **Volunteering** (SUS §12): opportunities are registered on the national volunteering platform; here we track idea, platform, dates, target vs actual volunteers, linked departments, status, expenses, photos, region, results.
- **KPIs** (SUS §3): tons diverted from landfill, CO₂e avoided, active partnerships, grants value, awareness beneficiaries. Annual sustainability report.

### IT [IT]
- **Support tickets** (IT §7.1): employee tickets routed to IT plus IT fields: type (عطل / صلاحية / جهاز / شبكة / برنامج), priority (عاجل / مرتفع / متوسط / منخفض), created time, processing start time, IT states جديد / قيد التنفيذ / مكتمل / متعثر, service rating after resolution. Closure follows the portal rule (requester confirms).
- **IT projects** (IT §7.2): name, description, manager, start and due dates, budget, % complete, tasks, blockers, risks, deliverables, management approval. Project health answers: on schedule? late tasks? missing requirements? tested before launch? delivered and approved?
- **Assets** (IT §7.3): asset number, type (computer, laptop, printer, screen, more configurable), serial, assigned employee (this is the employee's custody record), location/branch, received date, warranty start/end, status يعمل / يحتاج صيانة / تالف, maintenance log, cost, subscriptions with their budget per device.
- **Vendors and contracts** (IT §7.4): supplier, service (استضافة / تطوير / صيانة), contact, value, start/end, response time, status ساري / منتهي / يحتاج تجديد, rating.
- **Networks and infrastructure** (IT §7.6): per branch/site: internet, routers, Wi-Fi points, cameras (if IT-owned), servers and hosting, site systems, outages, internet and maintenance contracts.
- **KPIs**: ticket closure rate, average resolution time, late tickets, recurring faults, project completion, system availability, security vulnerability closure, employee satisfaction, preventive maintenance.
- **Dashboard** (IT §7.5): support, assets, systems, projects, networks, security and access (backups, incidents), vendors and contracts, reports.

## Dashboards
Every department has its dashboard (sections listed per module); every card drills down to the records behind it. An executive dashboard aggregates department KPIs read-only.

## Integrations
Each one sits behind an adapter interface. Manual entry must work first; the integration fills the same fields later.

| Integration | Specs |
|---|---|
| ZATCA Fatoora platform (direct API or certified provider — see Open decisions) | SAL §7.3, FIN §10 |
| Email send/receive linked to records (employee mailboxes, department mailboxes) | SAL §10.1, CS §6.9 |
| WhatsApp Business (official API) | CS §6.4 |
| Instagram, X, Snapchat | CS §6.4, MKT §15.10 |
| Unified phone number / call logging | CS §6.4, §6.9 |
| Customer mobile app (collection requests, points, referrals, targeted notifications) | CS §6.2, MKT-02, MKT-05 |
| App stores and marketing analytics | MKT-01, MKT §15.10 |
| Qiwa and GOSI | HR §3.2, §7.12 |
| Maps and geocoding | OPS §7, HR §3.4 |

## Build order (confirmed 2026-11-04; Sales moved ahead of attendance 2026-11-12 — see DECISIONS §7)
- [x] Phase 0 (done 2026-11-04): platform core, local dev setup, CI; deploy pipeline written but not run (DECISIONS §1)
- [x] Phase 1 (done 2026-11-08, go-live review fixed — DECISIONS §19): HR foundation (org chart, employees, users, roles, contracts and documents, salary data entry) + Employee Portal (login, dashboard, profile, HR requests, tickets, tasks, calendar, reports, news, notifications)
- [ ] **Phase S: Sales [SAL], complete, in the five SAL §17 phases (S1–S5)** — S1–S3 merged; S4 on branch `sales-s4` (2026-11-13) and S5 on `sales-s5` (2026-11-14), awaiting review — plan and questions in `docs/SALES_PLAN.md`, coverage in `docs/SALES_COVERAGE.md`, prompt in `docs/prompts/sales.md`. Includes the shared pieces Sales needs (CRM core, minimal party master FIN §8, tags, KPI framework, department discussions, email adapter) and thin hand-off stages for Procurement, Finance and Operations on the same Sales record; the full PRC/FIN/OPS/CS/MKT modules are not built here
- [ ] Phase 2: HR attendance (shifts, GPS check-in/out with geofence, corrections, lateness/overtime per settings, reports) — HR §8 "التشغيل اليومي"
- [ ] Phase 3: Customer Service (conversations entered manually, transfers, leads inbox) on the CRM core from phase S
- [ ] Phase 4: Finance phase 1 (department financial requests, review and approval, expenses and payments, archive, basic reports) + Procurement + Operations (intake, containers, vehicles, visits, calendar) — each takes over its thin Sales stage on the same record
- [ ] Phase 5: Finance phase 2 (revenue, collection, customer invoices) + Sustainability + Marketing phases 1–2 + IT
- [ ] Phase 6: HR payroll, performance, training, recruitment, end of service + Marketing phase 3 + CS app customers and company portal
- [ ] Phase 7: Finance phase 3 (ZATCA integration; earlier if the cooperative's wave requires it), channel integrations, Qiwa/GOSI, mobile app APIs, Marketing phase 4

Finish a phase, demo it to the user (on staging once DECISIONS §1 is cleared), then start the next.

## Definition of done (every feature)
- Typecheck, lint and tests pass. API tests cover each validation, each workflow transition, and each role's allowed and forbidden actions
- All copy in the Arabic translation files; screens checked in RTL at desktop and phone widths
- Writes produce audit entries; history collections stay append-only
- Notifications fire for every hand-off the spec lists
- Spec code and section cited in the commit message
- Deployed and checked on staging

## Open decisions (ask, don't assume)
Settled items live in `docs/DECISIONS.md`. Still open:
- **Accounting depth:** FIN covers requests, approvals, payments, revenue and invoicing, but no chart of accounts or journal entries. Does a general ledger stay in an existing accounting system (e.g. the current ERPNext) fed by this system, or is it built later?
- **ZATCA route:** direct Fatoora integration or a certified solution provider, and whether the cooperative is already in a mandatory wave (FIN §10)
- **Financial authority matrix:** approval limits per role and amount (FIN §12); monthly cut-off date (FIN §4); advance limit (DECISIONS §5)
- **Customer app:** does it exist already, and is this backend replacing or integrating with it? (CS §6.2, MKT-02, MKT-05)
- **Company portal:** scope and timing (CS §6.3)
- Serverless platform (AWS Lambda assumed), hosting region and data-residency requirements; MongoDB Atlas; staging and email domains; brand assets (DECISIONS §1 "Pending before staging")
- SSO provider (email + password now; TOTP settled — DECISIONS §2)
- Email, telephony and WhatsApp providers; maps provider
- Branches and operating sites; employee import from ERPNext (DECISIONS §3)
- Offline support for field staff
- Policies with no numbers in the specs: discount limits (SAL §7.2), points/rewards (CS §6.2), certificate weight criterion (SUS §6.2 wording is unclear), impact factors and method (SUS §11), payroll deductions (HR §3.6). Geofence radius, lateness tolerance and overtime are decided in phase 2 as settings (DECISIONS §7)
- Lists that differ between specs: organization types (SAL §4.1 vs CS §6.8), Finance-stage states (FIN §5 vs PRC §4 and MKT §8). Employee status and ticket states are settled (DECISIONS §6, §8)
- Migrating existing leads and customers from the current ERPNext
