# Decisions — Eayni ERP

Answers from the product owner (Saud, IT) that settle what `docs/SPECS.md` leaves open or where two specs disagree. This file **overrides the defaults in `CLAUDE.md`**. Every decision cites the spec sections it settles. Dates are Gregorian.

Last updated: 2026-11-04.

## 1. Infrastructure and accounts — not decided yet
- AWS account, hosting region and data-residency requirement, MongoDB Atlas cluster, staging domain, email sending domain and brand assets are **not decided**.
- Until then: build and test everything **locally only**. No deploy step runs without going through the list below.
- UI uses neutral placeholder colors and a text logo until the real identity arrives. [EP §3.1]

### Pending before staging (remind the owner before any deploy)
| # | Item | Needed for |
|---|---|---|
| 1 | AWS account, region and data-residency decision | serverless deploy, S3, SES |
| 2 | MongoDB Atlas cluster and connection string in SSM | API |
| 3 | Staging domain and TLS certificate | web + API |
| 4 | Verified email sending domain in SES | email notification channel, password reset mail |
| 5 | Brand assets: logo, colors, font | login page and shell [EP §3.1] |
| 6 | SSO decision (provider or none) | auth adapter |
| 7 | Branches and operating sites with coordinates | org structure seed [HR §3.1, §3.4] |
| 8 | Employee import from ERPNext: yes/no and source file | HR phase 1 data load |
| 9 | Advance limit and approver | HR request matrix (§5 below) |
| 10 | Secrets moved to SSM Parameter Store (no `.env` on servers) | all |
| 11 | PDF renderer function (headless Chromium in its own Lambda) | certificates, letters, PDF exports — HTML output works meanwhile [HR §3.5, EP §14.3] |
| 12 | Serverless Framework v4 license/account for `npx serverless deploy` | deploy pipeline |

## 2. Login and identity [EP §3, HR §6]
- **Username = work email.** The employee number is shown in the profile but is not a login identifier. [EP §3.2, EP §7]
- **Email + password now.** SSO is not decided; the auth layer keeps an adapter seam so an SSO provider can be added without touching the rest.
- **Second factor: authenticator app (TOTP).** Mandatory for the roles *system admin*, *HR* (officer and manager) and *Finance* (staff and manager). Optional for everyone else. [EP §3 "دعم التحقق الإضافي عند الحاجة"]
- **Sessions:** 30 minutes idle timeout, 12 hours absolute maximum. Both are settings. [EP §3 "تحديد الجلسات النشطة"]

## 3. Master data [HR §3.1, EP §9.1]
- **Departments:** start with the nine in EP §9.1 (الموارد البشرية، التقنية، التشغيل، المبيعات، التسويق، التنمية، خدمة العملاء، المشتريات، المالية) plus **الإدارة التنفيذية**.
- Branches, operating sites and headcount: not decided. Seed sample data for local testing only.
- Importing employees from the current ERPNext: not decided. The employee model stays import-friendly (external id, free-text legacy fields); **no import script now**.

## 4. Roles [HR §6, EP §16]
Approved role list: **employee, direct manager (derived), department manager, HR officer, HR manager, executive management, system admin**, plus per-department staff/manager roles as each module arrives.
- The **direct manager is a field on each employee's record** (HR §3.1.3). "Direct manager" rights are derived from that field, never assigned as a role.
- The **department manager is a role scoped to one department** (EP §16 "مدير القسم"). A department manager is *not* automatically the direct manager of the department's employees.

## 5. HR self-service request matrix [HR §3.5, EP §11]
Starting defaults. **Every route is workflow configuration that HR can change** from settings; nothing here is hard-coded.

| Request type | Via direct manager? | Final approval | SLA per stage (business days) |
|---|---|---|---|
| إجازة، استئذان، عمل عن بُعد | Yes | HR | 2 |
| تعريف بالراتب، شهادة خبرة، خطاب رسمي | No | HR | 2 |
| تحديث بيانات | No | HR | 2 |
| سلفة | Yes | HR, then Finance on the **same request number** | 2 |

- This resolves the HR §3.5 (always via manager) vs EP §11 (direct to HR or manager by type) difference: the route is per type.
- **Advance limit: not decided.** It is a setting; while unset, the limit check is skipped and the request is flagged for HR attention. The hand-off to Finance keeps the number, attachments and approval log. [HR §3.5.6, FIN §11]

