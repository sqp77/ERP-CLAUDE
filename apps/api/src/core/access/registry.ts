import type { AuthedRequest } from '../http/context';

/**
 * Record-level access registry (security review A3/A4). The module that owns a record type registers
 * a checker; files, documents and comments that hang on a record ask it before serving anything.
 * Unknown types fall back to "scope 'all' on the calling resource only".
 */
export type RecordAccessChecker = (
  req: AuthedRequest,
  recordId: string,
  ctx?: AccessContext,
) => Promise<boolean>;
const checkers = new Map<string, RecordAccessChecker>();
const sensitiveOwnerTypes = new Set<string>();

export function registerRecordAccess(recordType: string, fn: RecordAccessChecker): void {
  checkers.set(recordType, fn);
}

export async function canAccessRecord(
  req: AuthedRequest,
  recordType: string,
  recordId: string,
  ctx?: AccessContext,
): Promise<boolean> {
  const fn = checkers.get(recordType);
  if (fn) return fn(req, recordId, ctx);
  return req.authz?.scope === 'all';
}

/** Owner types whose attachments are always sensitive (audited downloads), decided by the server, not the client. */
export function registerSensitiveOwnerType(ownerType: string): void {
  sensitiveOwnerTypes.add(ownerType);
}
export function isSensitiveOwnerType(ownerType?: string | null): boolean {
  return !!ownerType && sensitiveOwnerTypes.has(ownerType);
}

/**
 * Who may read SENSITIVE attachments / documents of an owner type (go-live review E2): the owning module
 * registers it (HR: the employee themself or a role allowed to see sensitive employee fields). Without a
 * registration, record access alone decides.
 */
export type SensitiveViewer = (req: AuthedRequest, ownerId: string) => Promise<boolean>;
const sensitiveViewers = new Map<string, SensitiveViewer>();
export function registerSensitiveViewer(ownerType: string, fn: SensitiveViewer): void {
  sensitiveViewers.set(ownerType, fn);
}
export async function canViewSensitive(
  req: AuthedRequest,
  ownerType: string,
  ownerId: string,
): Promise<boolean> {
  const fn = sensitiveViewers.get(ownerType);
  return fn ? fn(req, ownerId) : canAccessRecord(req, ownerType, ownerId);
}

/** Record access with the attachment in hand (checkers may narrow by attachment, e.g. a direct manager and a secondment report). */
export interface AccessContext {
  attachmentId?: string;
}
