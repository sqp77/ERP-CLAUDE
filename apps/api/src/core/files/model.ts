import { Schema, model, type InferSchemaType } from 'mongoose';

/** Attachment metadata; bytes live in storage (S3 or local disk in dev). */
const attachmentSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'uploaded'], default: 'pending', index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerType: { type: String, index: true },
    ownerId: { type: String, index: true },
    sensitive: { type: Boolean, default: false },
    uploadedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export type AttachmentDoc = InferSchemaType<typeof attachmentSchema>;
export const Attachment = model('Attachment', attachmentSchema);
