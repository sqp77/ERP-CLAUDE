import { News } from './model';
import { announce } from './service';

/** Scheduled publishing windows [EP §12.2]: announce when `publishFrom` arrives, archive when `publishTo` passes. */
export async function runNewsWindows(now = new Date()): Promise<{ announced: number; archived: number }> {
  let announced = 0;
  for (const n of await News.find({ state: 'published', notifiedAt: null, publishFrom: { $lte: now }, deletedAt: null })) {
    await announce(n);
    announced++;
  }
  const r = await News.updateMany(
    { state: 'published', publishTo: { $ne: null, $lt: now }, deletedAt: null },
    { $set: { state: 'archived', archivedAt: now, pinned: false } },
  );
  return { announced, archived: r.modifiedCount };
}
