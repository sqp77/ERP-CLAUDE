import { z } from 'zod';
import { STATE_CATEGORIES } from './enums';

/**
 * Workflow engine configuration (CLAUDE.md "Platform core → Workflow engine").
 * One definition per request type; states carry a category; transitions carry who may fire them,
 * which fields must be present, and whether a reason is mandatory. SLAs are in business days.
 */
export const stateDefSchema = z.object({
  labelAr: z.string().min(1),
  category: z.enum(STATE_CATEGORIES),
  /** Business days allowed in this state before it counts as late. */
  slaBusinessDays: z.number().int().positive().optional(),
  /** Who is expected to act while the record is in this state (for queues and reminders). */
  owner: z
    .enum(['requester', 'assignee', 'department', 'direct_manager', 'approver', 'none'])
    .default('none'),
});
export type StateDef = z.infer<typeof stateDefSchema>;

/**
 * Actor relations are computed by the caller for the current user and record, e.g.
 * 'requester', 'assignee', 'direct_manager', 'department_manager', plus the user's role codes.
 * A transition is allowed when the actor has at least one of its `allow` entries ('*' = anyone authenticated).
 */
export const transitionDefSchema = z.object({
  code: z.string().min(1),
  labelAr: z.string().min(1),
  from: z.array(z.string().min(1)).min(1),
  to: z.string().min(1),
  allow: z.array(z.string().min(1)).min(1),
  requiredFields: z.array(z.string()).default([]),
  requireReason: z.boolean().default(false),
  /** Notification recipients to resolve after the transition (symbolic, resolved by the owning module). */
  notify: z.array(z.string()).default([]),
});
export type TransitionDef = z.infer<typeof transitionDefSchema>;

export const workflowDefinitionSchema = z
  .object({
    type: z.string().min(1),
    nameAr: z.string().min(1),
    version: z.number().int().positive().default(1),
    initialState: z.string().min(1),
    states: z.record(z.string(), stateDefSchema),
    transitions: z.array(transitionDefSchema),
    /** Reopen rule, e.g. tickets reopened by the requester within N days of resolution [EP §9.4]. */
    reopen: z
      .object({
        from: z.array(z.string()),
        to: z.string(),
        allow: z.array(z.string()),
        withinDays: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .superRefine((def, ctx) => {
    if (!def.states[def.initialState]) {
      ctx.addIssue({
        code: 'custom',
        message: `initialState "${def.initialState}" is not a state`,
        path: ['initialState'],
      });
    }
    for (const t of def.transitions) {
      for (const f of t.from) {
        if (!def.states[f])
          ctx.addIssue({
            code: 'custom',
            message: `transition ${t.code}: unknown from-state ${f}`,
            path: ['transitions'],
          });
      }
      if (!def.states[t.to])
        ctx.addIssue({
          code: 'custom',
          message: `transition ${t.code}: unknown to-state ${t.to}`,
          path: ['transitions'],
        });
    }
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof workflowDefinitionSchema>;

/** Fields the engine maintains on every workflow-driven record. */
export interface WorkflowFields {
  state: string;
  stateEnteredAt: Date;
  /** Business-day deadline for the current state, when the state has an SLA. */
  dueAt?: Date | null;
  closedAt?: Date | null;
}
