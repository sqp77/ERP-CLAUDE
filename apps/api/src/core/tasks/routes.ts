import { Router } from 'express';
import { z } from 'zod';
import {
  assignTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  OPEN_TASK_STATUSES,
  reviewTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
} from '@eayni/shared';
import { asyncHandler } from '../http/async';
import { validate } from '../http/validate';
import { actorFrom, type AuthedRequest } from '../http/context';
import { badRequest, forbidden } from '../http/errors';
import { requireAuth } from '../auth/middleware';
import { authorize } from '../rbac/authorize';
import { scopeFilter } from '../rbac/scope';
import { recordAudit } from '../audit/service';
import { claimAttachments } from '../files/service';
import { Task, TaskEvent } from './model';
import * as svc from './service';

export const tasksRouter = Router();

tasksRouter.get(
  '/',
  requireAuth(),
  authorize('tasks', 'view'),
  validate(listTasksQuerySchema, 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = req.query as unknown as z.infer<typeof listTasksQuerySchema>;
    const userId = String(req.auth.user._id);
    const scope = await scopeFilter(req.authz!, userId, svc.TASK_SCOPE_FIELDS);
    const filter: Record<string, unknown> = { deletedAt: null, ...scope };
    if (q.status) filter.status = q.status;
    if (q.open) filter.status = { $in: [...OPEN_TASK_STATUSES] };
    if (q.assigneeId) filter.assigneeId = q.assigneeId;
    if (q.assignerId) filter.assignerId = q.assignerId;
    if (q.departmentId) filter.departmentId = q.departmentId;
    if (q.priority) filter.priority = q.priority;
    if (q.unassigned) filter.assigneeId = null;
    if (q.mine) filter.assigneeId = userId;
    if (q.dueFrom || q.dueTo)
      filter.dueAt = { ...(q.dueFrom ? { $gte: q.dueFrom } : {}), ...(q.dueTo ? { $lte: q.dueTo } : {}) };
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

/** Open / late tasks per employee (who is overloaded before assigning) [EP §16]. */
tasksRouter.get(
  '/workload',
  requireAuth(),
  authorize('tasks', 'view'),
  validate(z.object({ departmentId: z.string().optional() }), 'query'),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await svc.workload(req, (req.query as { departmentId?: string }).departmentId));
  }),
);

tasksRouter.post(
  '/',
  requireAuth(),
  authorize('tasks', 'create'),
  validate(createTaskSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    res.status(201).json(await svc.createTask(req, req.body as CreateTaskInput));
  }),
);

tasksRouter.get(
  '/:id',
  requireAuth(),
  authorize('tasks', 'view'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const task = await svc.findVisibleTask(req, req.params.id);
    res.json({ ...task.toObject(), history: await svc.taskHistory(String(task._id)) });
  }),
);

tasksRouter.patch(
  '/:id',
  requireAuth(),
  authorize('tasks', 'edit'),
  validate(updateTaskSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof updateTaskSchema>;
    const task = await svc.findVisibleTask(req, req.params.id);
    const me = String(req.auth.user._id);
    const isAssignee = !!task.assigneeId && String(task.assigneeId) === me;
    const isAssigner = String(task.assignerId) === me;
    const { status, progressPercent, attachmentIds, ...content } = body;
    const editsContent = Object.values(content).some((v) => v !== undefined);
    // An assignee may move status / progress / attachments; content edits need the assigner or a wider scope.
    if (editsContent && !isAssigner && req.authz!.scope === 'own')
      throw forbidden('يمكنك تحديث الحالة ونسبة الإنجاز فقط');
    if (!isAssignee && !isAssigner && req.authz!.scope === 'own') throw forbidden();
    if (editsContent || attachmentIds) {
      const before = task.toObject();
      if (attachmentIds) {
        await claimAttachments(attachmentIds, 'task', String(task._id), req.auth.user._id);
        task.attachmentIds = attachmentIds as never;
      }
      Object.assign(task, Object.fromEntries(Object.entries(content).filter(([, v]) => v !== undefined)));
      if (content.dueAt !== undefined) {
        // A new due date resets the reminders and recomputes "late" (review G1).
        task.remindedDueSoon = false;
        task.remindedOverdue = false;
        const isOpen = (OPEN_TASK_STATUSES as readonly string[]).includes(task.status);
        if (isOpen && task.status !== 'waiting_review' && task.dueAt && task.dueAt < new Date())
          task.status = 'late';
        else if (task.status === 'late') {
          // Back to the status it had before the job marked it late.
          const flip = await TaskEvent.findOne({ taskId: task._id, type: 'status_changed', toStatus: 'late' })
            .sort({ at: -1 })
            .lean();
          task.status =
            (flip?.fromStatus as typeof task.status | undefined) ??
            (task.progressPercent > 0 ? 'in_progress' : 'new');
        }
      }
      await task.save();
      await recordAudit(actorFrom(req), {
        action: 'update',
        resource: 'tasks',
        resourceId: String(task._id),
        before,
        after: task,
      });
    }
    const result =
      status || progressPercent !== undefined
        ? await svc.changeStatus(req, task, status ?? (task.status as never), progressPercent)
        : task;
    res.json(result);
  }),
);

/** Assign from the department queue or reassign with a reason [EP §16]. */
tasksRouter.post(
  '/:id/assign',
  requireAuth(),
  authorize('tasks', 'edit'),
  validate(assignTaskSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.authz!.scope === 'own') throw forbidden('الإسناد من صلاحية المدير');
    const task = await svc.findVisibleTask(req, req.params.id);
    const { assigneeId, reason } = req.body as z.infer<typeof assignTaskSchema>;
    res.json(await svc.assignTask(req, task, assigneeId, reason));
  }),
);

/** The assigner approves a finished task or returns it with a note [EP §16]. */
tasksRouter.post(
  '/:id/review',
  requireAuth(),
  authorize('tasks', 'edit'),
  validate(reviewTaskSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const task = await svc.findVisibleTask(req, req.params.id);
    const { approve, note } = req.body as z.infer<typeof reviewTaskSchema>;
    if (approve === undefined) throw badRequest('approve مطلوب');
    res.json(await svc.reviewTask(req, task, approve, note));
  }),
);