## 6. Employee status and secondment [HR §3.1.7, EP §5.3]
- **Merged status list (approved):** على رأس العمل، إجازة، عمل ميداني، انتداب، موقوف، مستقيل، منتهي الخدمة. Field work displays as on duty with the field nature shown. Account status: نشط / غير نشط.
- **Secondment is recorded by HR**, or by the direct manager with HR approval. It is **not** an employee self-service request type. The employee uploads the secondment report afterwards and the direct manager is notified. History is kept. [EP §5.3, EP §15.14]

## 7. Phase scope [HR §8, EP §18, CLAUDE.md build order]
- **Attendance is not in phase 1.** It is **phase 2**, following HR §8 ("التشغيل اليومي"). Geofence radius, lateness tolerance, overtime and deductions are decided in that phase, all as settings. [HR §3.4, §3.6]
- **Salary data is in phase 1:** HR enters basic salary, allowances and advances so the portal's financial details work. [EP §8] Payroll runs come later. [HR §3.6]
- **HR owns salary data; Finance reads it.** This resolves EP §8.1 ("الموارد البشرية أو المالية"). Rule 5 of CLAUDE.md (financial figures come from Finance) applies to department budgets and revenue, not to the salary master.

## 8. Tickets [EP §9, IT §7.1, FIN §3, PRC §2]
- Portal tickets addressed to **Finance** and **Procurement** are **the same records** as the FIN §3 financial request and the PRC §2 purchase request: one form, one number, no second entry point. Those two targets are **hidden in the department list until their modules exist**. [EP §9.1 note]
- After **تم الحل**: remind the requester after **3** business days, **auto-close after 5** with a notification, allow **reopening within 10**. All three are settings. [EP §9.4 "آلية معتمدة"]
- **Service rating on every ticket at close**, not only IT. [IT §7.1]
- **All departments use the eight EP §9.4 states.** IT adds **متعثر** in its own workflow config. [EP §9.4 vs IT §7.1]

## 9. Numbering and notifications [EP §20.3, EP §15]
- **One prefix per document type** from an atomic counter: `TKT-2026-00012`, `HRQ-2026-00034`, and so on, as in CLAUDE.md.
- **Phase 1 notifications: in-app only.** The email channel is built behind its adapter and **switched off** until the sending domain is verified (item 4 in the pending list).

## 10. Profile edits, news, employee number [EP §5, §8.1, §12, HR §3.3]
- **Contact info, national address and photo** save directly, are logged, and HR is notified. [EP §5.1, §5.4, §5.5]
- **Bank account changes need Finance approval with a proof document.** [EP §8.1]
- **Official data** (name, identity, job data) is edited by HR only. [EP §5.1, §5.2, §7, EP §20.2]
- **News:** each department manager approves their department's news; circulars from **HR** and **Executive Management** publish directly. [EP §12.1, §12.3.3]
- **Employee number:** generated by the system for new hires; imported employees keep their current number. [HR §3.3]

