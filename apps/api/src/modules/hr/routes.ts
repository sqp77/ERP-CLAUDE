import { Router } from 'express';
import type { z } from 'zod';
import {
  changeManagerSchema,
  changeStatusSchema,
  contractAddendumSchema,
  contractSchema,
  contractStatusSchema,
  createEmployeeSchema,
  custodyReturnSchema,
  custodySchema,
  listEmployeesQuerySchema,
  promoteEmployeeSchema,
  transferEmployeeSchema,
  updateEmployeeSchema,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from '@eayni/shared';
import { asyncHandler } from '../../core/http/async';
import { validate } from '../../core/http/validate';
import { actorFrom, type AuthedRequest } from '../../core/http/context';
import { forbidden, notFound } from '../../core/http/errors';
import { requireAuth } from '../../core/auth/middleware';
import { authorize } from '../../core/rbac/authorize';
import { recordAudit } from '../../core/audit/service';
import { nextNumber } from '../../core/numbering/service';
import { Contract, Custody, Employee } from './model';
import * as hr from './service';

export const hrRouter = Router();

/** Load an employee the viewer may see, or 404 (never reveal existence outside scope). */
async function visibleEmployee(req: AuthedRequest, id: string) {
  const filter = await hr.employeeScopeFilter(req.authz!, req.auth.user);
  const e = await Employee.findOne({ _id: id, deletedAt: null, ...filter });
  if (!e) throw notFound('الموظف غير موجود');
  return e;
}

async function serializeFor(req: AuthedRequest, e: InstanceType<typeof Employee>) {
  const self = !!e.userId && String(e.userId) === String(req.auth.user._id);
  const hidden = await hr.viewerRestrictions(req.auth.user);
  const out = hr.serializeEmployee(e, { self, hidden });
  if (!self && hr.revealsSensitive(out)) {
    await recordAudit(actorFrom(req), {
      action: 'view',
      resource: 'hr.employees',
      resourceId: String(e._id),
      sensitive: true,
    });
  }
  return out;
}

// ---------- employees ----------
hrRouter.get(
  '/employees',
  requireAuth(),
  authorize('hr.employees', 'view'),
  validate(listEmployeesQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listEmployeesQuerySchema>;
    const filter: Record<string, unknown> = {
      deletedAt: null,
      ...(await hr.employeeScopeFilter(req.authz!, req.auth.user)),
    };
    if (q.departmentId) filter.departmentId = q.departmentId;
    if (q.branchId) filter.branchId = q.branchId;
    if (q.status) filter.status = q.status;
    if (q.managerId) filter.directManagerId = q.managerId;
    if (q.q)
      filter.$and = [
        {
          $or: [
            { fullNameAr: new RegExp(q.q, 'i') },
            { employeeNumber: new RegExp(q.q, 'i') },
            { workEmail: new RegExp(q.q, 'i') },
          ],
        },
      ];
    const [docs, total] = await Promise.all([
      Employee.find(filter)
        .sort({ fullNameAr: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Employee.countDocuments(filter),
    ]);
    // Directory rows are never sensitive: list view shows public fields only.
    const items = docs.map((d) => ({
      _id: d._id,
      employeeNumber: d.employeeNumber,
      fullNameAr: d.fullNameAr,
      workEmail: d.workEmail,
      mobile: d.mobile,
      departmentId: d.departmentId,
      unitId: d.unitId,
      positionId: d.positionId,
      branchId: d.branchId,
      directManagerId: d.directManagerId,
      employmentType: d.employmentType,
      status: d.status,
      hireDate: d.hireDate,
      userId: d.userId,
    }));
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);

hrRouter.post(
  '/employees',
  requireAuth(),
  authorize('hr.employees', 'create'),
  validate(createEmployeeSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { employee, temporaryPassword } = await hr.createEmployee(
      req.body as CreateEmployeeInput,
      actorFrom(req),
    );
    res.status(201).json({ ...(await serializeFor(req, employee)), temporaryPassword });
  }),
);

/** The signed-in employee's own file (portal profile, EP §5). */
hrRouter.get(
  '/employees/me',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await hr.employeeOfUser(String(req.auth.user._id));
    if (!e) throw notFound('لا يوجد ملف موظف مرتبط بحسابك');
    res.json(hr.serializeEmployee(e, { self: true, hidden: new Set() }));
  }),
);

hrRouter.get(
  '/employees/:id',
  requireAuth(),
  authorize('hr.employees', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const e = await visibleEmployee(req, req.params.id);
    res.json(await serializeFor(req, e));
  }),
);

hrRouter.patch(
  '/employees/:id',
  requireAuth(),
  authorize('hr.employees', 'edit'),
  validate(updateEmployeeSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    await visibleEmployee(req, req.params.id);
    const e = await hr.updateEmployee(req.params.id, req.body as UpdateEmployeeInput, actorFrom(req));
    res.json(await serializeFor(req, e));
  }),
);

const action = (
  path: string,
  schema: z.ZodTypeAny,
  fn: (
    id: string,
    body: never,
    actor: ReturnType<typeof actorFrom>,
  ) => Promise<InstanceType<typeof Employee>>,
) =>
  hrRouter.post(
    `/employees/:id/${path}`,
    requireAuth(),
    authorize('hr.employees', 'edit'),
    validate(schema),
    asyncHandler(async (req: AuthedRequest, res) => {
      await visibleEmployee(req, req.params.id);
      const e = await fn(req.params.id, req.body as never, actorFrom(req));
      res.json(await serializeFor(req, e));
    }),
  );
