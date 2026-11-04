import { Schema, model, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES } from '@eayni/shared';

/** In-app notification center [EP §15]: history, read/unread. */
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    titleAr: { type: String, required: true },
    bodyAr: { type: String },
    link: { type: String },
    data: { type: Schema.Types.Mixed },
    readAt: { type: Date },
    createdAt: { type: Date, default: () => new Date() },
    emailStatus: { type: String, enum: ['skipped', 'sent', 'failed'] },
  },
  { versionKey: false },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const Notification = model('Notification', notificationSchema);
