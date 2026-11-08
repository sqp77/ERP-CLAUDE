import { News } from './model';
import { announce } from './service';

/**
 * Scheduled publishing windows [EP §12.2]: archive items whose window ended first, then announce items
 * whose `publishFrom` arrived (review G7: an ended window is never announced; the announcement is claimed
 * conditionally inside `announce`).
 */
export async function runNewsWindows(now = new Date()): Promise<{ announced: number; archived: number }> {
  const r = await News.updateMany(
    { state: 'published', publishTo: { $ne: null, $lt: now }, deletedAt: null },
    { $set: { state: 'archived', archivedAt: now, pinned: false } },
  );
  let announced = 0;
  const due = await News.find({
    state: 'published',
    notifiedAt: null,
    publishFrom: { $lte: now },
    $or: [{ publishTo: null }, { publishTo: { $gte: now } }],
    deletedAt: null,
  });
  for (const n of due) if (await announce(n, now)) announced++;
  return { announced, archived: r.modifiedCount };
}