action('transfer', transferEmployeeSchema, hr.transferEmployee);
action('promote', promoteEmployeeSchema, hr.promoteEmployee);
action('manager', changeManagerSchema, hr.changeManager);
action('status', changeStatusSchema, hr.changeStatus);

hrRouter.get(
  '/employees/:id/history',
  requireAuth(),
  authorize('hr.employees', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    await visibleEmployee(req, req.params.id);
    res.json({ items: await hr.employeeHistory(req.params.id) });
  }),
);

hrRouter.get(
  '/employees/:id/reports',
  requireAuth(),
  authorize('hr.employees', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    await visibleEmployee(req, req.params.id);
    const items = await Employee.find({ directManagerId: req.params.id, deletedAt: null })
      .select('employeeNumber fullNameAr positionId departmentId status userId')
      .lean();
    res.json({ items });
  }),
);

// ---------- custody [HR §3.3] ----------
hrRouter.get(
  '/employees/:id/custody',
  requireAuth(),
  authorize('hr.custody', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (
      !(await hr.canAccessEmployee({ ...req.authz!, resource: 'hr.employees' }, req.auth.user, req.params.id))
    )
      throw notFound();
    res.json({ items: await Custody.find({ employeeId: req.params.id }).sort({ issuedAt: -1 }).lean() });
  }),
);

hrRouter.post(
  '/employees/:id/custody',
  requireAuth(),
  authorize('hr.custody', 'create'),
  validate(custodySchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    await hr.getEmployeeOrThrow(req.params.id);
    const c = await Custody.create({ ...req.body, employeeId: req.params.id, issuedBy: req.auth.user._id });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'hr.custody',
      resourceId: String(c._id),
      after: c,
    });
    res.status(201).json(c);
  }),
);

hrRouter.post(
  '/employees/:id/custody/:cid/return',
  requireAuth(),
  authorize('hr.custody', 'edit'),
  validate(custodyReturnSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const c = await Custody.findOne({ _id: req.params.cid, employeeId: req.params.id });
    if (!c) throw notFound();
    const before = c.toObject();
    Object.assign(c, req.body);
    await c.save();
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'hr.custody',
      resourceId: String(c._id),
      before,
      after: c,
    });
    res.json(c);
  }),
);

// ---------- contracts [HR §3.9, EP §6] ----------
hrRouter.get(
  '/employees/:id/contracts',
  requireAuth(),
  authorize('hr.contracts', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (
      !(await hr.canAccessEmployee({ ...req.authz!, resource: 'hr.employees' }, req.auth.user, req.params.id))
    )
      throw notFound();
    res.json({ items: await Contract.find({ employeeId: req.params.id }).sort({ startDate: -1 }).lean() });
  }),
);

hrRouter.post(
  '/employees/:id/contracts',
  requireAuth(),
  authorize('hr.contracts', 'create'),
  validate(contractSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    await hr.getEmployeeOrThrow(req.params.id);
    const body = req.body as z.infer<typeof contractSchema>;
    if (body.endDate && body.endDate < body.startDate)
      throw forbidden('تاريخ النهاية قبل البداية', 'bad_request');
    const previous = await Contract.findOne({
      employeeId: req.params.id,
      status: { $in: ['active', 'renewing'] },
    }).sort({ version: -1 });
    const c = await Contract.create({
      ...body,
      employeeId: req.params.id,
      number: await nextNumber('contract'),
      version: (previous?.version ?? 0) + 1,
      previousId: previous?._id,
      createdBy: req.auth.user._id,
    });
    if (previous) {
      previous.status = 'expired';
      previous.statusReason = 'renewed';
      await previous.save();
    }
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'hr.contracts',
      resourceId: String(c._id),
      after: c,
    });
    const emp = await Employee.findById(req.params.id).select('userId').lean();
    if (emp?.userId) {
      const { notify } = await import('../../core/notifications/service');
      await notify({
        userIds: [String(emp.userId)],
        type: 'generic',
        titleAr: previous ? 'تم تجديد عقدك' : 'تمت إضافة عقد عمل إلى ملفك',
        link: '/me/profile',
      });
    }
    res.status(201).json(c);
  }),
);

hrRouter.post(
  '/employees/:id/contracts/:cid/addenda',
  requireAuth(),
  authorize('hr.contracts', 'edit'),
  validate(contractAddendumSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const c = await Contract.findOne({ _id: req.params.cid, employeeId: req.params.id });
    if (!c) throw notFound();
    c.addenda.push({
      ...(req.body as z.infer<typeof contractAddendumSchema>),
      addedAt: new Date(),
      addedBy: req.auth.user._id,
    } as never);
    await c.save();
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'hr.contracts',
      resourceId: String(c._id),
      meta: { addendum: (req.body as { titleAr: string }).titleAr },
    });
    res.json(c);
  }),
);

hrRouter.patch(
  '/employees/:id/contracts/:cid/status',
  requireAuth(),
  authorize('hr.contracts', 'edit'),
  validate(contractStatusSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const c = await Contract.findOne({ _id: req.params.cid, employeeId: req.params.id });
    if (!c) throw notFound();
    const before = c.toObject();
    const body = req.body as z.infer<typeof contractStatusSchema>;
    c.status = body.status;
    c.statusReason = body.reason;
    await c.save();
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'hr.contracts',
      resourceId: String(c._id),
      before: { status: before.status },
      after: { status: c.status },
    });
    res.json(c);
  }),
);
