import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  COMMUNICATION_METHODS,
  CUSTOMER_CLASSIFICATIONS,
  CUSTOMER_KINDS,
  CUSTOMER_SOURCES,
  CUSTOMER_STATUSES,
  LEAD_STATES,
  LEAD_TARGET_DEPARTMENTS,
} from '@eayni/shared';

/**
 * One customer file per real-world organization or individual [SAL §4.1, §19; CS §6.3], shared by Sales,
 * Customer Service, Operations and Sustainability (golden rule 2). An organization links to its party record
 * (FIN §8) for legal, tax and bank data; this file holds the commercial relationship.
 */
const customerSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    kind: { type: String, enum: CUSTOMER_KINDS, default: 'organization' },
    partyId: { type: Schema.Types.ObjectId, ref: 'Party', index: true },
    nameAr: { type: String, required: true },
    normalizedName: { type: String, required: true, index: true },
    country: { type: String },
    region: { type: String, index: true },
    city: { type: String },
    activity: { type: String },
    organizationType: { type: String },
    facilitySize: { type: String },
    source: { type: String, enum: CUSTOMER_SOURCES, required: true },
    sourceNote: { type: String },
    status: { type: String, enum: CUSTOMER_STATUSES, default: 'potential', index: true },
    classification: { type: String, enum: CUSTOMER_CLASSIFICATIONS },
    phone: { type: String },
    /** Digits only, for duplicate matching across reps. */
    phoneDigits: { type: String, index: true },
    email: { type: String },
    notes: { type: String },
    tags: { type: [String], default: [], index: true },
    /** الموظف المسؤول and the department that owns the file (Sales now; Sustainability later). */
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    /** Derived from the communication log, denormalized for lists and the dashboard. */
    lastContactAt: { type: Date },
    nextFollowUpAt: { type: Date, index: true },
    /** The nextFollowUpAt value the due reminder was sent for (once per date). */
    followUpNotifiedFor: { type: Date },
    legacyId: { type: String },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
customerSchema.index({ ownerUserId: 1, status: 1 });
customerSchema.index({ departmentId: 1, createdAt: -1 });
customerSchema.index({ nameAr: 'text', activity: 'text', city: 'text' });
export type CustomerDoc = InferSchemaType<typeof customerSchema>;
export const Customer = model('Customer', customerSchema);

/** Append-only customer history: ownership transfers [SAL §8.1, §19], status and classification changes. */
const customerEventSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: {
      type: String,
      enum: [
        'created',
        'owner_changed',
        'status_changed',
        'classification_changed',
        'updated',
        'lead_linked',
      ],
      required: true,
    },
    from: { type: String },
    to: { type: String },
    fromUserId: { type: Schema.Types.ObjectId },
    toUserId: { type: Schema.Types.ObjectId },
    byUserId: { type: Schema.Types.ObjectId },
    byEmail: { type: String },
    reason: { type: String },
    batchId: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
customerEventSchema.index({ customerId: 1, at: 1 });
export const CustomerEvent = model('CustomerEvent', customerEventSchema);

/** الأشخاص المسؤولون في الجهة — at most three per customer, enforced by the service [SAL §4.1 ثانياً]. */
const contactSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    nameAr: { type: String, required: true },
    jobTitle: { type: String },
    phone: { type: String },
    email: { type: String },
    notes: { type: String },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export const Contact = model('Contact', contactSchema);

/**
 * سجل التواصل والمحادثات — append-only [SAL §4.1 ثالثاً, §10.2, §19]: no update or delete path exists; the author
 * and time are set by the server; the log stays with the customer when the responsible employee changes.
 */
const communicationLogSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity', index: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String },
    at: { type: Date, default: () => new Date() },
    method: { type: String, enum: COMMUNICATION_METHODS, required: true },
    details: { type: String, required: true },
    outcome: { type: String },
    customerNeed: { type: String },
    nextStep: { type: String },
    nextFollowUpAt: { type: Date },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { versionKey: false },
);
communicationLogSchema.index({ customerId: 1, at: 1 });
export const CommunicationLog = model('CommunicationLog', communicationLogSchema);

/** Leads referred by Customer Service (or any channel) to Sales or Sustainability [SAL §3, §8.1; CS §6.8]. */
const leadSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerName: { type: String, required: true },
    contactName: { type: String },
    phone: { type: String },
    phoneDigits: { type: String },
    email: { type: String },
    interest: { type: String, required: true },
    channel: { type: String },
    notes: { type: String },
    targetDepartment: { type: String, enum: LEAD_TARGET_DEPARTMENTS, required: true, index: true },
    targetDepartmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    referredByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referredByDepartmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    referredAt: { type: Date, default: () => new Date() },
    assigneeUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignedAt: { type: Date },
    /** When the lead was registered as a customer / opportunity (the 24 h rule measures referredAt → this). */
    registeredAt: { type: Date },
    state: { type: String, enum: LEAD_STATES, default: 'new', index: true },
    outcome: { type: String },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity' },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    overdueNotifiedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
leadSchema.index({ targetDepartmentId: 1, state: 1, referredAt: -1 });
export type LeadDoc = InferSchemaType<typeof leadSchema>;
export const Lead = model('Lead', leadSchema);

const leadEventSchema = new Schema(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    type: {
      type: String,
      enum: ['referred', 'assigned', 'state_changed', 'converted', 'overdue'],
      required: true,
    },
    from: { type: String },
    to: { type: String },
    byUserId: { type: Schema.Types.ObjectId },
    byEmail: { type: String },
    note: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
export const LeadEvent = model('LeadEvent', leadEventSchema);
