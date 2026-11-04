import type { ClientSession } from 'mongoose';
import type { AuditAction } from '@eayni/shared';
import type { Actor } from '../http/context';
import { AuditLog } from './model';

export interface AuditEntry {
  action: AuditAction;
  resource: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  sensitive?: boolean;
  meta?: Record<string, unknown>;
}

const STRIP = new Set(['passwordHash', 'totpSecret', 'totpPendingSecret', 'tokenHash', '__v']);

function clean(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const src = typeof (value as { toObject?: () => unknown }).toObject === 'function'
    ? ((value as { toObject: () => Record<string, unknown> }).toObject() as Record<string, unknown>)
    : (value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (STRIP.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function changedFields(before: unknown, after: unknown): string[] {
  const b = (clean(before) ?? {}) as Record<string, unknown>;
  const a = (clean(after) ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: string[] = [];
  for (const k of keys) {
    if (k === 'updatedAt' || k === 'createdAt') continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push(k);
  }
  return out;
}

/** Write one audit record. Called by every service that mutates data, and by sensitive reads. */
export async function recordAudit(actor: Actor, entry: AuditEntry, session?: ClientSession): Promise<void> {
  const before = clean(entry.before);
  const after = clean(entry.after);
  await AuditLog.create(
    [
      {
        actorUserId: actor.userId,
        actorEmail: actor.email,
        actorRoles: actor.roleCodes,
        system: actor.system ?? false,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        before,
        after,
        changedFields: entry.action === 'update' ? changedFields(before, after) : [],
        sensitive: entry.sensitive ?? false,
        ip: actor.ip,
        requestId: actor.requestId,
        meta: entry.meta,
      },
    ],
    { session },
  );
}