## 11. Implementation notes from phase 1 slice 1 (HR core) — approved 2026-11-04 with three changes
1. **Encryption at rest:** identity number and IBAN are stored AES-256-GCM encrypted; only the last 4 digits are kept in clear for display masks. Salary is stored as a number (needed for payroll math later) and protected by field-level permission only. [EP §5.2, §8.1, CLAUDE.md "Sensitive fields"]
2. **Who sees sensitive fields:** the employee sees all own fields; HR officer/manager see all; Finance sees salary, allowances and IBAN but not identity number, religion or birth date; department managers and executives see the file without any sensitive field. Any sensitive view of someone else's file is audited. Directory scope: employee → own file; direct manager → own + direct reports (one level); department manager → own department; HR/executive → all. [HR §6, EP §16]
3. **End of service (changed in review):** a status change to مستقيل / منتهي الخدمة records the effective date as the **last working day**. The employee keeps normal access until then; the daily job `hr.accounts.deactivate` disables the portal account and ends its sessions after the end of that day (Asia/Riyadh). Reverting the status re-enables the account. The full end-of-service checklist (settlement, custody return, exit interview, experience certificate) is phase 6. [HR §3.10, EP §3.10]
4. **Transfer (changed in review):** a transfer always names the new direct manager in the same action. Items waiting for the old manager (HR requests, approvals) move to the new manager through a registered handler per module, each move is written to the stage log, and both managers are notified. The HR-requests module (slice 3) registers the first handler. The same applies to a plain manager change. The user account's department follows the employee so department-scoped roles stay right. [HR §3.1.8, EP §15.15]
5. **Contracts:** renewal creates a new contract version and marks the previous one منتهي with reason "renewed"; a contract whose end date passes flips to منتهي automatically. Contract-end alerts go to HR and the employee at 90/30/7 days (the `documents.expiryAlertOffsetsDays` setting). [HR §3.9, EP §6]
6. **Probation (changed in review):** alerts at **30 and 7 days** before the end (setting `hr.probationAlertDaysBefore`, default `[30, 7]`) to HR, the employee and the direct manager, so HR has time to decide on an extension. [EP §6.5–6.6, EP §15.11]
7. **Identity/iqama expiry** alerts use the document offsets, to HR and the employee. [HR §3.9, EP §5.2]
8. **Custody** is a simple HR register for now (item, asset tag, serial, issued/returned, condition); IT assets link to it in the IT module. [HR §3.3]
9. **Employee documents** use the platform documents store with owner type `employee`; every document is marked sensitive and versions are kept. [HR §3.9]

## 12. Implementation notes from phase 1 slice 2 (portal profile) — approved 2026-11-04 with one change
- **Profile = the HR record.** The portal reads `/hr/me`, which is the employee file plus display labels; nothing is copied. [EP §20.1]
- **Self-service edits (DECISIONS §10):** mobile, extension and national address save directly, are logged in the employee history and audit, and HR gets an in-app notification. Work email, names, identity and job data are HR-only; the portal shows a hint pointing to "رفع طلب ← تحديث بيانات" (slice 3). [EP §5.4, §5.5]
- **Photo:** the employee uploads an image; only image types are accepted and the file must be the employee's own upload. [EP §5.1]
- **Bank account change:** a request (`PCR-YYYY-#####`) with a mandatory proof document; the IBAN is stored encrypted in the request; one pending request at a time; the employee can cancel it. **Finance** (finance_staff / finance_manager) approves or rejects (reason mandatory); HR sees the queue read-only; the requester can never decide their own request. Approval writes the new bank data to the file and is audited as sensitive; the employee is notified either way. [EP §8.1, FIN §12]
- **Financial details are read-only** in the portal; advances show a placeholder until HR requests (slice 3) add them. [EP §8]
- **Contract card** shows the current contract (latest active/renewing), probation state and addenda with downloads. [EP §6]
- **Secondment report (changed in review):** the report can be uploaded during **and after** the secondment (a new upload replaces the old one); the upload is recorded in the history and the direct manager is notified. Reminders to the employee: on the day after the end date (`hr.secondmentReportFirstReminderDays`, default 1) and again N business days later (`hr.secondmentReportSecondReminderBusinessDays`, default 3), until the report exists. HR has a list of secondments showing which still have no report; previous secondments are kept in the file's history. [EP §5.3, §15.14]
- **Birthday:** a daily job sends the greeting once per year on the Riyadh date; the dashboard shows a banner on the day. [EP §5.1, §15.12]
- **Dashboard:** the nine EP §4 sections are cards; requests/tickets, reports and news are marked "قريبًا" until their slices.

