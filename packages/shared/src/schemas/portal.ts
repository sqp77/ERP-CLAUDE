import { z } from 'zod';
import { objectIdSchema, phoneSchema } from './common';

/** Portal self-service on the employee's own file [EP §5–8]. Rules per DECISIONS §10. */
export const updateMyContactSchema = z.object({
  mobile: phoneSchema.optional(),
  extension: z.string().trim().max(10).optional(),
  address: z
    .object({
      buildingNo: z.string().trim().max(10).optional(),
      street: z.string().trim().max(120).optional(),
      district: z.string().trim().max(80).optional(),
      city: z.string().trim().max(80).optional(),
      postalCode: z.string().trim().max(10).optional(),
    })
    .optional(),
});
export type UpdateMyContactInput = z.infer<typeof updateMyContactSchema>;

export const updateMyPhotoSchema = z.object({ attachmentId: objectIdSchema });

/** Bank account change: needs Finance approval with a proof document (DECISIONS §10). */
export const bankChangeRequestSchema = z.object({
  bankName: z.string().trim().min(2),
  iban: z
    .string()
    .trim()
    .regex(/^SA\d{22}$/i, 'آيبان سعودي غير صالح'),
  proofAttachmentId: objectIdSchema,
  notes: z.string().trim().max(500).optional(),
});

export const decideChangeRequestSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const secondmentReportSchema = z.object({
  attachmentId: objectIdSchema,
  notes: z.string().trim().max(2000).optional(),
});

export const PROFILE_CHANGE_STATES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const PROFILE_CHANGE_STATE_AR: Record<(typeof PROFILE_CHANGE_STATES)[number], string> = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
};
