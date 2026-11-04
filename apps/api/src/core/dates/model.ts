import { Schema, model } from 'mongoose';

/** Public holidays used by every SLA computation (CLAUDE.md "Business days"). */
const holidaySchema = new Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD in Asia/Riyadh
    nameAr: { type: String, required: true },
  },
  { timestamps: true },
);
export const Holiday = model('Holiday', holidaySchema);
