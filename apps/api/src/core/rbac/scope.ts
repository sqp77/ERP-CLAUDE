import type { FilterQuery } from 'mongoose';
import type { Authz } from '../http/context';

/**
 * "Team" = people whose direct manager is this user. The employee record lives in the HR module
 * (phase 1), so the resolver is registered by HR; the core default knows no teams.
 */
export type TeamResolver = (userId: string) => Promise<string[]>;
let teamResolver: TeamResolver = async () => [];
export function registerTeamResolver(fn: TeamResolver): void {
  teamResolver = fn;
}
export const resolveTeamUserIds = (userId: string) => teamResolver(userId);

export interface ScopeFields {
  /** Field holding the owning user id (e.g. assigneeId, requesterId). May be several (OR). */
  ownerFields: string[];
  departmentField?: string;
}

/** Translate the effective scope into a Mongo filter fragment. */
export async function scopeFilter<T>(
  authz: Authz,
  userId: string,
  fields: ScopeFields,
): Promise<FilterQuery<T>> {
  if (authz.scope === 'all') return {};
  if (authz.scope === 'department' && fields.departmentField) {
    const own = fields.ownerFields.map((f) => ({ [f]: userId }));
    return { $or: [{ [fields.departmentField]: { $in: authz.departmentIds } }, ...own] } as FilterQuery<T>;
  }
  if (authz.scope === 'team') {
    const team = await resolveTeamUserIds(userId);
    const ids = [userId, ...team];
    return { $or: fields.ownerFields.map((f) => ({ [f]: { $in: ids } })) } as FilterQuery<T>;
  }
  return { $or: fields.ownerFields.map((f) => ({ [f]: userId })) } as FilterQuery<T>;
}
