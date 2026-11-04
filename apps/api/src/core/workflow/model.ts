import { Schema, model } from 'mongoose';

/** Stored workflow definitions (editable config, golden rule 10). Seeded from shared defaults. */
const workflowDefSchema = new Schema(
  {
    type: { type: String, required: true, unique: true },
    nameAr: { type: String, required: true },
    version: { type: Number, default: 1 },
    initialState: { type: String, required: true },
    states: { type: Schema.Types.Mixed, required: true },
    transitions: { type: Schema.Types.Mixed, required: true },
    reopen: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);
export const WorkflowDef = model('WorkflowDef', workflowDefSchema);

/** Stage log: one row per transition, append-only (golden rule 3). Carries delay reasons for SLA reporting. */
const stageLogSchema = new Schema(
  {
    recordType: { type: String, required: true, index: true },
    recordId: { type: String, required: true, index: true },
    recordNumber: { type: String },
    fromState: { type: String },
    toState: { type: String, required: true },
    transition: { type: String, required: true },
    actorUserId: { type: String },
    actorEmail: { type: String },
    actorRelations: { type: [String], default: [] },
    at: { type: Date, default: () => new Date() },
    reason: { type: String },
    /** Milliseconds spent in the previous state. */
    durationMs: { type: Number },
    /** The previous state had an SLA and it was exceeded. */
    overdue: { type: Boolean, default: false },
    delayReason: { type: String },
    /** Department responsible for the previous state, when known (SAL §19 "الجهة المسؤولة عن التأخير"). */
    departmentId: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);
stageLogSchema.index({ recordType: 1, recordId: 1, at: 1 });
export const StageLog = model('StageLog', stageLogSchema);