## 13. Implementation notes from phase 1 slice 3 (HR self-service requests) — confirm or correct
- **Routing is configuration:** the matrix of §5 is the setting `hr.requestRoutes` (per type: via the direct manager or not; final approver HR, or HR then Finance). An employee without a registered direct manager has "via manager" requests routed straight to HR and flagged. Stage SLA: `hr.requestStageSlaBusinessDays` (2 business days) on every waiting state; an overdue stage notifies the pending party once. [HR §3.5, EP §11]
- **One form, eight field sets:** the fields of each type are exactly those listed in HR §3.5; the request number is `HRQ-YYYY-#####`; attachments are optional on every type. Submission happens immediately (no separate draft step; the platform drafts store can hold an unfinished form later).
- **Decisions and actions:** approve / reject (reason mandatory) / return for completion (reason mandatory) at each stage; the requester edits the fields and resubmits, and the request re-enters the same route. The requester never decides their own request. Every action is in the request's action log and in the platform stage log (with durations and overdue marks). [HR §3.5 "سجل الإجراءات", FIN §12]
- **Certificates:** salary and experience certificates are generated on HR approval from Handlebars templates filled from the employee file (name, identity number, nationality, position, department, hire date, employment type, salary and allowances when "detailed", contract type for experience). Numbered `CRT-YYYY-#####`, stored as an RTL HTML attachment (the PDF renderer is pending, DECISIONS §1); downloads are audited as sensitive. Template wording is a first draft for HR to review. [HR §3.5.4–3.5.5]
- **Advance:** flagged `advance_limit_unset` until the limit setting exists, `over_limit` once it does; after HR approval it goes to **awaiting final approval with Finance** on the same number (`handoff.department = finance`), Finance users are notified and see it in their queue; a finance manager or the executive decides. When the Finance module arrives it consumes the `hr.request.handoff.finance` event and the same record. [HR §3.5.6, FIN §11, DECISIONS §5]
- **Manager change / transfer:** open requests follow the employee to the new manager; those waiting for the old manager count as "moved", get a `reassigned_manager` row in the stage log and the action log, and both managers are notified (handler registered per DECISIONS §11.4).
- **Visibility:** requester → own; direct manager → requests of their reports (inbox shows only those awaiting them); department manager → department; HR, Finance and executive → all. Finance staff can view but only finance managers (and the executive) decide the final step.
- **Not built yet (later slices / phases):** leave balances and attendance effects of approved leave (phase 2), the Finance disbursement of an approved advance (Finance module), official-letter templates (HR §3.5.8 lists no template; letters are approved and written by HR outside the system for now).

## 14. Code review before slice 4 — behaviour changes (2026-11-05)
Fixes from the full review of everything up to commit f643229, grouped as in the review. Each item has a test that failed before the fix.

### A. Security
- **Authenticator replacement needs a verified second factor.** Once a user has an authenticator, `/auth/mfa/enroll/*` refuses a password-only session (`mfa_required`). A lost authenticator is reset by a system admin only (`POST /users/:id/mfa/reset`, permission `users.security:edit`, held by `system_admin` alone): secrets dropped, all sessions revoked, audited (`meta.mfaReset`), the user and the other admins notified. An admin cannot reset their own. [EP §3, DECISIONS §2]
- **Second-factor brute force.** `/auth/mfa/verify` and `/auth/mfa/enroll/confirm` are rate-limited per IP (30 / 15 min); after 5 wrong codes on one session the session is revoked (`mfa_locked`, logged); a code accepted in the last 90 s is refused again (`mfa_replayed`).
- **Files are authorized through their owner record.** `GET /files/:id`, `GET /files/:id/url` and `DELETE /files/:id` allow the uploader, otherwise ask the owner record's access checker (platform record-access registry: `employee`, `hr_request`, `profile_change` registered by HR; unknown types → `files:all` only). A file with no owner is private to its uploader until a record claims it: HR requests claim their attachments on creation and resubmission, bank-change requests their proof, the employee file its photo and secondment report. Uploading straight onto a record requires access to it. **Sensitivity is decided by the server from the owner type**, the client flag is ignored.
- **Comments** check access to the record (same registry) on read and write.
- **Role grants are limited by a grantable matrix** (`GRANTABLE_ROLES` in `packages/shared`): system admin → any role; HR officer / HR manager → `employee` and `department_manager` only; everyone else → none. Adding *or removing* a role outside the actor's list is refused (`role_not_grantable`). Role changes are audited with the diff (`meta.roleChanges`) and every other system admin gets a `security.alert` notification. The users form shows only grantable roles.
- **Nobody decides their own request, at any stage.** The requester's role relations are dropped by the HR requests service, so an HR officer's own certificate request or a finance manager's own advance can only be decided by someone else; the UI actions come from the same rule. [FIN §12, DECISIONS §13]
- **Final step of an advance.** One rule (`finalDeciderRoles`) feeds both the available actions and the transition guard: for `hr_then_finance` only `finance_manager` and `executive` decide `awaiting_final`; HR manager and Finance staff can view (and HR can still return it for completion). The shipped `hr_request` workflow is v2 (`final_*` allow `approver` only); stored defaults that an admin never edited are upgraded automatically, admin-edited definitions are left alone.
- **Temporary passwords.** With `mustChangePassword` the API serves only `/auth/me`, `/auth/password/change`, `/auth/mfa/*` and `/auth/logout` (`password_change_required`). A temporary password expires after `auth.temporaryPasswordHours` (default 72) and login then says `temporary_password_expired`; the admin issues a new one. Changing the password needs an MFA-verified session when the user has an authenticator. Generated temporary passwords always satisfy the policy.

