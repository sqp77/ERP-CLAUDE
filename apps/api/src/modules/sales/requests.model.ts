import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  REQUEST_HOLDERS,
  RENTAL_INSPECTION_PHASES,
  SALES_SERVICE_TYPES,
  SCRAP_TRANSFER_STATUSES,
} from '@eayni/shared';

/**
 * Sales service request [SAL §5, §6, §19]: one collection for the seven services (`type` + `details`), one number
 * per type (CSR/SRT/CLN/DST/RNT/SCR/ARO), workflow fields from the engine, and the stage data of each receiving
 * department on the same record (golden rule 6). `holder` is the department that must act now.
 */
const salesRequestSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    type: { type: String, enum: SALES_SERVICE_TYPES, required: true, index: true },
    workflowType: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity' },
    title: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    photoIds: { type: [Schema.Types.ObjectId], default: [] },
    tags: { type: [String], default: [], index: true },
    // workflow
    state: { type: String, required: true, index: true },
    stateEnteredAt: { type: Date, required: true },
    dueAt: { type: Date },
    closedAt: { type: Date },
    holder: { type: String, enum: REQUEST_HOLDERS, default: 'sales', index: true },
    /** Departments that held the record at some point: they keep seeing it in their history. */
    holdersInvolved: { type: [String], default: ['sales'] },
    needsProcurement: { type: Boolean },
    needsFinanceApproval: { type: Boolean },
    needsOperations: { type: Boolean },
    closingOutcome: { type: String },
    closingNote: { type: String },
    /** Overdue reminder sent for the current state (once per state entry). */
    overdueNotifiedFor: { type: Date },
    // stage data
    procurement: {
      supplierPartyId: { type: Schema.Types.ObjectId, ref: 'Party' },
      supplierName: { type: String },
      supplierQuoteAttachmentIds: { type: [Schema.Types.ObjectId], default: [] },
      receiptFormAttachmentId: { type: Schema.Types.ObjectId },
      deliveryDate: { type: Date },
      notes: { type: String },
    },
    finance: {
      decision: { type: String },
      decidedByUserId: { type: Schema.Types.ObjectId },
      decidedAt: { type: Date },
      notes: { type: String },
      rejectionReason: { type: String },
      infoRequest: { type: String },
      purchaseDocumentAttachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    },
    operations: {
      scheduledVisitAt: { type: Date },
      scheduledVisitEventIds: { type: [Schema.Types.ObjectId], default: [] },
      estimatedWeightKg: { type: Number },
      estimatedQuantity: { type: String },
      quantitiesKg: { type: Number },
      weightsKg: { type: Number },
      receiptReportAttachmentIds: { type: [Schema.Types.ObjectId], default: [] },
      deliveryReportAttachmentIds: { type: [Schema.Types.ObjectId], default: [] },
      notes: { type: String },
      postponedTo: { type: Date },
      completedAt: { type: Date },
    },
    scrap: {
      proposedPriceHalalas: { type: Number },
      agreedPriceHalalas: { type: Number },
      actualWeightKg: { type: Number },
      receiptReportAttachmentIds: { type: [Schema.Types.ObjectId], default: [] },
      transferStatus: { type: String, enum: SCRAP_TRANSFER_STATUSES },
      transferProofAttachmentId: { type: Schema.Types.ObjectId },
      transferredHalalas: { type: Number },
      transferredAt: { type: Date },
      transferredByUserId: { type: Schema.Types.ObjectId },
    },
    assetReturn: {
      nextConversationAt: { type: Date },
      reminderSentFor: { type: Date },
      nonCooperationReason: { type: String },
    },
    lastActivityAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
salesRequestSchema.index({ holder: 1, state: 1 });
salesRequestSchema.index({ ownerUserId: 1, state: 1 });
salesRequestSchema.index({ departmentId: 1, type: 1, state: 1 });
salesRequestSchema.index({ title: 'text' });
export type SalesRequestDoc = InferSchemaType<typeof salesRequestSchema>;
export const SalesRequest = model('SalesRequest', salesRequestSchema);

/** Append-only action log of a request (who did what, with the stage payload summary). */
const salesRequestActionSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'SalesRequest', required: true, index: true },
    action: { type: String, required: true },
    fromState: { type: String },
    toState: { type: String },
    holderFrom: { type: String },
    holderTo: { type: String },
    actorUserId: { type: Schema.Types.ObjectId },
    actorEmail: { type: String },
    actorRelations: { type: [String], default: [] },
    note: { type: String },
    data: { type: Schema.Types.Mixed },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
salesRequestActionSchema.index({ requestId: 1, at: 1 });
export const SalesRequestAction = model('SalesRequestAction', salesRequestActionSchema);

/** Rental inspections [SAL §5.5]: append-only, one per phase per container visit. */
const rentalInspectionSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'SalesRequest', required: true, index: true },
    phase: { type: String, enum: RENTAL_INSPECTION_PHASES, required: true },
    containerNumber: { type: String },
    photoIds: { type: [Schema.Types.ObjectId], default: [] },
    at: { type: Date, default: () => new Date() },
    byUserId: { type: Schema.Types.ObjectId, required: true },
    byName: { type: String },
    signatureAttachmentId: { type: Schema.Types.ObjectId },
    receiptProofAttachmentId: { type: Schema.Types.ObjectId },
    containerCondition: { type: String, required: true },
    notes: { type: String },
  },
  { versionKey: false },
);
export const RentalInspection = model('RentalInspection', rentalInspectionSchema);

/** Scrap assessments [SAL §5.6 ثالثاً, OPS §2.2]: append-only («الاحتفاظ بسجل لجميع الزيارات والتقييمات»). */
const scrapAssessmentSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'SalesRequest', required: true, index: true },
    visitAt: { type: Date },
    result: { type: String, required: true },
    photoIds: { type: [Schema.Types.ObjectId], default: [] },
    inspectionReportAttachmentId: { type: Schema.Types.ObjectId },
    quantitiesKg: { type: Number },
    estimatedWeightKg: { type: Number },
    categories: { type: [String], default: [] },
    proposedPriceHalalas: { type: Number },
    agreedPriceHalalas: { type: Number },
    nextAction: { type: String },
    byUserId: { type: Schema.Types.ObjectId, required: true },
    byName: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
export const ScrapAssessment = model('ScrapAssessment', scrapAssessmentSchema);

/** «رفع مهمة» [SAL §5.6 ثانياً]: the scrap payload of a core task (the task itself lives in the core tasks store). */
const scrapTaskSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'SalesRequest', required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, unique: true },
    assigneeUserId: { type: Schema.Types.ObjectId, required: true },
    customersToContact: { type: Number },
    taskType: { type: String, required: true },
    assignedAt: { type: Date, default: () => new Date() },
    visitAt: { type: Date },
    agreedPriceHalalas: { type: Number },
    transferStatus: { type: String, enum: SCRAP_TRANSFER_STATUSES, default: 'not_transferred' },
    transferProofAttachmentId: { type: Schema.Types.ObjectId },
    notes: { type: String },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    createdByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
export const ScrapTask = model('ScrapTask', scrapTaskSchema);
