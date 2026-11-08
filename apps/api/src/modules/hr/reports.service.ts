import type { FilterQuery } from 'mongoose';
import ExcelJS from 'exceljs';
import type { CreateEmployeeReportInput } from '@eayni/shared';
import { badRequest, forbidden, notFound } from '../../core/http/errors';
import { actorFrom, type Authz, type AuthedRequest } from '../../core/http/context';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { notify } from '../../core/notifications/service';
import { getSetting } from '../../core/settings/service';
import { claimAttachments } from '../../core/files/service';
import { htmlDocument } from '../../core/templates/render';
import { riyadhDate } from '../../core/dates/businessDays';
import { assertAssignable } from '../../core/tasks/service';
import { withTransaction } from '../../db';
import { Department } from '../../core/org/model';
import { User, type UserDoc } from '../../core/auth/model';
import { Employee } from './model';
import { EmployeeReport, ReportRequest, type EmployeeReportDoc } from './reports.model';
import { teamUserIdsOf } from './service';

export async function reportTypes() {
  return getSetting('hr.reportTypes');
}

/** Submit a report to the direct manager [EP §14.2]. */
export async function submitReport(
  req: AuthedRequest,
  input: CreateEmployeeReportInput,
): Promise<EmployeeReportDoc> {
  const user = req.auth.user;
  const types = await reportTypes();
  if (!types.some((t) => t.code === input.type)) throw badRequest('نوع التقرير غير معروف');
  const employee = await Employee.findOne({ userId: user._id, deletedAt: null })
    .select('departmentId directManagerId fullNameAr')
    .lean();
  if (!employee) throw badRequest('لا يوجد ملف موظف مرتبط بحسابك');
  const manager = employee.directManagerId
    ? await Employee.findById(employee.directManagerId).select('userId').lean()
    : null;
  let request = null;
  if (input.requestId) {
    request = await ReportRequest.findOne({
      _id: input.requestId,
      employeeUserId: user._id,
      fulfilledReportId: null,
    });
    if (!request) throw badRequest('طلب التقرير غير موجود أو تم الرد عليه');
  }
  // Record, attachment claims and request fulfilment commit together (review E7, G9).
  const report = await withTransaction(async (session) => {
    const [doc] = await EmployeeReport.create(
      [
        {
          number: await nextNumber('employeeReport', session),
          employeeId: employee._id,
          userId: user._id,
          departmentId: employee.departmentId,
          managerUserId: manager?.userId,
          managerEmployeeId: employee.directManagerId,
          type: input.type,
          title: input.title,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          body: input.body,
          attachmentIds: input.attachmentIds,
          requestId: request?._id,
        },
      ],
      { session },
    );
    if (input.attachmentIds.length)
      await claimAttachments(input.attachmentIds, 'employee_report', String(doc._id), user._id, session);
    if (request) {
      const linked = await ReportRequest.findOneAndUpdate(
        { _id: request._id, fulfilledReportId: null },
        { $set: { fulfilledReportId: doc._id } },
        { session },
      );
      if (!linked) throw badRequest('طلب التقرير غير موجود أو تم الرد عليه');
    }
    return doc;
  });
  await recordAudit(actorFrom(req), {
    action: 'create',
    resource: 'hr.reports',
    resourceId: String(report._id),
    after: { number: report.number, type: report.type },
  });
  if (manager?.userId)
    await notify({
      userIds: [String(manager.userId)],
      type: 'generic',
      titleAr: 'تقرير جديد من موظفك',
      bodyAr: `${employee.fullNameAr}: ${report.title} (${report.number})`,
      link: `/reports/${report._id}`,
    });
  return report;
}

/** Manager / HR note [EP §14.2.8]: appended, never edited; the employee is told; the report becomes "reviewed". */
export async function addNote(
  req: AuthedRequest,
  report: EmployeeReportDoc,
  note: string,
): Promise<EmployeeReportDoc> {
  if (String(report.userId) === String(req.auth.user._id))
    throw forbidden('الملاحظات للمدير المباشر أو الموارد البشرية');
  report.notes.push({
    by: req.auth.user._id,
    byEmail: req.auth.user.email,
    byName: req.auth.user.displayNameAr,
    note,
    at: new Date(),
  } as never);
  report.state = 'reviewed';
  report.reviewedAt = new Date();
  await report.save();
  await recordAudit(actorFrom(req), {
    action: 'update',
    resource: 'hr.reports',
    resourceId: String(report._id),
    meta: { note: true },
  });
  await notify({
    userIds: [String(report.userId)],
    type: 'generic',
    titleAr: 'ملاحظة المدير على تقريرك',
    bodyAr: `${report.number}: ${note.slice(0, 140)}`,
    link: `/reports/${report._id}`,
  });
  return report;
}

/** A manager asks a team member for a report [EP §15.13]. */
export async function requestReport(
  req: AuthedRequest,
  input: { employeeUserId: string; type: string; dueDate?: Date; note?: string },
) {
  const types = await reportTypes();
  const type = types.find((t) => t.code === input.type);
  if (!type) throw badRequest('نوع التقرير غير معروف');
  await assertAssignable(req, input.employeeUserId); // same reach as assigning work: own department or direct report
  const r = await ReportRequest.create({ ...input, managerUserId: req.auth.user._id });
  await notify({
    userIds: [input.employeeUserId],
    type: 'report.requested',
    bodyAr: `${type.labelAr}${input.dueDate ? ` — قبل ${riyadhDate(input.dueDate)}` : ''}${input.note ? `: ${input.note}` : ''}`,
    link: '/me/reports',
    data: { requestId: String(r._id), type: input.type },
  });
  return r;
}

