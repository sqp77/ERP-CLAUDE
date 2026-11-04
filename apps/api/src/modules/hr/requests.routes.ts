import { Router } from 'express';
import type { z } from 'zod';
import {
  createHrRequestSchema,
  DEFAULT_HR_REQUEST_ROUTES,
  HR_REQUEST_TYPE_AR,
  HR_REQUEST_TYPES,
  hrRequestTransitionSchema,
  listHrRequestsQuerySchema,
  type CreateHrRequestInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { notFound } from '../../core/http/errors';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { getSetting } from '../../core/settings/service';
import { storage } from '../../core/files/storage';
import { Attachment } from '../../core/files/model';
import { recordAudit } from '../../core/audit/service';
import { Employee } from './model';
import { HrRequest } from './requests.model';
import * as svc from './requests.service';

export const requestsRouter = Router();

/** Types and routing for the "رفع طلب" form [EP §11]. */
requestsRouter.get(
  '/types',
  requireAuth(),
  asyncHandler(async (_req, res) => {
    const routes = await getSetting('hr.requestRoutes');
    const limit = await getSetting('hr.advanceLimitHalalas');
    res.json({
      items: HR_REQUEST_TYPES.map((type) => ({
        type,
        labelAr: HR_REQUEST_TYPE_AR[type],
        route: routes[type] ?? DEFAULT_HR_REQUEST_ROUTES[type],
      })),
      advanceLimitHalalas: limit,
    });
  }),
);

requestsRouter.post(
  '/',
  requireAuth(),
  authorize('hr.requests', 'create'),
  validate(createHrRequestSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await svc.createRequest(req.auth.user, req.body as CreateHrRequestInput, actorFrom(req));
    res.status(201).json(r);
  }),
);

requestsRouter.get(
  '/',
  requireAuth(),
  authorize('hr.requests', 'view'),
  validate(listHrRequestsQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listHrRequestsQuerySchema>;
    const user = req.auth.user;
    const filter: Record<string, unknown> = {
      deletedAt: null,
      ...(await svc.visibilityFilter(user, req.authz!)),
    };
    if (q.view === 'mine') filter.requesterUserId = user._id;
    if (q.view === 'inbox')
      Object.assign(filter, { directManagerUserId: user._id, state: 'awaiting_manager' });
    if (q.view === 'queue') {
      const roles = user.roles.map((r) => r.role);
      const isFinance = roles.some((r) => ['finance_staff', 'finance_manager'].includes(r));
      const isHr = roles.some((r) => ['hr_officer', 'hr_manager'].includes(r));
      filter.pendingWith =
        isHr && isFinance
          ? { $in: ['hr', 'finance'] }
          : isFinance
            ? 'finance'
            : isHr
              ? 'hr'
              : { $in: ['final'] };
    }
    if (q.type) filter.type = q.type;
    if (q.state) filter.state = q.state;
    if (q.open) filter.closedAt = null;
    if (q.employeeId) filter.employeeId = q.employeeId;
    const [items, total] = await Promise.all([
      HrRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      HrRequest.countDocuments(filter),
    ]);
    const employees = await Employee.find({ _id: { $in: items.map((i) => i.employeeId) } })
      .select('fullNameAr employeeNumber departmentId')
      .lean();
    const byId = new Map(employees.map((e) => [String(e._id), e]));
    res.json({
      items: items.map((i) => ({
        ...i,
        employee: byId.get(String(i.employeeId)),
        typeAr: HR_REQUEST_TYPE_AR[i.type as keyof typeof HR_REQUEST_TYPE_AR],
      })),
      total,
      page: q.page,
      limit: q.limit,
    });
  }),
);

async function visible(req: AuthedRequest, id: string) {
  const filter = await svc.visibilityFilter(req.auth.user, req.authz!);
  const r = await HrRequest.findOne({ _id: id, deletedAt: null, ...filter });
  if (!r) throw notFound('الطلب غير موجود');
  return r;
}

requestsRouter.get(
  '/:id',
  requireAuth(),
  authorize('hr.requests', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await visible(req, req.params.id);
    const [employee, history, actions, manager] = await Promise.all([
      Employee.findById(r.employeeId).select('fullNameAr employeeNumber departmentId positionId').lean(),
      svc.requestHistory(String(r._id)),
      svc.availableActions(req.auth.user, r),
      r.directManagerUserId
        ? (await import('../../core/auth/model')).User.findById(r.directManagerUserId)
            .select('displayNameAr')
            .lean()
        : null,
    ]);
    const attachments = await Attachment.find({ _id: { $in: r.attachmentIds } })
      .select('originalName mimeType size')
      .lean();
    res.json({
      ...r.toObject(),
      typeAr: HR_REQUEST_TYPE_AR[r.type as keyof typeof HR_REQUEST_TYPE_AR],
      employee,
      directManager: manager,
      history,
      actions,
      attachments,
    });
  }),
);

requestsRouter.post(
  '/:id/transition',
  requireAuth(),
  authorize('hr.requests', 'view'),
  validate(hrRequestTransitionSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await visible(req, req.params.id);
    const body = req.body as z.infer<typeof hrRequestTransitionSchema>;
    const relations = await svc.relationsFor(req.auth.user, r);
    const updated = await svc.transition(r, body.transition, {
      user: req.auth.user,
      actor: actorFrom(req),
      relations,
      reason: body.reason,
      details: body.details,
      attachmentIds: body.attachmentIds,
    });
    res.json({ ...updated.toObject(), actions: await svc.availableActions(req.auth.user, updated) });
  }),
);

/** Download the issued certificate (HTML now; PDF once the renderer exists). Audited as a sensitive download. */
requestsRouter.get(
  '/:id/certificate',
  requireAuth(),
  authorize('hr.requests', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const r = await visible(req, req.params.id);
    if (!r.certificate?.attachmentId) throw notFound('لم تُصدر الشهادة بعد');
    const att = await Attachment.findById(r.certificate.attachmentId).lean();
    if (!att) throw notFound();
    const out = await storage().createDownloadUrl(att.key, att.originalName, att.mimeType);
    await recordAudit(actorFrom(req), {
      action: 'download',
      resource: 'hr.certificates',
      resourceId: r.certificate.number ?? undefined,
      sensitive: true,
      meta: { requestId: String(r._id) },
    });
    res.json({ ...out, number: r.certificate.number });
  }),
);
