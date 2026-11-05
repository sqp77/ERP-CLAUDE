import { Schema, model } from 'mongoose';
import { PRIORITIES, TICKET_STATES, TICKET_TYPES } from '@eayni/shared';

/**
 * Internal ticket [EP §9]: one record from opening to closing; the stage log and the action log keep the
 * full history (golden rule 3). Finance and Procurement tickets will be the same record as the FIN §3 /
 * PRC §2 requests (DECISIONS §8) — those targets are hidden until their modules exist.
 */
const ticketSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    requesterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requesterEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    /** Snapshots for the ticket header [EP §9.3 items 2–4]. */
    requester: { fullNameAr: String, employeeNumber: String, departmentId: Schema.Types.ObjectId },
    /** Target department [EP §9.1]. */
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    departmentCode: { type: String, required: true, index: true },
    /** Workflow definition in use: 'ticket', or a department copy such as 'ticket_it'. */
    workflowType: { type: String, required: true },
    type: { type: String, enum: TICKET_TYPES, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    /** Values of the department's configured fields (settings `tickets.departmentFields`). */
    fields: { type: Schema.Types.Mixed, default: {} },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    // workflow
    state: { type: String, enum: TICKET_STATES, required: true, index: true },
    stateEnteredAt: { type: Date, required: true },
    dueAt: { type: Date },
    closedAt: { type: Date },
    /** Who should act now: 'department' | 'assignee' | 'requester' | null. */
    pendingWith: { type: String, index: true },
    /** First move into قيد المعالجة [IT §7.1 "تاريخ المعالجة"]. */
    processingStartedAt: { type: Date },
    resolvedAt: { type: Date },
    resolution: { type: String },
    rating: { score: Number, comment: String, at: Date },
    reopenCount: { type: Number, default: 0 },
    /** Follow-ups after تم الحل (DECISIONS §8). */
    confirmReminderSentAt: { type: Date },
    autoClosed: { type: Boolean, default: false },
    lastActivityAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
ticketSchema.index({ departmentId: 1, state: 1, assigneeId: 1 });
ticketSchema.index({ requesterUserId: 1, createdAt: -1 });
export const Ticket = model('Ticket', ticketSchema);
export type TicketDoc = InstanceType<typeof Ticket>;

/** Append-only action log: who did what, when, with which note [EP §9.5 "سجل كامل لجميع الإجراءات"]. */
const ticketActionSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
    action: { type: String, required: true },
    fromState: { type: String },
    toState: { type: String },
    actorUserId: { type: Schema.Types.ObjectId },
    actorEmail: { type: String },
    actorRelation: { type: String },
    note: { type: String },
    data: { type: Schema.Types.Mixed },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
ticketActionSchema.index({ ticketId: 1, at: 1 });
export const TicketAction = model('TicketAction', ticketActionSchema);