export async function visibilityFilter(user: UserDoc, authz: Authz): Promise<FilterQuery<unknown>> {
  if (authz.scope === 'all') return {};
  const or: Record<string, unknown>[] = [{ userId: user._id }, { managerUserId: user._id }];
  if (authz.scope === 'department') or.push({ departmentId: { $in: authz.departmentIds } });
  if (authz.scope === 'team') or.push({ userId: { $in: await teamUserIdsOf(String(user._id)) } });
  return { $or: or };
}

export async function findVisible(req: AuthedRequest, id: string): Promise<EmployeeReportDoc> {
  const r = await EmployeeReport.findOne({
    _id: id,
    deletedAt: null,
    ...(await visibilityFilter(req.auth.user, req.authz!)),
  });
  if (!r) throw notFound('التقرير غير موجود');
  return r;
}

async function headerOf(report: EmployeeReportDoc) {
  const [emp, dept, mgr, types] = await Promise.all([
    Employee.findById(report.employeeId).select('fullNameAr employeeNumber').lean(),
    report.departmentId ? Department.findById(report.departmentId).select('nameAr').lean() : null,
    report.managerUserId ? User.findById(report.managerUserId).select('displayNameAr').lean() : null,
    reportTypes(),
  ]);
  return {
    employeeName: emp?.fullNameAr ?? '',
    employeeNumber: emp?.employeeNumber ?? '',
    departmentName: dept?.nameAr ?? '',
    managerName: mgr?.displayNameAr ?? '',
    typeLabel: types.find((t) => t.code === report.type)?.labelAr ?? report.type,
  };
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Printable HTML (→ PDF from the browser until the PDF renderer lands, DECISIONS §1) [EP §14.3]. */
export async function renderReportHtml(report: EmployeeReportDoc): Promise<string> {
  const h = await headerOf(report);
  const org = await getSetting('general.organizationNameAr');
  const period =
    report.periodFrom || report.periodTo
      ? `${report.periodFrom ? riyadhDate(report.periodFrom) : '—'} إلى ${report.periodTo ? riyadhDate(report.periodTo) : '—'}`
      : '—';
  const notes = report.notes
    .map(
      (n) => `<li><strong>${esc(n.byName ?? n.byEmail)}</strong> (${riyadhDate(n.at)}): ${esc(n.note)}</li>`,
    )
    .join('');
  const body = `
<h1 style="margin:0 0 4px">${esc(org)}</h1>
<h2 style="margin:0 0 16px;color:#334155">${esc(h.typeLabel)} — ${esc(report.number)}</h2>
<table style="border-collapse:collapse;width:100%;margin-bottom:16px">
<tr><td style="padding:4px 8px;color:#64748b">الموظف</td><td style="padding:4px 8px">${esc(h.employeeName)} (${esc(h.employeeNumber)})</td><td style="padding:4px 8px;color:#64748b">القسم</td><td style="padding:4px 8px">${esc(h.departmentName)}</td></tr>
<tr><td style="padding:4px 8px;color:#64748b">المدير المستلم</td><td style="padding:4px 8px">${esc(h.managerName)}</td><td style="padding:4px 8px;color:#64748b">تاريخ التقرير</td><td style="padding:4px 8px">${riyadhDate(report.submittedAt)}</td></tr>
<tr><td style="padding:4px 8px;color:#64748b">الفترة</td><td style="padding:4px 8px">${esc(period)}</td><td style="padding:4px 8px;color:#64748b">الحالة</td><td style="padding:4px 8px">${report.state === 'reviewed' ? 'تمت المراجعة' : 'مرسل'}</td></tr>
</table>
<h3 style="margin:0 0 8px">${esc(report.title)}</h3>
<div style="white-space:pre-wrap;line-height:1.9">${esc(report.body)}</div>
${notes ? `<h3 style="margin:24px 0 8px">ملاحظات المدير</h3><ul>${notes}</ul>` : ''}`;
  return htmlDocument(body, report.number);
}

/** Excel of one report (header + body + notes) [EP §14.3]. */
export async function renderReportXlsx(report: EmployeeReportDoc): Promise<Buffer> {
  const h = await headerOf(report);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(report.number, { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: 'الحقل', key: 'k', width: 24 },
    { header: 'القيمة', key: 'v', width: 90 },
  ];
  const rows: [string, unknown][] = [
    ['رقم التقرير', report.number],
    ['الموظف', `${h.employeeName} (${h.employeeNumber})`],
    ['القسم', h.departmentName],
    ['نوع التقرير', h.typeLabel],
    ['العنوان', report.title],
    ['تاريخ التقرير', riyadhDate(report.submittedAt)],
    ['من', report.periodFrom ? riyadhDate(report.periodFrom) : ''],
    ['إلى', report.periodTo ? riyadhDate(report.periodTo) : ''],
    ['المدير المستلم', h.managerName],
    ['الحالة', report.state === 'reviewed' ? 'تمت المراجعة' : 'مرسل'],
    ['التفاصيل', report.body],
  ];
  for (const n of report.notes)
    rows.push([`ملاحظة ${n.byName ?? n.byEmail ?? ''}`, `${riyadhDate(n.at)}: ${n.note}`]);
  for (const [k, v] of rows) ws.addRow({ k, v });
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
