import { Schema, model, type InferSchemaType } from 'mongoose';

/** Domain events written with the business change and delivered by a worker (CLAUDE.md "Domain events"). */
const outboxSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    aggregateType: { type: String },
    aggregateId: { type: String },
    payload: { type: Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, unique: true, sparse: true },
    status: { type: String, enum: ['pending', 'processing', 'delivered', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: () => new Date(), index: true },
    lastError: { type: String },
    deliveredAt: { type: Date },
    createdAt: { type: Date, default: () => new Date() },
    actorUserId: { type: String },
  },
  { versionKey: false },
);
export type OutboxDoc = InferSchemaType<typeof outboxSchema>;
export const Outbox = model('Outbox', outboxSchema);
