/**
 * RBAC model (CLAUDE.md "Platform core → RBAC", HR §6, EP §16):
 * permission = resource × action × scope, plus field-level rules for sensitive fields.
 * "Direct manager" and "team" come from the org chart, never from a role (DECISIONS §4).
 */
export const ACTIONS = ['view', 'create', 'edit', 'approve', 'delete', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

export const SCOPES = ['own', 'team', 'department', 'all'] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_RANK: Record<Scope, number> = { own: 0, team: 1, department: 2, all: 3 };

/** Resources known to the platform core. Modules add their own in their packages. */
export const CORE_RESOURCES = [
  'users',
  'roles',
  'settings',
  'audit',
  'org.departments',
  'org.units',
  'org.branches',
  'org.sites',
  'org.positions',
  'holidays',
  'workflows',
  'files',
  'notifications',
  'tasks',
  'calendar',
  'documents',
  'comments',
  'drafts',
  'exports',
] as const;
export type CoreResource = (typeof CORE_RESOURCES)[number];
/** Any resource id (core or module). */
export type Resource = string;

export interface PermissionGrant {
  resource: Resource;
  actions: Action[];
  scope: Scope;
}

/** Field-level rule: which fields of a resource a role may view / edit. Absent → governed by the grant alone. */
export interface FieldRule {
  resource: Resource;
  fields: string[];
  view: boolean;
  edit: boolean;
}

export interface RoleDefinition {
  code: string;
  nameAr: string;
  /** System roles are seeded and cannot be deleted; their grants can still be edited by the admin. */
  system: boolean;
  /** When true the role is assigned together with a departmentId and all its department-scoped grants apply to it. */
  departmentScoped: boolean;
  grants: PermissionGrant[];
  fieldRules: FieldRule[];
}

/** Role assignment stored on a user. */
export interface RoleAssignment {
  role: string;
  departmentId?: string;
}

export const ALL_ACTIONS: Action[] = [...ACTIONS];

export function maxScope(a: Scope | undefined, b: Scope): Scope {
  if (!a) return b;
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** Core role codes (DECISIONS §4). Module roles (sales_rep, ops_field…) are added by their modules. */
export const CORE_ROLE_CODES = [
  'system_admin',
  'employee',
  'department_manager',
  'hr_officer',
  'hr_manager',
  'finance_staff',
  'finance_manager',
  'executive',
] as const;
export type CoreRoleCode = (typeof CORE_ROLE_CODES)[number];
