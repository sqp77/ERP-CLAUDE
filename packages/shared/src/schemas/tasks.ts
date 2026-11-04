import { z } from 'zod';
import { PRIORITIES, TASK_STATUSES } from '../enums';
import { objectIdSchema } from './common';

/** Tasks [EP §10, MKT §11]. One store; every task links to its source record. */
export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  assigneeId: objectIdSchema,
  priority: z.enum(PRIORITIES).default('medium'),
  startAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  departmentId: objectIdSchema.optional(),
  source: z
    .object({ type: z.string().min(1), id: z.string().min(1), label: z.string().optional() })
    .optional(),
  attachmentIds: z.array(objectIdSchema).default([]),
});
export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(TASK_STATUSES).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
});
export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: objectIdSchema.optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});
