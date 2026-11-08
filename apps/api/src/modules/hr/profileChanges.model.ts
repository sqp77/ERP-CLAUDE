import { Schema, model } from 'mongoose';
import { PROFILE_CHANGE_STATES } from '@eayni/shared';

/** Profile change needing approval (today: bank account → Finance) [EP §8.1, DECISIONS §10]. */
const profileChangeSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['bank'], required: true },
    /** Encrypted payload; IBAN never stored in clear. */
    payload: { bankName: String, ibanEnc: String, ibanLast4: String },
    proofAttachmentId: { type: Schema.Types.ObjectId, required: true },
    notes: { type: String },
    state: { type: String, enum: PROFILE_CHANGE_STATES, default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionReason: { type: String },
  },
  { timestamps: true },
);
// One pending change per employee and type (review G6): a unique partial index, not check-then-create.
profileChangeSchema.index(
  { employeeId: 1, type: 1 },
  { unique: true, partialFilterExpression: { state: 'pending' } },
);
export const ProfileChangeRequest = model('ProfileChangeRequest', profileChangeSchema);
