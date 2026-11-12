import { Schema, model, type InferSchemaType } from 'mongoose';
import { PRICE_ITEM_KINDS, PRICE_UNITS } from '@eayni/shared';

/** قائمة الأسعار المركزية [SAL §7.1]: materials and services; the price itself lives in append-only entries. */
const priceItemSchema = new Schema(
  {
    kind: { type: String, enum: PRICE_ITEM_KINDS, required: true, index: true },
    nameAr: { type: String, required: true },
    normalizedName: { type: String, required: true },
    category: { type: String, index: true },
    unit: { type: String, enum: PRICE_UNITS, required: true },
    active: { type: Boolean, default: true },
    notes: { type: String },
    createdByUserId: { type: Schema.Types.ObjectId },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
priceItemSchema.index({ kind: 1, normalizedName: 1 }, { unique: true });
export type PriceItemDoc = InferSchemaType<typeof priceItemSchema>;
export const PriceItem = model('PriceItem', priceItemSchema);

/** سجل التغييرات السعرية — append-only; the effective price is the latest entry whose validFrom has arrived. */
const priceEntrySchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'PriceItem', required: true, index: true },
    priceHalalas: { type: Number, required: true },
    validFrom: { type: Date, required: true },
    byUserId: { type: Schema.Types.ObjectId },
    byEmail: { type: String },
    note: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
priceEntrySchema.index({ itemId: 1, validFrom: -1, at: -1 });
export const PriceEntry = model('PriceEntry', priceEntrySchema);

/** أسعار السوق الأسبوعية [SAL §3 م2, §7.1] — append-only, one row per item per week entered. */
const marketPriceSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'PriceItem', required: true, index: true },
    weekOf: { type: String, required: true }, // Riyadh Sunday, YYYY-MM-DD
    priceHalalas: { type: Number, required: true },
    source: { type: String },
    byUserId: { type: Schema.Types.ObjectId },
    byEmail: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
marketPriceSchema.index({ itemId: 1, weekOf: -1, at: -1 });
export const MarketPrice = model('MarketPrice', marketPriceSchema);
