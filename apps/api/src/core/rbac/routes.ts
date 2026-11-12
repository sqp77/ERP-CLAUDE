import { Router } from 'express';
import { z } from 'zod';
import { ACTIONS, SCOPES } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { badRequest, forbidden, notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { recordAudit } from '../audit/service';
import { authorize } from './authorize';
import { Role } from './model';
import { clearRoleCache } from './service';

export const rolesRouter = Router();

const grantSchema = z.object({
  resource: z.string().min(1),
  actions: z.array(z.enum(ACTIONS)).min(1),
  scope: z.enum(SCOPES),
});
const fieldRuleSchema = z.object({
  resource: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
  view: z.boolean(),
  edit: z.boolean(),
});
/**
 * Nobody edits or deletes a role they hold (DECISIONS §20 change 2): an admin could otherwise widen their own
 * rights through the role's grants. Refused with 403 `own_role` and audited.
 */
async function refuseOwnRole(req: AuthedRequest, code: string, action: 'update' | 'delete'): Promise<void> {
  if (!req.auth.roleCodes.includes(code)) return;
  await recordAudit(actorFrom(req), {
    action,
    resource: 'roles',
    resourceId: code,
    meta: { refused: 'own_role' },
  });
  throw forbidden('لا يمكنك تعديل دور تحمله بنفسك', 'own_role');
}

const roleBody = z.object({
  code: z.string().regex(/^[a-z0-9_]{2,40}$/),
  nameAr: z.string().trim().min(2),
  departmentScoped: z.boolean().default(false),
  grants: z.array(grantSchema).default([]),
  fieldRules: z.array(fieldRuleSchema).default([]),
});

rolesRouter.get(
  '/',
  requireAuth(),
  authorize('roles', 'view'),
  asyncHandler(async (_req, res) => {
    res.json({ items: await Role.find().sort({ code: 1 }).lean() });
  }),
);

rolesRouter.post(
  '/',
  requireAuth(),
  authorize('roles', 'create'),
  validate(roleBody),
  asyncHandler(async (req: AuthedRequest, res) => {
    const role = await Role.create({ ...req.body, system: false });
    clearRoleCache();
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'roles',
      resourceId: role.code,
      after: role,
    });
    res.status(201).json(role);
  }),
);

rolesRouter.put(
  '/:code',
  requireAuth(),
  authorize('roles', 'edit'),
  validate(roleBody.omit({ code: true })),
  asyncHandler(async (req: AuthedRequest, res) => {
    const before = await Role.findOne({ code: req.params.code }).lean();
    if (!before) throw notFound();
    await refuseOwnRole(req, req.params.code, 'update');
    const role = await Role.findOneAndUpdate(
      { code: req.params.code },
      { $set: req.body },
      { new: true },
    ).lean();
    clearRoleCache();
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'roles',
      resourceId: req.params.code,
      before,
      after: role,
    });
    res.json(role);
  }),
);

rolesRouter.delete(
  '/:code',
  requireAuth(),
  authorize('roles', 'delete'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const role = await Role.findOne({ code: req.params.code }).lean();
    if (!role) throw notFound();
    if (role.system) throw badRequest('لا يمكن حذف دور نظامي');
    await refuseOwnRole(req, req.params.code, 'delete');
    await Role.deleteOne({ code: req.params.code });
    clearRoleCache();
    await recordAudit(actorFrom(req), {
      action: 'delete',
      resource: 'roles',
      resourceId: req.params.code,
      before: role,
    });
    res.status(204).end();
  }),
);
