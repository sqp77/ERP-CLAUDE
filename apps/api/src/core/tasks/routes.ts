import { Router } from 'express';
import type { z } from 'zod';
import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { forbidden, notFound } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { scopeFilter } from '../rbac/scope';
import { recordAudit } from '../audit/service';
import { nextNumber } from '../numbering/service';
import { notify } from '../notifications/service';
import { publish } from '../outbox/service';
import { Task } from './model';

export const tasksRouter = Router();
const FIELDS = { ownerFields: ['assigneeId', 'assignerId'], departmentField: 'departmentId' };

tasksRouter.get(
  '/',
  requireAuth(),
  authorize('tasks', 'view'),
  validate(listTasksQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listTasksQuerySchema>;
    const userId = String(req.auth.user._id);
    const scope = await scopeFilter(req.authz!, userId, FIELDS);
    const filter: Record<string, unknown> = { deletedAt: null, ...scope };
    if (q.status) filter.status = q.status;
    if (q.assigneeId) filter.assigneeId = q.assigneeId;
    if (q.mine) filter.assigneeId = userId;
    const [items, total] = await Promise.all([
      Task.find(filter)
        .sort({ dueAt: 1, createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Task.countDocuments(filter),
    ]);
    res.json({ items, total, page: q.page, limit: q.limit });
  }),
);

tasksRouter.post(
  '/',
  requireAuth(),
  authorize('tasks', 'create'),
  validate(createTaskSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof createTaskSchema>;
    const number = await nextNumber('task');
    const task = await Task.create({
      ...body,
      number,
      assignerId: req.auth.user._id,
      departmentId: body.departmentId ?? req.auth.user.departmentId,
    });
    await recordAudit(actorFrom(req), {
      action: 'create',
      resource: 'tasks',
      resourceId: String(task._id),
      after: task,
    });
    await publish({
      type: 'core.task.assigned',
      aggregateType: 'task',
      aggregateId: String(task._id),
      payload: { assigneeId: body.assigneeId },
      actorUserId: String(req.auth.user._id),
    });
    await notify({
      userIds: [body.assigneeId],
      type: 'task.assigned',
      bodyAr: `${task.number}: ${task.title}`,
      link: `/tasks/${task._id}`,
      data: { taskId: String(task._id) },
    });
    res.status(201).json(task);
  }),
);

tasksRouter.get(
  '/:id',
  requireAuth(),
  authorize('tasks', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const scope = await scopeFilter(req.authz!, String(req.auth.user._id), FIELDS);
    const task = await Task.findOne({ _id: req.params.id, deletedAt: null, ...scope }).lean();
    if (!task) throw notFound();
    res.json(task);
  }),
);

tasksRouter.patch(
  '/:id',
  requireAuth(),
  authorize('tasks', 'edit'),
  validate(updateTaskSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof updateTaskSchema>;
    const scope = await scopeFilter(req.authz!, String(req.auth.user._id), FIELDS);
    const task = await Task.findOne({ _id: req.params.id, deletedAt: null, ...scope });
    if (!task) throw notFound();
    const isAssignee = String(task.assigneeId) === String(req.auth.user._id);
    // An assignee with 'own' scope may only move status/progress; reassigning needs wider scope.
    if (req.authz!.scope === 'own' && isAssignee && (body.assigneeId || body.title || body.dueAt))
      throw forbidden('يمكنك تحديث الحالة ونسبة الإنجاز فقط');
    const before = task.toObject();
    Object.assign(task, body);
    if (body.status === 'done') {
      task.completedAt = new Date();
      task.progressPercent = 100;
    }
    await task.save();
    await recordAudit(actorFrom(req), {
      action: 'update',
      resource: 'tasks',
      resourceId: String(task._id),
      before,
      after: task,
    });
    if (body.assigneeId && String(before.assigneeId) !== body.assigneeId) {
      await notify({
        userIds: [body.assigneeId],
        type: 'task.assigned',
        bodyAr: `${task.number}: ${task.title}`,
        link: `/tasks/${task._id}`,
      });
    }
    res.json(task);
  }),
);
