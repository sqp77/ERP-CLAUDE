import { Schema, model } from 'mongoose';

/** Save any long form and finish later [HR §3.2, HR §7.5]. One draft per user + form + record. */
const draftSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    formKey: { type: String, required: true },
    recordId: { type: String, default: '' },
    data: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
draftSchema.index({ userId: 1, formKey: 1, recordId: 1 }, { unique: true });
export const Draft = model('Draft', draftSchema);
