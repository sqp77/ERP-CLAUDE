import { Schema, model, type InferSchemaType } from 'mongoose';

/** Domain events written with the business change and delivered by a worker (CLAUDE.md "Domain events"). */
const outboxSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    aggregateType: { type: String },
    aggregateId: { type: String },
    payload: { type: Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      // 'unhandled' = no subscriber yet; replayed automatically once one registers (review B11b).
      enum: ['pending', 'processing', 'delivered', 'failed', 'unhandled'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: () => new Date(), index: true },
    /** Claim lease; an event still 'processing' after this time is reclaimed by the next worker (review B11a). */
    leaseExpiresAt: { type: Date },
    /** Subscriber keys that already succeeded; skipped on retry (review B11c). */
    handledBy: { type: [String], default: [] },
    lastError: { type: String },
    deliveredAt: { type: Date },
    createdAt: { type: Date, default: () => new Date() },
    actorUserId: { type: String },
  },
  { versionKey: false },
);
export type OutboxDoc = InferSchemaType<typeof outboxSchema>;
export const Outbox = model('Outbox', outboxSchema);
