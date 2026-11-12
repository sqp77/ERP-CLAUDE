import { Schema, model, type InferSchemaType } from 'mongoose';
import { OPPORTUNITY_STAGES, SALES_SERVICE_TYPES } from '@eayni/shared';

/** Sales opportunity [SAL §4.1 رابعاً, §4.2]; its stage is separate from the customer's status. */
const opportunitySchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    title: { type: String, required: true },
    serviceType: { type: String, enum: SALES_SERVICE_TYPES },
    stage: { type: String, enum: OPPORTUNITY_STAGES, default: 'new', index: true },
    expectedValueHalalas: { type: Number },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    nextFollowUpAt: { type: Date, index: true },
    followUpNotifiedFor: { type: Date },
    lastContactAt: { type: Date },
    lostReason: { type: String },
    lostNote: { type: String },
    wonAt: { type: Date },
    lostAt: { type: Date },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    tags: { type: [String], default: [], index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
opportunitySchema.index({ ownerUserId: 1, stage: 1 });
opportunitySchema.index({ departmentId: 1, stage: 1 });
export type OpportunityDoc = InferSchemaType<typeof opportunitySchema>;
export const Opportunity = model('Opportunity', opportunitySchema);

/** Append-only stage and ownership history of an opportunity (golden rule 3). */
const opportunityEventSchema = new Schema(
  {
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', required: true, index: true },
    type: { type: String, enum: ['created', 'stage_changed', 'reassigned', 'updated'], required: true },
    from: { type: String },
    to: { type: String },
    fromUserId: { type: Schema.Types.ObjectId },
    toUserId: { type: Schema.Types.ObjectId },
    byUserId: { type: Schema.Types.ObjectId },
    byEmail: { type: String },
    note: { type: String },
    batchId: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
opportunityEventSchema.index({ opportunityId: 1, at: 1 });
export const OpportunityEvent = model('OpportunityEvent', opportunityEventSchema);
