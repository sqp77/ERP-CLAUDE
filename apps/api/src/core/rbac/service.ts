import {
  maxScope,
  type Action,
  type FieldRule,
  type PermissionGrant,
  type RoleAssignment,
  type Scope,
} from '@eayni/shared';
import { Role, type RoleDoc } from './model';
import { CORE_ROLES } from './defaults';

const cache = { roles: new Map<string, RoleDoc>(), at: 0 };
const TTL_MS = 10_000;

export function clearRoleCache(): void {
  cache.roles.clear();
  cache.at = 0;
}

export async function loadRoles(): Promise<Map<string, RoleDoc>> {
  if (cache.roles.size && Date.now() - cache.at < TTL_MS) return cache.roles;
  const docs = await Role.find().lean();
  cache.roles = new Map(docs.map((r) => [r.code, r as RoleDoc]));
  cache.at = Date.now();
  return cache.roles;
}

/** Insert missing core roles; never overwrite admin edits to existing ones. */
export async function ensureCoreRoles(): Promise<void> {
  for (const def of CORE_ROLES) {
    await Role.updateOne({ code: def.code }, { $setOnInsert: def }, { upsert: true });
  }
  clearRoleCache();
}

export interface Effective {
  scope: Scope;
  departmentIds: string[];
}

/**
 * Widest scope a user has for resource/action across all assigned roles.
 * Department-scoped role assignments contribute their departmentId when the grant scope is 'department'.
 */
export async function effectivePermission(
  assignments: RoleAssignment[],
  userDepartmentId: string | undefined,
  resource: string,
  action: Action,
): Promise<Effective | null> {
  const roles = await loadRoles();
  let scope: Scope | undefined;
  const departmentIds = new Set<string>();
  for (const a of assignments) {
    const role = roles.get(a.role);
    if (!role) continue;
    for (const g of role.grants as PermissionGrant[]) {
      if (g.resource !== resource || !g.actions.includes(action)) continue;
      scope = maxScope(scope, g.scope);
      if (g.scope === 'department') {
        if (a.departmentId) departmentIds.add(String(a.departmentId));
        else if (userDepartmentId) departmentIds.add(userDepartmentId);
      }
    }
  }
  if (!scope) return null;
  if (scope === 'department' && userDepartmentId) departmentIds.add(userDepartmentId);
  return { scope, departmentIds: [...departmentIds] };
}

/** All grants flattened for the UI (server still enforces). */
export async function flattenPermissions(assignments: RoleAssignment[]): Promise<PermissionGrant[]> {
  const roles = await loadRoles();
  const merged = new Map<string, PermissionGrant>();
  for (const a of assignments) {
    const role = roles.get(a.role);
    if (!role) continue;
    for (const g of role.grants as PermissionGrant[]) {
      const key = g.resource;
      const prev = merged.get(key);
      if (!prev) merged.set(key, { resource: g.resource, actions: [...g.actions], scope: g.scope });
      else {
        prev.actions = [...new Set([...prev.actions, ...g.actions])];
        prev.scope = maxScope(prev.scope, g.scope);
      }
    }
  }
  return [...merged.values()];
}

/** Field-level rules: fields the user may NOT view / edit for a resource, from all roles. */
export async function fieldRestrictions(
  assignments: RoleAssignment[],
  resource: string,
): Promise<{ hidden: Set<string>; readOnly: Set<string> }> {
  const roles = await loadRoles();
  const hidden = new Set<string>();
  const readOnly = new Set<string>();
  const seen = new Map<string, { view: boolean; edit: boolean }>();
  for (const a of assignments) {
    const role = roles.get(a.role);
    if (!role) continue;
    for (const r of role.fieldRules as FieldRule[]) {
      if (r.resource !== resource) continue;
      for (const f of r.fields) {
        const prev = seen.get(f) ?? { view: false, edit: false };
        seen.set(f, { view: prev.view || r.view, edit: prev.edit || r.edit });
      }
    }
  }
  for (const [f, v] of seen) {
    if (!v.view) hidden.add(f);
    if (!v.edit) readOnly.add(f);
  }
  return { hidden, readOnly };
}

/** Strip hidden fields from a plain object (field-level view rules). */
export function redact<T extends Record<string, unknown>>(doc: T, hidden: Set<string>): Partial<T> {
  if (!hidden.size) return doc;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!hidden.has(k)) out[k] = v;
  return out as Partial<T>;
}
