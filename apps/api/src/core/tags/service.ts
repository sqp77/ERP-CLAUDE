import { normalizeArabic } from '@eayni/shared';
import { badRequest } from '../http/errors';
import { Tag } from './model';

export const normalizeTag = (name: string) =>
  normalizeArabic(name.startsWith('#') ? name : `#${name}`).toLowerCase();

/** Seed a scope's default tags once (idempotent); the department manager edits them afterwards [SAL §10.4]. */
export async function ensureDefaultTags(scope: string, names: readonly string[]): Promise<void> {
  for (const name of names)
    await Tag.updateOne(
      { scope, normalizedName: normalizeTag(name) },
      { $setOnInsert: { scope, name, normalizedName: normalizeTag(name) } },
      { upsert: true },
    );
}

/**
 * Records may only carry tags that exist in their scope (reps pick, the manager defines). Returns the canonical
 * names so a record never stores a variant spelling.
 */
export async function canonicalTags(scope: string, names: readonly string[]): Promise<string[]> {
  if (!names.length) return [];
  const wanted = [...new Set(names.map(normalizeTag))];
  const found = await Tag.find({ scope, normalizedName: { $in: wanted } }).lean();
  const byNorm = new Map(found.map((t) => [t.normalizedName, t.name]));
  const missing = wanted.filter((n) => !byNorm.has(n));
  if (missing.length) throw badRequest(`وسوم غير معرّفة: ${missing.join('، ')} — يضيفها مدير القسم أولًا`);
  return wanted.map((n) => byNorm.get(n)!);
}

/** Rename hook: modules register how to rewrite a tag on their records. */
type Renamer = (scope: string, from: string, to: string) => Promise<void>;
const renamers: Renamer[] = [];
export function registerTagRenamer(fn: Renamer): void {
  renamers.push(fn);
}
export async function renameTagOnRecords(scope: string, from: string, to: string): Promise<void> {
  for (const fn of renamers) await fn(scope, from, to);
}
