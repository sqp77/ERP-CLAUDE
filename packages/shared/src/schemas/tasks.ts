import { z } from 'zod';
import { PRIORITIES, TASK_STATUSES } from '../enums';
import { objectIdSchema } from './common';

/** Record types a task may link to [EP §10 "رابط إلى مصدرها"]; customers etc. come with their modules. */
export const TASK_SOURCE_TYPES = ['hr_request', 'ticket'] as const;
export type TaskSourceType = (typeof TASK_SOURCE_TYPES)[number];

/**
 * Tasks [EP §10, MKT §11, EP §16]. One store; every task links to its source record. The department
 * is set by the server from the assignee (or must be a department the actor manages for a queue task).
 */
export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  /** Empty = the department queue; the manager distributes it later. */
  assigneeId: objectIdSchema.optional(),
  departmentId: objectIdSchema.optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  startAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  source: z
    .object({ type: z.enum(TASK_SOURCE_TYPES), id: z.string().trim().min(1), label: z.string().optional() })
    .optional(),
  attachmentIds: z.array(objectIdSchema).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Status and content edits; assignment moves through /assign, review through /review. */
export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  startAt: z.coerce.date().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  attachmentIds: z.array(objectIdSchema).optional(),
});
export const assignTaskSchema = z.object({
  assigneeId: objectIdSchema,
  /** Required when the task already had an assignee (reassignment). */
  reason: z.string().trim().max(1000).optional(),
});
export const reviewTaskSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});
export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: objectIdSchema.optional(),
  assignerId: objectIdSchema.optional(),
  departmentId: objectIdSchema.optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  unassigned: z.coerce.boolean().optional(),
  open: z.coerce.boolean().optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(25),
});
export const OPEN_TASK_STATUSES = ['new', 'in_progress', 'waiting_review', 'late'] as const;
