import {
  DEPARTMENT_MANAGER_IMPLIED_ROLES,
  maxScope,
  SENSITIVE_FIELDS_BY_RESOURCE,
  TEAM_LEAD_GRANTS,
  type Action,
  type FieldRule,
  type PermissionGrant,
  type RoleAssignment,
  type RoleDefinition,
  type Scope,
} from '@eayni/shared';
import { Role, type RoleDoc } from './model';
import { CORE_ROLES } from './defaults';
import { resolveTeamUserIds } from './scope';
import { Department } from '../org/model';

const deptCodeCache = new Map<string, { code: string | undefined; at: number }>();
async function departmentCode(id: string): Promise<string | undefined> {
  const hit = deptCodeCache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.code;
  const d = await Department.findById(id).select('code').lean();
  deptCodeCache.set(id, { code: d?.code, at: Date.now() });
  return d?.code;
}

/**
 * Stored assignments plus the roles they imply (DECISIONS §20 change 3): a `department_manager` of a department
 * listed in DEPARTMENT_MANAGER_IMPLIED_ROLES carries that department's manager role, scoped to the same department.
 * Every permission, field-rule and role-code computation goes through here, so the implied role is never missing.
 */
export async function expandAssignments(
  assignments: RoleAssignment[],
  userDepartmentId?: string,
): Promise<RoleAssignment[]> {
  // Explicit copy: assignments may be Mongoose subdocuments, whose spread yields internals instead of `role`.
  const out: RoleAssignment[] = assignments.map((a) => ({
    role: a.role,
    ...(a.departmentId ? { departmentId: String(a.departmentId) } : {}),
  }));
  for (const a of assignments) {
    if (a.role !== 'department_manager') continue;
    const deptId = a.departmentId ? String(a.departmentId) : userDepartmentId;
    if (!deptId) continue;
    const code = await departmentCode(deptId);
    const implied = code ? DEPARTMENT_MANAGER_IMPLIED_ROLES[code] : undefined;
    if (implied && !out.some((x) => x.role === implied && String(x.departmentId ?? '') === deptId))
      out.push({ role: implied, departmentId: deptId, implied: true });
  }
  return out;
}

/** Role codes including implied ones, for `req.auth.roleCodes` and segregation-of-duties checks. */
export async function roleCodesOf(
  assignments: RoleAssignment[],
  userDepartmentId?: string,
): Promise<string[]> {
  return [...new Set((await expandAssignments(assignments, userDepartmentId)).map((a) => a.role))];
}

/** Direct managers (org chart) get TEAM_LEAD_GRANTS implicitly; no role is involved (DECISIONS §4). */
async function teamLeadGrantsFor(userId?: string): Promise<PermissionGrant[]> {
  if (!userId) return [];
  const team = await resolveTeamUserIds(userId);
  return team.length ? TEAM_LEAD_GRANTS : [];
}

const cache = { roles: new Map<string, RoleDoc>(), at: 0 };
const TTL_MS = 10_000;

export function clearRoleCache(): void {
  cache.roles.clear();
  cache.at = 0;
  deptCodeCache.clear();
}

export async function loadRoles(): Promise<Map<string, RoleDoc>> {
  if (cache.roles.size && Date.now() - cache.at < TTL_MS) return cache.roles;
  const docs = await Role.find().lean();
  cache.roles = new Map(docs.map((r) => [r.code, r as RoleDoc]));
  cache.at = Date.now();
  return cache.roles;
}

/**
 * Insert missing system roles and add default grants for resources never seeded into a role before (new modules).
 * A grant the admin removed from a system role stays removed (DECISIONS §20 change 1): `seededResources` remembers
 * what was seeded, so only genuinely new resources are added. Field rules of system roles stay code-defined.
 * Modules pass their own role definitions (bootstrap: core + sales).
 */
export async function ensureCoreRoles(defs: RoleDefinition[] = CORE_ROLES): Promise<void> {
  for (const def of defs) {
    // Race-safe for concurrent cold starts (review F4): upsert the role, add only never-seeded grants, sync field rules.
    await Role.updateOne(
      { code: def.code },
      { $setOnInsert: { ...def, grants: [], fieldRules: [], seededResources: [] } },
      { upsert: true },
    );
    const existing = await Role.findOne({ code: def.code }).lean();
    const defResources = def.grants.map((g) => g.resource);
    // Roles written before `seededResources` existed: the old baseline had already re-added every default
    // resource, so treat the resources currently granted as seeded and add only the ones still missing.
    const seeded = new Set(
      existing?.seededResources?.length
        ? existing.seededResources
        : ((existing?.grants ?? []) as PermissionGrant[]).map((g) => g.resource),
    );
    const toAdd = def.grants.filter((g) => !seeded.has(g.resource));
    const update: Record<string, unknown> = {
      $addToSet: {
        seededResources: { $each: defResources },
        ...(toAdd.length ? { grants: { $each: toAdd } } : {}),
      },
    };
    // Field-level rules of system roles are code-defined (default-deny for sensitive fields, review E1).
    if (JSON.stringify(existing?.fieldRules ?? null) !== JSON.stringify(def.fieldRules))
      update.$set = { fieldRules: def.fieldRules };
    await Role.updateOne({ code: def.code }, update);
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
  userId?: string,
): Promise<Effective | null> {
  const roles = await loadRoles();
  let scope: Scope | undefined;
  const departmentIds = new Set<string>();
  for (const g of await teamLeadGrantsFor(userId))
    if (g.resource === resource && g.actions.includes(action)) scope = maxScope(scope, g.scope);
  for (const a of await expandAssignments(assignments, userDepartmentId)) {
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
export async function flattenPermissions(
  assignments: RoleAssignment[],
  userId?: string,
  userDepartmentId?: string,
): Promise<PermissionGrant[]> {
  const roles = await loadRoles();
  const merged = new Map<string, PermissionGrant>();
  const sources: PermissionGrant[][] = [await teamLeadGrantsFor(userId)];
  for (const a of await expandAssignments(assignments, userDepartmentId)) {
    const role = roles.get(a.role);
    if (role) sources.push(role.grants as PermissionGrant[]);
  }
  for (const grants of sources) {
    for (const g of grants) {
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

/**
 * Field-level rules: fields the user may NOT view / edit for a resource, from all roles.
 * Sensitive fields of the resource are hidden by default and revealed only by an explicit `view: true`
 * rule on one of the assigned roles (go-live review E1); other fields follow the rules as before.
 */
export async function fieldRestrictions(
  assignments: RoleAssignment[],
  resource: string,
  userDepartmentId?: string,
): Promise<{ hidden: Set<string>; readOnly: Set<string> }> {
  const roles = await loadRoles();
  const hidden = new Set<string>();
  const readOnly = new Set<string>();
  const seen = new Map<string, { view: boolean; edit: boolean }>();
  for (const f of SENSITIVE_FIELDS_BY_RESOURCE[resource] ?? []) seen.set(f, { view: false, edit: false });
  for (const a of await expandAssignments(assignments, userDepartmentId)) {
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

/** Strip hidden fields from a plain object (field-level view rules). Supports dot paths ("bank.iban"). */
export function redact<T extends Record<string, unknown>>(doc: T, hidden: Set<string>): Partial<T> {
  if (!hidden.size) return doc;
  const out = structuredClone(doc) as Record<string, unknown>;
  for (const path of hidden) {
    const parts = path.split('.');
    let cur: Record<string, unknown> | undefined = out;
    for (let i = 0; i < parts.length - 1 && cur; i++)
      cur = cur[parts[i]] as Record<string, unknown> | undefined;
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  }
  return out as Partial<T>;
}
