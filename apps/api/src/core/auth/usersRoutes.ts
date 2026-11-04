import { Router } from 'express';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@eayni/shared';
import { z } from 'zod';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { badRequest, notFound } from '../http/errors';
import { recordAudit } from '../audit/service';
import { authorize } from '../rbac/authorize';
import { loadRoles } from '../rbac/service';
import { hashPassword, randomToken } from './crypto';
import { requireAuth } from './middleware';
import { LoginLog, User } from './model';
import { revokeAllSessions } from './session';
import { validatePasswordPolicy } from './service';

export const usersRouter = Router();

const PUBLIC =
  'email displayNameAr status roles departmentId employeeId totpEnabled lastLoginAt mustChangePassword createdAt updatedAt';

async function assertRolesExist(roles: { role: string }[]) {
  const known = await loadRoles();
  const missing = roles.map((r) => r.role).filter((r) => !known.has(r));
  if (missing.length) throw badRequest(`أدوار غير معروفة: ${missing.join(', ')}`);
}

usersRouter.get(
  '/',
  requireAuth(),
  authorize('users', 'view'),
  validate(listUsersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listUsersQuerySchema>;
    const filter: Record<string, unknown> = { deletedAt: null };
    if (q.status) filter.status = q.status;
    if (q.role) filter['roles.role'] = q.role;
    if (q.q) filter.$or = [{ email: new RegExp(q.q, 'i') }, { displayNameAr: new RegExp(q.q, 'i') }];
    const [items, total] = await Promise.all([
      User.find(filter)
        .select(PUBLIC)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);

usersRouter.post(
  '/',
  requireAuth(),
  authorize('users', 'create'),
  validate(createUserSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as CreateUserInput;
    await assertRolesExist(body.roles);
    const password = body.password ?? randomToken(9);
    await validatePasswordPolicy(password);
    const user = await User.create({
      email: body.email,
      displayNameAr: body.displayNameAr,
      passwordHash: await hashPassword(password),
      roles: body.roles,
      employeeId: body.employeeId,
      departmentId: body.departmentId,
      mustChangePassword: !body.password,
    });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'users',
      resourceId: String(user._id),
      after: user,
    });
    const out = await User.findById(user._id).select(PUBLIC).lean();
    // The temporary password is returned once so the admin can hand it over; it is never stored or logged.
    res.status(201).json({ ...out, temporaryPassword: body.password ? undefined : password });
  }),
);

usersRouter.get(
  '/:id',
  requireAuth(),
  authorize('users', 'view'),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null }).select(PUBLIC).lean();
    if (!user) throw notFound();
    res.json(user);
  }),
);

usersRouter.patch(
  '/:id',
  requireAuth(),
  authorize('users', 'edit'),
  validate(updateUserSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as UpdateUserInput;
    const before = await User.findOne({ _id: req.params.id, deletedAt: null });
    if (!before) throw notFound();
    if (body.roles) await assertRolesExist(body.roles);
    if (body.status === 'disabled' && String(before._id) === String(req.auth.user._id))
      throw badRequest('لا يمكنك تعطيل حسابك');
    const snapshot = before.toObject();
    Object.assign(before, body);
    if (body.status === 'disabled' && snapshot.status !== 'disabled') before.disabledAt = new Date();
    if (body.status === 'active') before.disabledAt = undefined;
    await before.save();
    if (body.status === 'disabled') await revokeAllSessions(String(before._id), 'account_disabled');
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'users',
      resourceId: String(before._id),
      before: snapshot,
      after: before,
    });
    res.json(await User.findById(before._id).select(PUBLIC).lean());
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requireAuth(),
  authorize('users', 'edit'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await User.findOne({ _id: req.params.id, deletedAt: null });
    if (!user) throw notFound();
    const password = randomToken(9);
    user.passwordHash = await hashPassword(password);
    user.mustChangePassword = true;
    user.passwordChangedAt = new Date();
    await user.save();
    await revokeAllSessions(String(user._id), 'admin_reset');
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'users',
      resourceId: String(user._id),
      meta: { adminPasswordReset: true },
    });
    res.json({ temporaryPassword: password });
  }),
);

usersRouter.get(
  '/:id/login-log',
  requireAuth(),
  authorize('users', 'view'),
  validate(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), 'query'),
  asyncHandler(async (req, res) => {
    const limit = (req.query as unknown as { limit: number }).limit;
    res.json({ items: await LoginLog.find({ userId: req.params.id }).sort({ at: -1 }).limit(limit).lean() });
  }),
);
