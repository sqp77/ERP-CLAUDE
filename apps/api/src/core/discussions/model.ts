import { Schema, model, type InferSchemaType } from 'mongoose';
import { DISCUSSION_STATES } from '@eayni/shared';

/**
 * Department discussions [SAL §10.3 «الدردشة الداخلية بين الأقسام»]: a thread tied to a record (customer, request,
 * quote, contract, invoice…), routed to the department that must act. Core capability: any module's record type that
 * registers a resolver and an access checker can carry discussions. The thread itself lives in `DiscussionEntry`
 * (append-only, golden rule 3); the discussion row holds the routing and the processing state.
 */
const discussionSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    recordType: { type: String, required: true },
    recordId: { type: String, required: true },
    /** Label of the record at opening (number or name), so the target department reads it without record access. */
    recordLabel: { type: String },
    title: { type: String, required: true },
    details: { type: String, required: true },
    openedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    openedByName: { type: String },
    openedByDepartmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
    targetDepartmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    participantUserIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    attachmentIds: { type: [Schema.Types.ObjectId], ref: 'Attachment', default: [] },
    state: { type: String, enum: DISCUSSION_STATES, default: 'new', index: true },
    lastActivityAt: { type: Date, default: () => new Date(), index: true },
    lastActivityByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true },
);
discussionSchema.index({ recordType: 1, recordId: 1, createdAt: -1 });
export type DiscussionDoc = InferSchemaType<typeof discussionSchema>;
export const Discussion = model('Discussion', discussionSchema);

export const DISCUSSION_ENTRY_KINDS = ['opened', 'message', 'state', 'participants'] as const;

/** The conversation record, kept until (and after) the problem is closed [SAL §10.3 «الاحتفاظ بسجل المحادثة»]. */
const entrySchema = new Schema(
  {
    discussionId: { type: Schema.Types.ObjectId, ref: 'Discussion', required: true },
    kind: { type: String, enum: DISCUSSION_ENTRY_KINDS, required: true },
    body: { type: String },
    fromState: { type: String },
    toState: { type: String },
    /** A state change made by the system (first reply of the handling department, the requester answering). */
    auto: { type: Boolean, default: false },
    attachmentIds: { type: [Schema.Types.ObjectId], ref: 'Attachment', default: [] },
    participantUserIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String },
    authorDepartmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
entrySchema.index({ discussionId: 1, at: 1 });
export const DiscussionEntry = model('DiscussionEntry', entrySchema);
