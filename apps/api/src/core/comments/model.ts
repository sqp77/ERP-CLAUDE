import { Schema, model } from 'mongoose';

/** Threads on any record [SAL §10.3, EP §9.5]. Append-only; internal comments never reach external realms. */
const commentSchema = new Schema(
  {
    recordType: { type: String, required: true, index: true },
    recordId: { type: String, required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    mentionUserIds: { type: [Schema.Types.ObjectId], default: [] },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    internal: { type: Boolean, default: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
commentSchema.index({ recordType: 1, recordId: 1, createdAt: 1 });
export const Comment = model('Comment', commentSchema);