### B. Data integrity
- **No double decisions.** Every HR request transition persists with a conditional update on `{ _id, state: fromState }`; the loser of a race gets **409** and nothing is written for it (no stage log, no action log, no certificate, no event). Same for bank-change decisions. The workflow engine now takes a `persist` hook and writes the stage log only after the record update succeeded; every future module uses the same hook.
- **One transaction per transition** (`withTransaction`): record update → certificate (number + attachment) → stage log → action log → audit → outbox events commit together or not at all; notifications go out after the commit. Requires a replica set (local embedded Mongo and Atlas both are).
- **Outbox.** Claims carry a 5-minute lease; an event left in `processing` by a crashed worker is reclaimed after the lease. Events with no subscriber are parked as **`unhandled`** (not `delivered`) and replayed automatically once a subscriber for their type registers — so `hr.request.handoff.finance` events published before the Finance module exists are delivered to it later. Each subscriber has a key recorded in `handledBy`; retries skip handlers that already succeeded. Module subscribers are registered in one place (`apps/api/src/subscribers.ts`) called by the api, jobs and outbox entry points.

### C. Frontend
- **Lookups:** one hook per lookup table in `apps/web/src/lib/lookups.ts` (departments, units, positions, branches, sites, roles) with one cache shape (`{ items }`); HR and admin pages share them, so opening an admin page can no longer break an employee file. The router has an Arabic error element.
- **Time zones:** `datetime-local` values are sent as ISO strings with `+03:00`; day/week boundaries, "today" defaults and the birthday check are computed in Asia/Riyadh (`lib/dates.ts`), never in the browser's or Lambda's zone.
- **Idle timeout:** polling requests carry `x-background: 1` and the API does not count them as activity; the sidebar counters stop polling when the tab is hidden. A session that only polls goes idle after 30 minutes as DECISIONS §2 intends.
- **Uploads:** the presigned PUT is sent without cookies; the bucket's CORS allows only the app origin (`/eayni/<stage>/app-url`) and `Content-Type` / `Content-Length` headers.
- **Lost session:** any 401 whose code says the session is gone (`session_idle`, `session_expired`, `session_revoked`, `invalid_session`, `account_disabled`, `mfa_locked`, `unauthorized`) clears the query cache (salaries, IBANs…) and returns to the login page. A wrong password or wrong code does not.
- **Secondment report:** the upload button shows while the latest secondment has no report, whatever the current status (slice 2 review).
- **Notification links:** tasks open at `/tasks/:id` (the task in a dialog over the list); the direct manager is sent to a new **"فريقي"** page (`/manager/team`, `GET /hr/team`) listing direct reports with their secondment reports, and may download those reports (team access on the employee record comes from the org chart, not a role — DECISIONS §4). A source test keeps every API link resolvable by the router.
- **Smaller fixes:** a returned request is edited (fields and attachments) and resubmitted from one shared form; validation errors show on the field (client and server); failed queries show "no permission / not found / error" with a retry instead of "no data"; downloads open the tab before the `await` (iPhone Safari); custody return asks for the condition (سليمة / تالفة / مفقودة, stored as codes); long emails and IBANs wrap at phone width; the remaining hard-coded Arabic strings and English labels moved into `common.json` and a source test keeps it that way.

