import type { AuthedRequest } from '../http/context';

/**
 * Record-level access registry (security review A3/A4). The module that owns a record type registers
 * a checker; files, documents and comments that hang on a record ask it before serving anything.
 * Unknown types fall back to "scope 'all' on the calling resource only".
 */
export type RecordAccessChecker = (req: AuthedRequest, recordId: string) => Promise<boolean>;
const checkers = new Map<string, RecordAccessChecker>();
const sensitiveOwnerTypes = new Set<string>();

export function registerRecordAccess(recordType: string, fn: RecordAccessChecker): void {
  checkers.set(recordType, fn);
}

export async function canAccessRecord(req: AuthedRequest, recordType: string, recordId: string): Promise<boolean> {
  const fn = checkers.get(recordType);
  if (fn) return fn(req, recordId);
  return req.authz?.scope === 'all';
}

/** Owner types whose attachments are always sensitive (audited downloads), decided by the server, not the client. */
export function registerSensitiveOwnerType(ownerType: string): void {
  sensitiveOwnerTypes.add(ownerType);
}
export function isSensitiveOwnerType(ownerType?: string | null): boolean {
  return !!ownerType && sensitiveOwnerTypes.has(ownerType);
}
