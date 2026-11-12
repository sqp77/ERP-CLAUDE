import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Party master [FIN §8]: one record for every outside organization, whether customer, supplier or both.
 * Minimal in Sales S1 (legal identity, contact, address); tax and bank fields are edited by Finance only.
 * Duplicate prevention: unique CR / unified / VAT numbers, plus a normalized-name warning.
 */
export const PARTY_ROLES = ['customer', 'supplier'] as const;
export const PARTY_STATUSES = ['active', 'inactive'] as const; // نشطة / غير نشطة

const partySchema = new Schema(
  {
    legalNameAr: { type: String, required: true },
    legalNameEn: { type: String },
    normalizedName: { type: String, required: true, index: true },
    roles: { type: [String], enum: PARTY_ROLES, default: ['customer'] },
    crNumber: { type: String },
    unifiedNumber: { type: String },
    vatNumber: { type: String },
    nationalAddress: { type: String },
    email: { type: String },
    phone: { type: String },
    status: { type: String, enum: PARTY_STATUSES, default: 'active' },
    notes: { type: String },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
partySchema.index(
  { crNumber: 1 },
  { unique: true, partialFilterExpression: { crNumber: { $type: 'string' } } },
);
partySchema.index(
  { unifiedNumber: 1 },
  { unique: true, partialFilterExpression: { unifiedNumber: { $type: 'string' } } },
);
partySchema.index(
  { vatNumber: 1 },
  { unique: true, partialFilterExpression: { vatNumber: { $type: 'string' } } },
);
export type PartyDoc = InferSchemaType<typeof partySchema>;
export const Party = model('Party', partySchema);
