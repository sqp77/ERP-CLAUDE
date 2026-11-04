import { Schema, model, type InferSchemaType } from 'mongoose';

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed },
    updatedBy: { type: String },
  },
  { timestamps: true },
);

export type SettingDoc = InferSchemaType<typeof settingSchema>;
export const Setting = model('Setting', settingSchema);
