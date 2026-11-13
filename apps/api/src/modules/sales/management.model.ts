import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  SALES_LIBRARY_CATEGORIES,
  SALES_TARGET_DIMENSIONS,
  SALES_TARGET_METRICS,
  SALES_TARGET_SCOPES,
} from '@eayni/shared';

/**
 * Monthly targets [SAL §11.1]: APPEND-ONLY versions (golden rule 3). «أي تعديل أو سحب للمستهدف يجب أن يحفظ القيمة القديمة
 * والقيمة الجديدة، واسم من قام بالتعديل، وتاريخ ووقت التعديل، وسبب التعديل؛ عدم استبدال القيمة القديمة». The current target
 * of a key is its highest version unless that version withdrew it. `key` = period|scope|user|dimension|dimensionKey|metric.
 */
const targetVersionSchema = new Schema(
  {
    key: { type: String, required: true },
    period: { type: String, required: true, index: true },
    scope: { type: String, enum: SALES_TARGET_SCOPES, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    dimension: { type: String, enum: SALES_TARGET_DIMENSIONS, default: 'none' },
    dimensionKey: { type: String },
    metric: { type: String, enum: SALES_TARGET_METRICS, default: 'revenue' },
    /** Halalas (revenue) or kilograms (quantity). */
    value: { type: Number, required: true },
    previousValue: { type: Number, default: null },
    version: { type: Number, required: true },
    withdrawn: { type: Boolean, default: false },
    reason: { type: String },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
// The unique pair makes a concurrent second write of the same version fail (409) instead of forking history.
targetVersionSchema.index({ key: 1, version: 1 }, { unique: true });
export type SalesTargetVersionDoc = InferSchemaType<typeof targetVersionSchema>;
export const SalesTargetVersion = model('SalesTargetVersion', targetVersionSchema);

/**
 * Sales documents library [SAL §8.2 «رفع إجراءات العمل والتعليمات بصيغة PDF»]. A new upload of an existing document is
 * a new row (`version`, `previousId`); the replaced row keeps its file and gets `replacedById`. Soft delete only.
 */
const libraryDocSchema = new Schema(
  {
    title: { type: String, required: true },
    category: { type: String, enum: SALES_LIBRARY_CATEGORIES, required: true },
    description: { type: String },
    attachmentId: { type: Schema.Types.ObjectId, ref: 'Attachment', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    version: { type: Number, default: 1 },
    previousId: { type: Schema.Types.ObjectId, ref: 'SalesLibraryDoc' },
    replacedById: { type: Schema.Types.ObjectId, ref: 'SalesLibraryDoc', default: null },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedByName: { type: String },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export type SalesLibraryDocDoc = InferSchemaType<typeof libraryDocSchema>;
export const SalesLibraryDoc = model('SalesLibraryDoc', libraryDocSchema);
