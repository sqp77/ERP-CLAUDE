import type { ClientSession } from 'mongoose';
import { NUMBER_PREFIXES, type NumberPrefixKey } from '@eayni/shared';
import { Counter } from './model';

/**
 * `PREFIX-YYYY-#####` from an atomic counter per prefix and year (CLAUDE.md "Numbering").
 * The year is the Gregorian year in Asia/Riyadh at issue time.
 */
export async function nextNumber(kind: NumberPrefixKey | string, session?: ClientSession, now = new Date()): Promise<string> {
  const prefix = (NUMBER_PREFIXES as Record<string, string>)[kind] ?? kind.toUpperCase();
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric' }).format(now);
  const key = `${prefix}-${year}`;
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session: session ?? null },
  ).lean();
  const seq = doc!.seq;
  return `${key}-${String(seq).padStart(5, '0')}`;
}
