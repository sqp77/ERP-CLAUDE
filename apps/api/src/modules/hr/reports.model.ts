import { Schema, model } from 'mongoose';
import { REPORT_STATES } from '@eayni/shared';

/** Employee report to the direct manager [EP §14]; kept in the employee's record; manager notes are append-only. */
const employeeReportSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
    /** Direct manager at submission (user and employee ids). */
    managerUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    managerEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    periodFrom: { type: Date },
    periodTo: { type: Date },
    body: { type: String, required: true },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    state: { type: String, enum: REPORT_STATES, default: 'submitted', index: true },
    notes: {
      type: [
        {
          by: Schema.Types.ObjectId,
          byEmail: String,
          byName: String,
          note: String,
          at: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    reviewedAt: { type: Date },
    requestId: { type: Schema.Types.ObjectId },
    submittedAt: { type: Date, default: () => new Date(), index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
employeeReportSchema.index({ userId: 1, submittedAt: -1 });
export const EmployeeReport = model('EmployeeReport', employeeReportSchema);
export type EmployeeReportDoc = InstanceType<typeof EmployeeReport>;

/** A manager's request for a report [EP §15.13 "طلب رفع تقرير"]. */
const reportRequestSchema = new Schema(
  {
    employeeUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    managerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    dueDate: { type: Date },
    note: { type: String },
    fulfilledReportId: { type: Schema.Types.ObjectId },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
export const ReportRequest = model('ReportRequest', reportRequestSchema);
