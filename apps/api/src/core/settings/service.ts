import { SETTING_DEFINITIONS, type SettingKey, type SettingValue } from '@eayni/shared';
import { badRequest } from '../http/errors';
import type { Actor } from '../http/context';
import { recordAudit } from '../audit/service';
import { Setting } from './model';

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 10_000;

export function clearSettingsCache(): void {
  cache.clear();
}

/** Current value of a setting: stored override, else the registry default. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingValue<K>;
  const doc = await Setting.findOne({ key }).lean();
  const def = SETTING_DEFINITIONS[key];
  const value = doc ? (doc.value as SettingValue<K>) : (def.default as SettingValue<K>);
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting<K extends SettingKey>(key: K, raw: unknown, actor: Actor): Promise<SettingValue<K>> {
  const def = SETTING_DEFINITIONS[key];
  if (!def) throw badRequest(`إعداد غير معروف: ${key}`);
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) throw badRequest('قيمة غير صالحة للإعداد', parsed.error.issues);
  const before = await Setting.findOne({ key }).lean();
  const doc = await Setting.findOneAndUpdate(
    { key },
    { $set: { value: parsed.data, updatedBy: actor.userId ?? actor.email } },
    { upsert: true, new: true },
  ).lean();
  cache.delete(key);
  await recordAudit(actor, {
    action: before ? 'update' : 'create',
    resource: 'settings',
    resourceId: key,
    before: before ? { value: before.value } : undefined,
    after: { value: doc?.value },
  });
  return doc!.value as SettingValue<K>;
}

export async function listSettings(): Promise<
  { key: string; labelAr: string; group: string; value: unknown; default: unknown; isDefault: boolean }[]
> {
  const stored = await Setting.find().lean();
  const byKey = new Map(stored.map((s) => [s.key, s.value]));
  return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
    const def = SETTING_DEFINITIONS[key];
    const has = byKey.has(key);
    return {
      key,
      labelAr: def.labelAr,
      group: def.group,
      value: has ? byKey.get(key) : def.default,
      default: def.default,
      isDefault: !has,
    };
  });
}