### D. Hardening
- **Passwords:** scrypt cost raised to N = 2^17 (`SCRYPT_LOG2_N`, 17 in deployed stages, 14 in tests); hashes made under a lower cost verify and are re-hashed at the next successful login. The login body no longer returns the session token (the httpOnly cookie is the only carrier), and an unknown email costs the same hash check as a wrong password.
- **Keys:** per-purpose keys (`field`, `totp`, `sign`, `index`) are derived from `APP_SECRET` with HKDF; every new ciphertext is `v2:<key id>:…`; legacy `v1` ciphertexts still decrypt. **Rotation:** set the new value as `APP_SECRET` and the old one as `APP_SECRET_PREVIOUS`, redeploy; reads use the key id to pick the right secret, writes use the new one; drop `APP_SECRET_PREVIOUS` after re-encrypting (`needsReencrypt` tells which values still need it — no bulk re-encrypt job yet).
- **Duplicate employees:** the national ID / iqama number has an HMAC blind index (`identity.hash`, key `index`) with a unique sparse index; create and update refuse a number that belongs to another employee (409). Existing employees are back-filled at startup. [HR §3.3, golden rule 2]
- **Alerts to system admins** (`security.alert`): every workflow edit (with audit), every `auth.*` setting change (including `auth.mfaRequiredRoles`), every role grant or removal (§14.A), and every authenticator reset.

