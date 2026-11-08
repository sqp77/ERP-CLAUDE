# Phase 1 — HR foundation + Employee Portal: what was delivered

Phase 1 of the Eayni ERP (جمعية عيني لإعادة التدوير التعاونية) is complete and runs locally. Everything below is
in the `main` branch (GitHub `sqp77/ERP-CLAUDE`). Specs are in `docs/SPECS.md`; every behaviour choice is in
`docs/DECISIONS.md` (sections cited as **D§n**).

## 1. What works, by role

### Every employee (role `employee`)
- **Login** with work email and password, optional authenticator (TOTP); active sessions with revoke; forced password change for temporary passwords; password reset by link. [EP §3, D§2, D§14.A]
- **Dashboard** with cards for profile, contract, financial details, requests, tickets, tasks, calendar, reports, news and notifications.
- **Profile** (a view on the HR record): contact info, national address and photo saved directly and logged; bank account change with proof → Finance approval; secondment report upload with reminders. [EP §5–8, D§10, D§12]
- **HR requests** ("رفع طلب"): leave, permission, remote work, salary certificate, experience certificate, advance, data update, official letter — routed by type to the direct manager and/or HR, with stage SLAs, returns for completion, certificates generated on approval, full action log. [HR §3.5, EP §11, D§5, D§13]
- **Tickets** to any department (Finance and Procurement hidden until their modules): queue → assignment → processing → resolution → requester-only close with service rating; reopen within 10 days; reminders and auto-close. [EP §9, D§8, D§16]
- **Tasks**: "مهامي", start / finish (finish goes to the assigner for review), task history; tasks also appear on the calendar. [EP §10, EP §16, D§15]
- **Calendar**: day / week / month, Gregorian/Hijri toggle, meetings with participants and linked records, reminders, status and outcome. [EP §13, D§17]
- **News**: feed (pinned first), department filter, archive; staff can write news for their own department and send it for the manager's approval. [EP §12, D§10, D§17]
- **Reports to the direct manager**: typed reports with period, details and files; answers to a manager's request; manager notes; export as printable HTML or Excel. [EP §14, D§17]
- **Notification center**: all 18 EP §15 notifications, grouped by day, filters by group and unread. [EP §15]

### Direct manager (no role — derived from the org chart)
- "فريقي": direct reports with status, open/late tasks, pending requests, open tickets, secondment reports; assign tasks and request reports from there. [EP §16, D§15]
- Approves/rejects direct reports' HR requests (inbox), reviews their finished tasks, reads their reports and adds notes.
- Manager dashboard: team, tasks by status and overdue, requests waiting, reports awaiting review, meetings this week — every card opens the filtered list. [EP §16, D§18]

### Department manager (role `department_manager`, scoped to a department)
- Everything above for the whole department; department task board (queue, Kanban/table, filters, workload); assigns and reassigns tasks and tickets; approves the department's news. [EP §16, D§15, D§16]

### HR (roles `hr_officer`, `hr_manager`)
- Org structure (departments, units, branches, sites, positions), employee files with encrypted identity and bank data, contracts and addenda, documents with expiry alerts, custody, transfers / promotions / manager changes / status changes with append-only history, secondments, account disabling at end of service. [HR §3.1, §3.3, §3.9, §3.10, D§3, D§6, D§11]
- HR request queue and decisions, certificates, profile-change queue (view), employee reports (all), news circulars (direct publish), **HR dashboard** (headcount, expiries 30/60/90, request queues, probation, changes) and the **field-picker export** with sensitive-field control and audit. [HR §4–5, D§18]

### Finance (roles `finance_staff`, `finance_manager`)
- Approve bank-account changes; receive advances after HR approval on the same request number (`hr.request.handoff.finance`); only the Finance manager (or executive) decides the final step. [EP §8.1, HR §3.5.6, FIN §11–12, D§13]

### Executive management (role `executive`) and system admin (role `system_admin`)
- Executive: read-only across employees, requests, tasks, news; publishes circulars; notified of finance/executive role grants. [FIN §12, D§15]
- System admin: users and roles (grantable-role matrix), settings, workflows, audit log, authenticator resets; **no financial approval right**. [D§4, D§14.A]

## 2. Demo script (local)

```bash
npm install            # see README for the npm cache note
npm run seed           # idempotent; adds sample data to an existing DB
npm run dev            # API :4000, web :5173 (or the next free port)
```
Sample accounts (`README.md`): all `…@eayni.local`, password `Sample12345!`; admin `admin@eayni.local` / `Admin12345!`.
HR, Finance and admin accounts must enrol an authenticator on first login.

