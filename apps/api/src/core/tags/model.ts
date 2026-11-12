import { Schema, model, type InferSchemaType } from 'mongoose';

/** Hashtags per module scope [SAL §10.4]; records keep the tag names, so renaming a tag is a bulk update by the owner module. */
const tagSchema = new Schema(
  {
    scope: { type: String, required: true, index: true },
    name: { type: String, required: true },
    normalizedName: { type: String, required: true },
    color: { type: String },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
tagSchema.index({ scope: 1, normalizedName: 1 }, { unique: true });
export type TagDoc = InferSchemaType<typeof tagSchema>;
export const Tag = model('Tag', tagSchema);
