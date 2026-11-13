import { Schema, model, type InferSchemaType } from 'mongoose';
import { EVENT_STATUSES, EVENT_TYPES } from '@eayni/shared';

/** One events store for all calendars [EP §13, SAL §9, MKT §9, OPS §3]. */
const eventSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    type: { type: String, enum: EVENT_TYPES, default: 'meeting', index: true },
    status: { type: String, enum: EVENT_STATUSES, default: 'scheduled' },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    location: { type: String },
    locationUrl: { type: String },
    meetingUrl: { type: String },
    description: { type: String },
    outcome: { type: String },
    nextFollowUpAt: { type: Date },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    participantIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    departmentIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    reminderMinutes: { type: [Number], default: [60] },
    remindersSent: { type: [Number], default: [] },
    link: { type: { type: String }, id: { type: String }, label: { type: String } },
    /** «نوع الاجتماع» [SAL §9]: a value of `sales.lists.meetingTypes`, free text while the list is empty (Q7). */
    meetingType: { type: String },
    /** «الجهة المنظمة» of an exhibition, conference or event that needs Marketing [SAL §9 الربط مع قسم التسويق]. */
    organizer: { type: String },
    needsMarketing: { type: Boolean, default: false },
    /** Set once when Marketing was told; a later edit never sends the notice again. */
    marketingNotifiedAt: { type: Date, default: null },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);
export type EventDoc = InferSchemaType<typeof eventSchema>;
export const CalendarEvent = model('CalendarEvent', eventSchema);
