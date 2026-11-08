import { Schema, model, type InferSchemaType } from 'mongoose';
import { PRIORITIES, TASK_STATUSES } from '@eayni/shared';

/**
 * One tasks store for every module [EP §10]; `source` links the task to the record it came from.
 * `assigneeId` is empty while the task sits in the department queue waiting for the manager to
 * distribute it [EP §16]. `departmentId` is always set by the server.
 */
const taskSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String },
    assignerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    status: { type: String, enum: TASK_STATUSES, default: 'new', index: true },
    progressPercent: { type: Number, default: 0 },
    startAt: { type: Date },
    dueAt: { type: Date, index: true },
    completedAt: { type: Date },
    /** Note from the assigner when a task is returned from review. */
    reviewNote: { type: String },
    source: { type: { type: String }, id: { type: String }, label: { type: String } },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    remindedDueSoon: { type: Boolean, default: false },
    remindedOverdue: { type: Boolean, default: false },
    /** Riyadh date of the last queue reminder (review F3: once per business day). */
    remindedUnassignedOn: { type: String },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
taskSchema.index({ departmentId: 1, status: 1, assigneeId: 1 });
export type TaskDoc = InferSchemaType<typeof taskSchema>;
export const Task = model('Task', taskSchema);

/** Append-only task history: every status change, assignment, reassignment and review (golden rule 3). */
const taskEventSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    type: {
      type: String,
      enum: [
        'created',
        'assigned',
        'reassigned',
        'status_changed',
        'review_requested',
        'approved',
        'returned',
        'cancelled',
      ],
      required: true,
    },
    fromStatus: { type: String },
    toStatus: { type: String },
    fromAssigneeId: { type: Schema.Types.ObjectId },
    toAssigneeId: { type: Schema.Types.ObjectId },
    note: { type: String },
    actorUserId: { type: Schema.Types.ObjectId },
    actorEmail: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
taskEventSchema.index({ taskId: 1, at: 1 });
export const TaskEvent = model('TaskEvent', taskEventSchema);
