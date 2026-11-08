import { Schema, model } from 'mongoose';
import { NEWS_STATES } from '@eayni/shared';

/** News & circulars [EP §12]: per-department publishing, approval (DECISIONS §10), pin, audience, window, archive. */
const newsSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    departmentCode: { type: String, required: true, index: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String },
    audienceAll: { type: Boolean, default: true },
    audienceDepartmentIds: { type: [Schema.Types.ObjectId], default: [] },
    pinned: { type: Boolean, default: false },
    publishFrom: { type: Date },
    publishTo: { type: Date },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    coverAttachmentId: { type: Schema.Types.ObjectId },
    state: { type: String, enum: NEWS_STATES, default: 'draft', index: true },
    submittedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectReason: { type: String },
    publishedAt: { type: Date, index: true },
    /** When the audience was told (on publish, or when a scheduled window opened). */
    notifiedAt: { type: Date },
    archivedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
newsSchema.index({ state: 1, pinned: -1, publishedAt: -1 });
export const News = model('News', newsSchema);
export type NewsDoc = InstanceType<typeof News>;

/** Append-only log of publishing actions. */
const newsActionSchema = new Schema(
  {
    newsId: { type: Schema.Types.ObjectId, ref: 'News', required: true, index: true },
    action: { type: String, required: true },
    actorUserId: { type: Schema.Types.ObjectId },
    actorEmail: { type: String },
    note: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
export const NewsAction = model('NewsAction', newsActionSchema);
