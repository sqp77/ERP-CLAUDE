import { z } from 'zod';
import { objectIdSchema } from './common';

/** Files: browser → storage directly via a presigned URL (CLAUDE.md "Serverless rules"). */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
] as const;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const presignUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  ownerType: z.string().trim().min(1).optional(),
  ownerId: z.string().trim().min(1).optional(),
  sensitive: z.boolean().default(false),
});

export const createCommentSchema = z.object({
  recordType: z.string().min(1),
  recordId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  mentionUserIds: z.array(objectIdSchema).default([]),
  attachmentIds: z.array(objectIdSchema).default([]),
  departmentId: objectIdSchema.optional(),
  internal: z.boolean().default(true),
});

export const saveDraftSchema = z.object({
  formKey: z.string().min(1).max(100),
  recordId: z.string().optional(),
  data: z.record(z.unknown()),
});

export const createDocumentSchema = z.object({
  ownerType: z.string().min(1),
  ownerId: z.string().min(1),
  type: z.string().min(1),
  titleAr: z.string().trim().min(1),
  attachmentId: objectIdSchema,
  issueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  alertOffsetsDays: z.array(z.number().int().min(0)).optional(),
  /** Omitted → decided by type on the server: identity / contract / bank_proof always, 'other' by default (HR may untick). */
  sensitive: z.boolean().optional(),
});

export const exportRequestSchema = z.object({
  resource: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
  filters: z.record(z.unknown()).default({}),
  format: z.enum(['xlsx', 'pdf', 'preview']).default('preview'),
  limit: z.number().int().min(1).max(5000).default(1000),
});
