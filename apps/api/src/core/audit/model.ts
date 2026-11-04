import { Schema, model, type InferSchemaType } from 'mongoose';
import { AUDIT_ACTIONS } from '@eayni/shared';

/** Append-only audit log (golden rule 4). No update or delete paths exist for this collection. */
const auditLogSchema = new Schema(
  {
    at: { type: Date, default: () => new Date(), index: true },
    actorUserId: { type: String, index: true },
    actorEmail: { type: String },
    actorRoles: { type: [String], default: [] },
    system: { type: Boolean, default: false },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String, index: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    changedFields: { type: [String], default: [] },
    sensitive: { type: Boolean, default: false },
    ip: { type: String },
    requestId: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);
auditLogSchema.index({ resource: 1, resourceId: 1, at: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = model('AuditLog', auditLogSchema);
