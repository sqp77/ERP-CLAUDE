import { Schema, model, type InferSchemaType } from 'mongoose';
import { ACTIONS, SCOPES } from '@eayni/shared';

const grantSchema = new Schema(
  {
    resource: { type: String, required: true },
    actions: { type: [String], enum: ACTIONS, required: true },
    scope: { type: String, enum: SCOPES, required: true },
  },
  { _id: false },
);

const fieldRuleSchema = new Schema(
  {
    resource: { type: String, required: true },
    fields: { type: [String], required: true },
    view: { type: Boolean, default: true },
    edit: { type: Boolean, default: false },
  },
  { _id: false },
);

const roleSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    nameAr: { type: String, required: true },
    system: { type: Boolean, default: false },
    departmentScoped: { type: Boolean, default: false },
    grants: { type: [grantSchema], default: [] },
    fieldRules: { type: [fieldRuleSchema], default: [] },
  },
  { timestamps: true },
);

export type RoleDoc = InferSchemaType<typeof roleSchema>;
export const Role = model('Role', roleSchema);
