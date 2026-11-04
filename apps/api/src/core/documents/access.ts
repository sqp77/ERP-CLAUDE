import type { AuthedRequest } from '../http/context';

/** Who may read/write documents of an owner type. Registered by the owning module; default: 'all' scope only. */
export type DocumentAccessChecker = (req: AuthedRequest, ownerId: string) => Promise<boolean>;
const checkers = new Map<string, DocumentAccessChecker>();
export function registerDocumentAccess(ownerType: string, fn: DocumentAccessChecker): void {
  checkers.set(ownerType, fn);
}
export async function canAccessDocuments(
  req: AuthedRequest,
  ownerType: string,
  ownerId: string,
): Promise<boolean> {
  const fn = checkers.get(ownerType);
  if (fn) return fn(req, ownerId);
  return req.authz?.scope === 'all';
}