1. **omar** (field worker, Operations): dashboard → "مهامي" (start a task, finish it) → "رفع طلب" leave → "رفع تذكرة" to IT (note the IT-specific field) → report to the manager → calendar (his tasks appear).
2. **khalid** (Operations manager): "لوحة فريقي" → "فريقي" (assign a task, request a report) → "لوحة مهام القسم" (queue, Kanban, workload, department tickets) → "طلبات فريقي" (approve omar's leave) → review a finished task → read omar's report and add a note.
3. **mohammed** (IT staff): "تذاكري" → "تذاكر القسم" → "استلام التذكرة" → request information → resolve. Then as **omar**: close with a rating or reopen (it returns to mohammed).
4. **noura** (HR manager, TOTP): "لوحة الموارد البشرية" → employee file (contracts, documents, custody, reports tab) → transfer / promotion → "طلبات الموظفين" queue → "تصدير البيانات" (pick fields, note the sensitive badge, preview, Excel) → publish a circular.
5. **abdulaziz** (Finance manager, TOTP): approve the pending bank change → decide the advance handed off from HR.
6. **admin**: users (grantable roles, MFA reset), settings (SLA, ticket follow-ups, routes, outbox retention and replay window), workflows, audit log (sensitive views and exports), **صندوق الأحداث** (`/admin/outbox`: failed / expired / unhandled events, requeue).
7. **Go-live review checks** (D§19): as **khalid**, open the manager dashboard and click "المتأخرة" (board filtered server-side), "التذاكر المفتوحة" (tickets of his team), a meeting notification (`/calendar?event=…` jumps to its date; switch to Hijri and open the month view). As **noura**, open the HR dashboard and click the contracts / identities / documents expiry cards (`/hr/expiring`) and "فترة التجربة" (`/hr/employees?probation=30`); try the export preview with a date and a salary column and the Hijri toggle. As **omar**, download a certificate with popups blocked (a toast with the link appears; the app tab stays). As a plain employee, open a colleague's file: no sensitive fields, documents without download links.

## 3. Decisions made in phase 1

| Topic | Where |
|---|---|
| Infrastructure pending list, local-only rule | D§1 |
| Login, TOTP roles, session limits | D§2 |
| Master data and employee import | D§3 |
| Roles: direct manager derived, department manager scoped, admin has no financial right | D§4 |
| HR request routing matrix and SLA | D§5 |
| Employee statuses and secondment | D§6 |
| Phase scope (attendance deferred to phase 2) | D§7 |
| Tickets: shared record with FIN/PRC later, follow-up timers, rating, IT "متعثر" | D§8, D§16 |
| Numbering and in-app-only notifications | D§9 |
| Profile edits, news approval, employee numbers | D§10 |
| Slice notes with review outcomes: HR core, profile, requests | D§11–13 |
| Security / integrity / frontend / hardening review (24 items) | D§14 |
| Work distribution, team scope, follow-ups | D§15 |
| Calendar, news, reports, notification center | D§17 |
| Dashboards and export | D§18 |
| Go-live review: sensitive-field default deny, news edit rules, job schedule, outbox retention and replay | D§19 |

## 4. Known limitations (phase 1)

- **Attendance, payroll, performance, training, recruitment, end-of-service settlement** are later phases (D§7); their dashboard cards are absent by design.
- **PDF output** (certificates, report export, data export) is printable HTML until the headless-Chromium function exists (D§1 item 11).
- **Notifications are in-app only**; the email adapter is built but off until a sending domain is verified (D§9). Push and WhatsApp are later.
- **Finance and Procurement ticket targets** are hidden until those modules exist; an approved advance is handed off to Finance on the same number but has no disbursement screen yet (D§13).
- **Leave balances** and the attendance effect of approved leave come with phase 2.
- **Trainings** exist only as calendar events (no training module). Customer / project links on meetings arrive with CRM.
- **Outbox events with no subscriber** are parked as `unhandled` and replayed when a module subscribes within `outbox.replayWindowDays` (30); older ones are marked `expired` and can be requeued from `/admin/outbox`. Delivered events are purged after `outbox.retentionDays` (90) (D§19).
- **Charts** are simple bars; Recharts dashboards arrive with the KPI framework.
- **Tests** cover the API (142) and web logic (28, incl. source-hygiene checks for translation keys, links and date handling) but there is no browser end-to-end suite; RTL/phone layouts were checked by reading the layout code and manually at desktop width, not in a device lab.
- **Field-level rules are code-defined for system roles** (D§19): the admin can edit a system role's grants, but its sensitive-field rules follow the code on every start. Custom roles get default-deny on sensitive fields until a field rule is added.
- **Email, push and WhatsApp** stay off; failed outbox hand-offs reach system admins only as in-app `security.alert` notifications.

## 5. Pending before staging

Nothing has been deployed. Before the first `serverless deploy --stage staging`, the owner decides the items in **D§1 "Pending before staging"**: AWS account/region and data residency, MongoDB Atlas, staging domain and TLS, SES sending domain, brand assets, SSO decision, branches and sites, ERPNext employee import, advance limit, secrets in SSM, the PDF renderer function, and the Serverless v4 license. Also set in production: `APP_SECRET` (and `APP_SECRET_PREVIOUS` when rotating), `SCRYPT_LOG2_N` (17), `COOKIE_SECURE=true`, and the app URL for bucket CORS.
