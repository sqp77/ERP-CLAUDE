import { Schema, model } from 'mongoose';
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  GENDERS,
  IDENTITY_TYPES,
} from '@eayni/shared';

/**
 * Employee file [HR §3.3]. One record per employee (golden rule 2); the portal reads this record.
 * Identity number and IBAN are encrypted at rest (AES-256-GCM); only the last 4 digits are stored in clear.
 */
const employeeSchema = new Schema(
  {
    employeeNumber: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    firstNameAr: { type: String, required: true },
    lastNameAr: { type: String, required: true },
    fullNameAr: { type: String, required: true },
    fullNameEn: { type: String },
    gender: { type: String, enum: GENDERS, required: true },
    birthDate: { type: Date },
    nationality: { type: String, required: true },
    religion: { type: String },
    identity: {
      type: { type: String, enum: IDENTITY_TYPES, required: true },
      numberEnc: { type: String, required: true },
      last4: { type: String },
      expiryDate: { type: Date },
      alertsSent: { type: [Number], default: [] },
    },
    workEmail: { type: String, required: true, lowercase: true, unique: true },
    mobile: { type: String },
    extension: { type: String },
    address: { buildingNo: String, street: String, district: String, city: String, postalCode: String },
    photoAttachmentId: { type: Schema.Types.ObjectId },
    // Job [HR §3.1, EP §7]
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit' },
    positionId: { type: Schema.Types.ObjectId, ref: 'Position' },
    grade: { type: String },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
    siteId: { type: Schema.Types.ObjectId, ref: 'Site' },
    directManagerId: { type: Schema.Types.ObjectId, ref: 'Employee', index: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'full_time' },
    hireDate: { type: Date, required: true },
    endDate: { type: Date },
    /** Set by the daily job when the portal account is disabled after the last working day. */
    accountDisabledAt: { type: Date },
    status: { type: String, enum: EMPLOYEE_STATUSES, default: 'active', index: true },
    secondment: {
      destination: String,
      startDate: Date,
      endDate: Date,
      reportAttachmentId: Schema.Types.ObjectId,
      reportedAt: Date,
    },
    // Financial [EP §8] — HR owns, Finance reads (DECISIONS §7)
    basicSalaryHalalas: { type: Number },
    allowances: { type: [{ type: { type: String }, amountHalalas: Number }], default: [] },
    bank: { bankName: String, ibanEnc: String, ibanLast4: String },
    medicalInsurance: { type: Boolean, default: false },
    legacyId: { type: String }, // import-friendly (DECISIONS §3)
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
employeeSchema.index({ fullNameAr: 'text', employeeNumber: 1 });
export const Employee = model('Employee', employeeSchema);
export type EmployeeDoc = InstanceType<typeof Employee>;

/** Append-only job and status history [HR §3.1.9–3.1.10, EP §7]. */
const employeeEventSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    type: {
      type: String,
      enum: [
        'created',
        'updated',
        'transfer',
        'promotion',
        'manager_change',
        'status_change',
        'secondment_report',
      ],
      required: true,
    },
    from: { type: Schema.Types.Mixed },
    to: { type: Schema.Types.Mixed },
    changedFields: { type: [String], default: [] },
    effectiveDate: { type: Date },
    reason: { type: String },
    actorUserId: { type: String },
    actorEmail: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
employeeEventSchema.index({ employeeId: 1, at: -1 });
export const EmployeeEvent = model('EmployeeEvent', employeeEventSchema);

/** Custody items handed to the employee [HR §3.3 "سجل العهد"]. IT assets link here later (IT §7.3). */
const custodySchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    itemName: { type: String, required: true },
    assetTag: { type: String },
    serialNumber: { type: String },
    assetId: { type: Schema.Types.ObjectId },
    issuedAt: { type: Date, required: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    returnedAt: { type: Date },
    condition: { type: String },
    notes: { type: String },
    attachmentId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
export const Custody = model('Custody', custodySchema);

/** Employment contracts [HR §3.9, EP §6]. A renewal is a new row linked to the previous one. */
const contractSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    number: { type: String, required: true, unique: true },
    type: { type: String, enum: CONTRACT_TYPES, required: true },
    status: { type: String, enum: CONTRACT_STATUSES, default: 'active', index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, index: true },
    probationEndDate: { type: Date },
    durationMonths: { type: Number },
    attachmentId: { type: Schema.Types.ObjectId },
    addenda: {
      type: [
        {
          titleAr: String,
          attachmentId: Schema.Types.ObjectId,
          notes: String,
          addedAt: Date,
          addedBy: Schema.Types.ObjectId,
        },
      ],
      default: [],
    },
    alertsSent: { type: [Number], default: [] },
    probationAlertsSent: { type: [Number], default: [] },
    notes: { type: String },
    version: { type: Number, default: 1 },
    previousId: { type: Schema.Types.ObjectId, ref: 'Contract' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    statusReason: { type: String },
  },
  { timestamps: true },
);
export const Contract = model('Contract', contractSchema);
