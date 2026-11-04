import { Schema, model, type InferSchemaType } from 'mongoose';

/** Org structure [HR §3.1]: departments, units, branches, operating sites (geofence), positions. */
const departmentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    nameAr: { type: String, required: true },
    nameEn: { type: String },
    parentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    managerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export type DepartmentDoc = InferSchemaType<typeof departmentSchema>;
export const Department = model('Department', departmentSchema);

const unitSchema = new Schema(
  {
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    nameAr: { type: String, required: true },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export const Unit = model('Unit', unitSchema);

const branchSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    nameAr: { type: String, required: true },
    region: { type: String },
    city: { type: String },
    address: { type: String },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export const Branch = model('Branch', branchSchema);

const siteSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    nameAr: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] }, // [lng, lat]
    },
    geofenceRadiusM: { type: Number },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
siteSchema.index({ location: '2dsphere' }, { sparse: true });
export const Site = model('Site', siteSchema);

const positionSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    titleAr: { type: String, required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    grade: { type: String },
    descriptionAr: { type: String },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export const Position = model('Position', positionSchema);
