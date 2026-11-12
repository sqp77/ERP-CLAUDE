import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Correspondence saved in the customer file [SAL §10.1, §19 «حفظ المراسلات»]: every message composed in the system,
 * whether the mailbox adapter sent it, it was sent from the employee's own mail client («أُرسل خارج النظام»), or it
 * is still an unsent draft. Append-only; the state moves forward only.
 */
export const EMAIL_STATES = ['draft_unsent', 'sent_externally', 'sent', 'failed'] as const;
const emailMessageSchema = new Schema(
  {
    recordType: { type: String, required: true, index: true },
    recordId: { type: String, required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    direction: { type: String, enum: ['out', 'in'], default: 'out' },
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fromName: { type: String },
    fromMailbox: { type: String, enum: ['user', 'department'], default: 'user' },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    subject: { type: String, required: true },
    bodyText: { type: String, required: true },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    state: { type: String, enum: EMAIL_STATES, default: 'draft_unsent', index: true },
    provider: { type: String },
    sentAt: { type: Date },
    error: { type: String },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
emailMessageSchema.index({ customerId: 1, createdAt: -1 });
export type EmailMessageDoc = InferSchemaType<typeof emailMessageSchema>;
export const EmailMessage = model('EmailMessage', emailMessageSchema);
