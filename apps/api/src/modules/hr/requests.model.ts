import { Schema, model } from 'mongoose';
import { HR_REQUEST_TYPES } from '@eayni/shared';

/**
 * Employee self-service request [HR §3.5, EP §11]. Workflow fields are maintained by the engine;
 * every move is in the stage log; decisions and the action log are append-only (requestActions).
 */
const hrRequestSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    type: { type: String, enum: HR_REQUEST_TYPES, required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    requesterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
    /** Snapshot of the direct manager at submission; updated by the manager-change handler. */
    directManagerUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    details: { type: Schema.Types.Mixed, required: true },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    notes: { type: String },
    route: { viaManager: Boolean, finalApprover: String },
    // workflow
    state: { type: String, required: true, index: true },
    stateEnteredAt: { type: Date, required: true },
    dueAt: { type: Date },
    closedAt: { type: Date },
    /** Who should act now: 'manager' | 'hr' | 'finance' | 'requester' | null. */
    pendingWith: { type: String, index: true },
    flags: { type: [String], default: [] },
    decision: { by: Schema.Types.ObjectId, at: Date, outcome: String, reason: String },
    /** Hand-off record for requests continuing to another module with the same number (FIN §11). */
    handoff: { department: String, since: Date, status: String },
    certificate: {
      number: String,
      attachmentId: Schema.Types.ObjectId,
      issuedAt: Date,
      issuedBy: Schema.Types.ObjectId,
    },
    overdueNotifiedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
hrRequestSchema.index({ requesterUserId: 1, createdAt: -1 });
hrRequestSchema.index({ pendingWith: 1, state: 1 });
export const HrRequest = model('HrRequest', hrRequestSchema);
export type HrRequestDoc = InstanceType<typeof HrRequest>;

/** Action log on a request: who did what, when, with which note — append-only [HR §3.5 "سجل الإجراءات والتعديلات"]. */
const requestActionSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'HrRequest', required: true, index: true },
    action: { type: String, required: true },
    fromState: { type: String },
    toState: { type: String },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorEmail: { type: String },
    actorRole: { type: String },
    note: { type: String },
    changes: { type: Schema.Types.Mixed },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
export const HrRequestAction = model('HrRequestAction', requestActionSchema);
