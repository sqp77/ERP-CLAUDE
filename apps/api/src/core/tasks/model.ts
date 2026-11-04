import { Schema, model, type InferSchemaType } from 'mongoose';
import { PRIORITIES, TASK_STATUSES } from '@eayni/shared';

/** One tasks store for every module [EP §10]; `source` links the task to the record it came from. */
const taskSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String },
    assignerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    status: { type: String, enum: TASK_STATUSES, default: 'new', index: true },
    progressPercent: { type: Number, default: 0 },
    startAt: { type: Date },
    dueAt: { type: Date, index: true },
    completedAt: { type: Date },
    source: { type: { type: String }, id: { type: String }, label: { type: String } },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    remindedDueSoon: { type: Boolean, default: false },
    remindedOverdue: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export type TaskDoc = InferSchemaType<typeof taskSchema>;
export const Task = model('Task', taskSchema);
