import { z } from 'zod';
import { objectIdSchema } from './common';

/** News & circulars [EP §12]: draft → (approval) → published → archived. */
export const NEWS_STATES = ['draft', 'pending_approval', 'published', 'rejected', 'archived'] as const;
export type NewsState = (typeof NEWS_STATES)[number];

export const createNewsSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(20000),
  /** Publishing department; defaults to the author's department. HR / executive may publish for any. */
  departmentCode: z.string().trim().min(1).optional(),
  audienceAll: z.boolean().default(true),
  audienceDepartmentIds: z.array(objectIdSchema).default([]),
  pinned: z.boolean().default(false),
  publishFrom: z.coerce.date().nullable().optional(),
  publishTo: z.coerce.date().nullable().optional(),
  attachmentIds: z.array(objectIdSchema).default([]),
  coverAttachmentId: objectIdSchema.nullable().optional(),
});
export type CreateNewsInput = z.infer<typeof createNewsSchema>;
export const updateNewsSchema = createNewsSchema.partial();
export const newsDecisionSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(1000).optional(),
});
export const listNewsQuerySchema = z.object({
  /** feed = published now for me; archive = past items; manage = my department's items in any state. */
  view: z.enum(['feed', 'archive', 'manage', 'pending']).default('feed'),
  departmentCode: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
