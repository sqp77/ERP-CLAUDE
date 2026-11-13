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
    /** «نوع الاجتماع» [SAL §9] from `sales.lists.meetingTypes` (free text while the list is empty, Q7). */
    meetingType: z.string().trim().max(120).optional(),
    /** Events that need Marketing [SAL §9 «إشعار قسم التسويق»]: name = title, date = startAt, location, organizer. */
    organizer: z.string().trim().max(200).optional(),
    needsMarketing: z.boolean().default(false),
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
  meetingType: z.string().trim().max(120).optional(),
  organizer: z.string().trim().max(200).optional(),
  needsMarketing: z.boolean().optional(),
});
export const listEventsQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  departmentId: objectIdSchema.optional(),
  userId: objectIdSchema.optional(),
  type: z.enum(EVENT_TYPES).optional(),
  /** Extra sources to merge (comma-separated: tasks, secondments…); default all [EP §13.4–13.7]. */
  include: z.string().optional(),
});
export const peopleQuerySchema = z.object({ q: z.string().trim().max(60).default('') });
