import { z } from 'zod';
import { EVENT_STATUSES, EVENT_TYPES } from '../enums';
import { objectIdSchema } from './common';

/** Calendar events [EP §13]. */
export const createEventSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    type: z.enum(EVENT_TYPES).default('meeting'),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    allDay: z.boolean().default(false),
    location: z.string().trim().max(500).optional(),
    locationUrl: z.string().url().optional(),
    meetingUrl: z.string().url().optional(),
    description: z.string().trim().max(5000).optional(),
    participantIds: z.array(objectIdSchema).default([]),
    departmentIds: z.array(objectIdSchema).default([]),
    reminderMinutes: z.array(z.number().int().min(0)).default([60]),
    link: z.object({ type: z.string(), id: z.string(), label: z.string().optional() }).optional(),
  })
  .refine((e) => e.endAt >= e.startAt, { message: 'وقت النهاية قبل وقت البداية', path: ['endAt'] });
export const updateEventSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  type: z.enum(EVENT_TYPES).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  location: z.string().trim().max(500).optional(),
  locationUrl: z.string().url().optional(),
  meetingUrl: z.string().url().optional(),
  description: z.string().trim().max(5000).optional(),
  participantIds: z.array(objectIdSchema).optional(),
  departmentIds: z.array(objectIdSchema).optional(),
  reminderMinutes: z.array(z.number().int().min(0)).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  outcome: z.string().trim().max(5000).optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
});
export const listEventsQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  departmentId: objectIdSchema.optional(),
  userId: objectIdSchema.optional(),
  type: z.enum(EVENT_TYPES).optional(),
});
