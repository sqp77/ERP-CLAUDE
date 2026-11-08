import { Router } from 'express';
import type { z } from 'zod';
import {
  arabicSearchRegex,
  createEmployeeReportSchema,
  listEmployeeReportsQuerySchema,
  reportNoteSchema,
  requestReportSchema,
  type CreateEmployeeReportInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { forbidden } from '../../core/http/errors';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { recordAudit } from '../../core/audit/service';
import { sendHtml } from '../../core/templates/render';
import { Attachment } from '../../core/files/model';
import { User } from '../../core/auth/model';
import { Employee } from './model';
import { EmployeeReport, ReportRequest } from './reports.model';
import * as svc from './reports.service';

export const employeeReportsRouter = Router();

employeeReportsRouter.get(
  '/types',
  requireAuth(),
  asyncHandler(async (_req, res) => res.json({ items: await svc.reportTypes() })),
);

/** Reports the manager asked me for and I have not sent yet. */
employeeReportsRouter.get(
  '/requests',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const items = await ReportRequest.find({ employeeUserId: req.auth.user._id, fulfilledReportId: null })
      .sort({ createdAt: -1 })
      .lean();
    const mgrs = await User.find({ _id: { $in: items.map((i) => i.managerUserId) } })
      .select('displayNameAr')
      .lean();
    const names = new Map(mgrs.map((m) => [String(m._id), m.displayNameAr]));
    res.json({ items: items.map((i) => ({ ...i, managerName: names.get(String(i.managerUserId)) })) });
  }),
);

employeeReportsRouter.post(
  '/requests',
  requireAuth(),
  authorize('hr.reports', 'view'),
  validate(requestReportSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.authz!.scope === 'own') throw forbidden('طلب التقارير من صلاحية المدير');
    res.status(201).json(await svc.requestReport(req, req.body as z.infer<typeof requestReportSchema>));
  }),
);

employeeReportsRouter.post(
  '/',
  requireAuth(),
  authorize('hr.reports', 'create'),
  validate(createEmployeeReportSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.submitReport(req, req.body as CreateEmployeeReportInput));
  }),
);

employeeReportsRouter.get(
  '/',
  requireAuth(),
  authorize('hr.reports', 'view'),
  validate(listEmployeeReportsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listEmployeeReportsQuerySchema>;
    const filter: Record<string, unknown> = {
      deletedAt: null,
      ...(await svc.visibilityFilter(req.auth.user, req.authz!)),
    };
    if (q.view === 'mine') filter.userId = req.auth.user._id;
    if (q.view === 'team') filter.userId = { $ne: req.auth.user._id };
    if (q.employeeId) filter.employeeId = q.employeeId;
    if (q.type) filter.type = q.type;
    if (q.from || q.to)
      filter.submittedAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (q.q) filter.title = arabicSearchRegex(q.q);
    const [items, total] = await Promise.all([
      EmployeeReport.find(filter)
        .sort({ submittedAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .select('-body')
        .lean(),
      EmployeeReport.countDocuments(filter),
    ]);
    const emps = await Employee.find({ _id: { $in: items.map((i) => i.employeeId) } })
      .select('fullNameAr employeeNumber')
      .lean();
    const byId = new Map(emps.map((e) => [String(e._id), e]));
    res.json({
      items: items.map((i) => ({ ...i, employee: byId.get(String(i.employeeId)) })),
      total,
      page: q.page,
      limit: q.limit,
    });
  }),
);

employeeReportsRouter.get(
  '/:id',
  requireAuth(),
  authorize('hr.reports', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await svc.findVisible(req, req.params.id);
    const [attachments, employee, manager] = await Promise.all([
      Attachment.find({ _id: { $in: r.attachmentIds } })
        .select('originalName mimeType size')
        .lean(),
      Employee.findById(r.employeeId).select('fullNameAr employeeNumber departmentId').lean(),
      r.managerUserId ? User.findById(r.managerUserId).select('displayNameAr').lean() : null,
    ]);
    res.json({
      ...r.toObject(),
      attachments,
      employee,
      managerName: manager?.displayNameAr,
      canNote: String(r.userId) !== String(req.auth.user._id),
    });
  }),
);

employeeReportsRouter.post(
  '/:id/notes',
  requireAuth(),
  authorize('hr.reports', 'view'),
  validate(reportNoteSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await svc.findVisible(req, req.params.id);
    res.json(await svc.addNote(req, r, (req.body as { note: string }).note));
  }),
);

/** Export one report: printable HTML (PDF from the browser) or Excel [EP §14.3]; audited. */
employeeReportsRouter.get(
  '/:id/export',
  requireAuth(),
  authorize('hr.reports', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await svc.findVisible(req, req.params.id);
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'html';
    await recordAudit(actorFrom(req), {
      action: 'export',
      resource: 'hr.reports',
      resourceId: String(r._id),
      meta: { format },
    });
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(`${r.number}.xlsx`)}`,
      );
      res.send(await svc.renderReportXlsx(r));
      return;
    }
    sendHtml(res, await svc.renderReportHtml(r));
  }),
);
