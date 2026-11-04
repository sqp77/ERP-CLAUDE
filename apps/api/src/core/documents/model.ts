import { Schema, model, type InferSchemaType } from 'mongoose';

/** Typed documents with expiry alerts [HR §3.9, EP §5.2, §6, IT §7.4]. New versions are new rows. */
const documentSchema = new Schema(
  {
    ownerType: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    titleAr: { type: String, required: true },
    attachmentId: { type: Schema.Types.ObjectId, ref: 'Attachment', required: true },
    issueDate: { type: Date },
    expiryDate: { type: Date, index: true },
    alertOffsetsDays: { type: [Number] },
    alertsSent: { type: [Number], default: [] },
    version: { type: Number, default: 1 },
    previousId: { type: Schema.Types.ObjectId, ref: 'Document' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sensitive: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
documentSchema.index({ ownerType: 1, ownerId: 1, type: 1, version: -1 });
export type DocumentDoc = InferSchemaType<typeof documentSchema>;
export const DocumentRecord = model('Document', documentSchema);