## 15. Work distribution by managers — slice 5 part 1 (2026-11-05) — confirm or correct
Built from the brief "Department managers distribute work to their staff" [EP §16 ثالثًا/رابعًا, EP §10, MKT §11].
- **Who may be assigned:** an on-duty employee (statuses على رأس العمل / عمل ميداني / انتداب / إجازة; not موقوف or left) in a department the actor manages, or one of the actor's direct reports; self-assignment is always allowed; HR / admin ('all' scope) may assign anyone. The task's department is always set by the server from the assignee; a queue task (no assignee) must name a department the actor manages. Same rule on reassignment.
- **Direct managers need no role:** a user with at least one direct report in the org chart implicitly gets `TEAM_LEAD_GRANTS` (team scope): `hr.employees:view`, `tasks:view/create/edit`, `hr.requests:view`, `hr.reports:view` (the last one ahead of EP §14). Team = direct reports, one level. Department managers keep their department scope and additionally see their direct reports in other departments.
- **Department queue:** tasks without an assignee sit in the department queue; managers of that department are reminded after `tasks.unassignedReminderBusinessDays` (1 business day) and once more each day the task stays unassigned.
- **Review step:** when the assignee finishes a task assigned by someone else it goes to بانتظار المراجعة; the assigner (or a department manager) approves (مكتملة) or returns it with a mandatory note (قيد التنفيذ). A manager who assigned a task to themself closes it directly. Every move is in the append-only `taskevents` log and in the audit log.
- **Reassignment** needs a reason; the previous and the new assignee are both notified; cancelling is for the assigner or a manager.
- **Notifications added:** مهمة بانتظار مراجعتك، تم اعتماد إنجاز مهمتك، أُعيدت إليك مهمة، أُعيد إسناد مهمة، مهام بلا مكلّف; overdue goes to assignee and assigner; "due tomorrow" uses the existing reminder setting.
- **Screens:** "فريقي" (direct reports, plus the department for department managers; position, status, open/late tasks, pending requests, secondment report, assign button, link to the employee page within the viewer's rights); assign-task dialog (searchable team list with workload hints, no ids; queue option; dates with the Riyadh offset; attachments; optional link to an HR request by number — tickets when slice 4 lands); department board `/tasks/board` (queue on top, Kanban or table, filters by employee / priority / due date / status, MKT §11 colours, workload panel); task dialog with history and the actions open to the viewer.
- **Seed:** the Operations manager (khalid) now has four employees (rashed, omar, yousef, fahad) and seven tasks covering every state, including a queue task and a returned one.
- **Not built here:** tickets as a task source (slice 4), employee reports (EP §14), per-employee calendar of tasks, push/WhatsApp channels.

**Approved 2026-11-05 with four follow-ups (built):**
- **MFA lockout per user:** wrong codes are counted on the user across sessions inside `auth.mfaFailureWindowMinutes` (30); at `auth.mfaMaxFailuresPerUser` (10) the second factor is locked for `auth.mfaLockMinutes` (30), logged (`mfa_user_locked`), the session revoked and system admins alerted. The per-session lock after 5 stays.
- **Own roles:** nobody changes their own roles, system admins included (`own_roles`). Granting `finance_manager` or `executive` is audited and executive management (users with the `executive` role) is notified [FIN §12].
- **Assigning to someone away** (إجازة / انتداب) stays allowed; the team list carries `awayKind` / `awayUntil` (secondment end date, or the end of the latest approved leave) and the assign dialog shows "في إجازة حتى …" and asks for an explicit confirmation.
- **Task status changes, reviews and (re)assignments** use the conditional-update + transaction pattern of §14.B (409 on a lost race); tickets use it from the start.

## 16. Implementation notes from phase 1 slice 4 (internal tickets) — confirm or correct
Built per §8 and EP §9; the manager's side reuses the slice-5 team workspace.
- **Targets** [EP §9.1]: every department but executive management. `tickets.hiddenTargets` (finance, procurement) hides the two that will share their record with FIN §3 / PRC §2; `tickets.managersOnlyTargets` keeps the EP §9.1 rule for when they appear. Department-specific fields and priority wording come from `tickets.departmentFields`; IT is seeded with نوع الطلب (عطل / صلاحية / جهاز / شبكة / برنامج) and its priority labels (عاجل / مرتفع / متوسط / منخفض) mapped onto the four general priority levels — one priority field, not two.
- **Flow** [EP §9.4]: open → department queue (managers of the target department notified) → the department manager assigns from the team workspace / board (same assignee rule as tasks: own department or direct report) → قيد المعالجة, with `processingStartedAt` recorded on the first move for IT §7.1 → assignee may ask the requester for information (reason required; the requester answers with a note and attachments) → تم الحل with a mandatory resolution. **Only the requester closes**, and closing asks for a 1–5 service rating. The department may never close.
- **After تم الحل** (§8): after `tickets.remindAfterBusinessDays` (3) the ticket moves to بانتظار تأكيد مقدم الطلب and the requester is reminded; after `tickets.autoCloseAfterBusinessDays` (5) it is closed by the system with a notification to requester and assignee; the requester may reopen within `tickets.reopenWithinDays` (10 calendar days) of closing, with a reason; a reopened ticket goes back to the department queue (the previous assignee can also restart it).
- **IT's workflow copy** `ticket_it` adds متعثر (stall with a reason / resume) [IT §7.1]; every other department uses the generic eight-state `ticket` workflow (v2). Workflow choice is by target department code (`ticket_<code>` when such a definition exists).
- **Visibility:** requester and assignee see their own tickets; department managers see their department's; system admin and executives see all. Comments [EP §9.5] use the platform comments on the ticket record; attachments follow the ticket's visibility.
- **Integrity:** every transition is a conditional update on the current state inside one transaction with the stage log, the action log, the audit row and the outbox event (409 on a lost race, §15 follow-up 4).
- **Tasks ↔ tickets:** a task can now link to a ticket by number; the department board shows the department's open tickets above the task queue; "فريقي" shows tickets assigned per employee.
- **Seed:** seven IT/HR/Ops tickets covering new, قيد المعالجة, بانتظار معلومات, تم الحل, مغلقة مع تقييم, معاد فتحها, متعثر.
- **Not built here:** Finance / Procurement targets (their modules), ticket KPIs dashboard for IT (IT §7.5, slice 6).

**Approved 2026-11-05 with two changes (built):**
- **Department staff and the queue:** staff of the target department see their department's tickets (view only) and may take an unassigned one themselves ("استلام" → قيد المعالجة, assigned to them; requester and managers are told). The manager still assigns and reassigns. Per-department setting `tickets.staffQueueDepartments` (missing = on). Tickets to a department whose manager is away no longer wait.
- **Reopening:** a reopened ticket goes back to the employee who resolved it (`resolvedByUserId`), who is notified together with the department manager; it returns to the department queue only when that employee is no longer on duty in that department.
- All other §16 decisions stand (one priority field with IT wording, reopen window from closing, IT workflow copy, requester-only close with rating).

## Still open (ask before building)
Everything in the "Open decisions" section of `CLAUDE.md` that is not settled above, notably: accounting depth / general ledger, ZATCA route and wave, financial authority matrix and monthly cut-off, customer app and company portal, offline support for field staff, discount limits, points and rewards policy, certificate weight criterion, impact factors, organization-type list (SAL §4.1 vs CS §6.8), Finance-stage state labels in other modules (FIN §5 vs PRC §4 and MKT §8).
