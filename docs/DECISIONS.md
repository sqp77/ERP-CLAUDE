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

## Still open (ask before building)
Everything in the "Open decisions" section of `CLAUDE.md` that is not settled above, notably: accounting depth / general ledger, ZATCA route and wave, financial authority matrix and monthly cut-off, customer app and company portal, offline support for field staff, discount limits, points and rewards policy, certificate weight criterion, impact factors, organization-type list (SAL §4.1 vs CS §6.8), Finance-stage state labels in other modules (FIN §5 vs PRC §4 and MKT §8).
