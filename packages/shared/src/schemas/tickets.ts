import { z } from 'zod';
import { PRIORITIES, type Priority } from '../enums';
import { DEPARTMENT_CODES } from '../constants';
import { objectIdSchema } from './common';

/** Ticket types [EP §9.2]. */
export const TICKET_TYPES = ['request', 'complaint', 'issue', 'inquiry', 'support'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TICKET_TYPE_AR: Record<TicketType, string> = {
  request: 'طلب',
  complaint: 'شكوى',
  issue: 'حل مشكلة',
  inquiry: 'استفسار',
  support: 'طلب دعم',
};

/** The eight EP §9.4 states; IT adds `stalled` (متعثر) in its own workflow config [IT §7.1, DECISIONS §8]. */
export const TICKET_STATES = [
  'new',
  'under_review',
  'in_progress',
  'waiting_requester',
  'resolved',
  'awaiting_confirmation',
  'closed',
  'reopened',
  'stalled',
] as const;
export type TicketState = (typeof TICKET_STATES)[number];
export const OPEN_TICKET_STATES: readonly TicketState[] = [
  'new',
  'under_review',
  'in_progress',
  'waiting_requester',
  'reopened',
  'stalled',
];

/** Departments that may receive tickets [EP §9.1] — everything but executive management. */
export const TICKET_TARGET_CODES = DEPARTMENT_CODES.filter((c) => c !== 'executive');

/**
 * Department-specific ticket fields come from config (settings key `tickets.departmentFields`):
 * extra select / text fields per target department, plus optional priority labels (IT §7.1).
 */
export const ticketFieldDefSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/),
  labelAr: z.string().min(1),
  type: z.enum(['select', 'text']),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string().min(1), labelAr: z.string().min(1) })).optional(),
});
export type TicketFieldDef = z.infer<typeof ticketFieldDefSchema>;
export const ticketDepartmentConfigSchema = z.object({
  fields: z.array(ticketFieldDefSchema).default([]),
  priorityLabelsAr: z.record(z.enum(PRIORITIES), z.string()).optional(),
});
export type TicketDepartmentConfig = z.infer<typeof ticketDepartmentConfigSchema>;
export const ticketDepartmentFieldsSchema = z.record(z.string(), ticketDepartmentConfigSchema);

/** IT's own fields and priority wording [IT §7.1]; seeded as the default config. */
export const DEFAULT_TICKET_DEPARTMENT_FIELDS: Record<string, TicketDepartmentConfig> = {
  it: {
    fields: [
      {
        key: 'itType',
        labelAr: 'نوع الطلب',
        type: 'select',
        required: true,
        options: [
          { value: 'fault', labelAr: 'عطل' },
          { value: 'access', labelAr: 'صلاحية' },
          { value: 'device', labelAr: 'جهاز' },
          { value: 'network', labelAr: 'شبكة' },
          { value: 'software', labelAr: 'برنامج' },
        ],
      },
    ],
    priorityLabelsAr: { urgent: 'عاجل', high: 'مرتفع', medium: 'متوسط', low: 'منخفض' } satisfies Record<
      Priority,
      string
    >,
  },
};

export const createTicketSchema = z.object({
  departmentCode: z.enum(TICKET_TARGET_CODES as [string, ...string[]]),
  type: z.enum(TICKET_TYPES),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(5000),
  priority: z.enum(PRIORITIES).default('medium'),
  attachmentIds: z.array(objectIdSchema).default([]),
  /** Values for the target department's configured fields. */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const TICKET_ACTIONS = [
  'review',
  'assign',
  'claim',
  'start',
  'request_info',
  'provide_info',
  'resolve',
  'close',
  'reopen',
  'stall',
  'resume',
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

export const ticketTransitionSchema = z.object({
  transition: z.enum(TICKET_ACTIONS),
  assigneeId: objectIdSchema.optional(),
  reason: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(5000).optional(),
  resolution: z.string().trim().max(5000).optional(),
  rating: z
    .object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })
    .optional(),
  attachmentIds: z.array(objectIdSchema).optional(),
});
export type TicketTransitionInput = z.infer<typeof ticketTransitionSchema>;

export const listTicketsQuerySchema = z.object({
  view: z.enum(['mine', 'assigned', 'department', 'all']).default('mine'),
  state: z.enum(TICKET_STATES).optional(),
  departmentCode: z.string().optional(),
  type: z.enum(TICKET_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: objectIdSchema.optional(),
  unassigned: z.coerce.boolean().optional(),
  open: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(25),
});
