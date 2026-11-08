import { Schema, model } from 'mongoose';

/** Every document the staging demo seed created, by collection, so `purgeDemo` can remove exactly those (staging readiness item 3). */
const demoRecordSchema = new Schema(
  {
    collectionName: { type: String, required: true, index: true },
    docId: { type: Schema.Types.Mixed, required: true },
    batch: { type: String, required: true, index: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
demoRecordSchema.index({ collectionName: 1, docId: 1 }, { unique: true });
export const DemoRecord = model('DemoRecord', demoRecordSchema, 'demo_records');
