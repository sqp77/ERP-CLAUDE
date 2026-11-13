import type { RoleDefinition } from '@eayni/shared';

/**
 * Sales module roles [SAL §15, DECISIONS §20]. System roles: the admin tunes their grants from /admin/roles or
 * clones them into custom roles; segregation of duties stays in code (plan §5). The Sales department manager
 * carries `sales_manager` implicitly (DEPARTMENT_MANAGER_IMPLIED_ROLES).
 *
 * Resources: `crm.customers` (customers, contacts, communication logs), `crm.leads`, `sales.opportunities`,
 * `tags`. Scope `own` = records whose الموظف المسؤول is me; `department` = the Sales department.
 */
export const SALES_ROLES: RoleDefinition[] = [
  {
    code: 'sales_rep',
    nameAr: 'موظف مبيعات',
    system: true,
    departmentScoped: false,
    grants: [
      { resource: 'crm.customers', actions: ['view', 'create', 'edit'], scope: 'own' },
      { resource: 'crm.leads', actions: ['view', 'edit'], scope: 'own' },
      { resource: 'sales.opportunities', actions: ['view', 'create', 'edit'], scope: 'own' },
      { resource: 'sales.requests', actions: ['view', 'create', 'edit'], scope: 'own' },
      { resource: 'sales.quotes', actions: ['view', 'create', 'edit'], scope: 'own' },
      { resource: 'sales.contracts', actions: ['view', 'create', 'edit'], scope: 'own' },
      { resource: 'sales.pricelist', actions: ['view'], scope: 'all' },
      { resource: 'finance.invoices', actions: ['view'], scope: 'own' },
      { resource: 'tags', actions: ['view'], scope: 'all' },
      { resource: 'calendar', actions: ['view', 'create', 'edit'], scope: 'own' },
      { resource: 'comments', actions: ['view', 'create'], scope: 'own' },
      { resource: 'documents', actions: ['view'], scope: 'own' },
      // S4 [SAL §8.2, §11, §13, §15 «متابعة المهام والمستهدفات الخاصة به»]
      { resource: 'sales.targets', actions: ['view'], scope: 'own' },
      { resource: 'sales.kpi', actions: ['view'], scope: 'own' },
      { resource: 'sales.dashboard', actions: ['view'], scope: 'own' },
      { resource: 'sales.library', actions: ['view'], scope: 'department' },
    ],
    fieldRules: [],
  },
  {
    code: 'sales_manager',
    nameAr: 'مدير المبيعات',
    system: true,
    departmentScoped: true,
    grants: [
      {
        resource: 'crm.customers',
        actions: ['view', 'create', 'edit', 'approve', 'export'],
        scope: 'department',
      },
      { resource: 'crm.leads', actions: ['view', 'create', 'edit', 'approve'], scope: 'department' },
      {
        resource: 'sales.opportunities',
        actions: ['view', 'create', 'edit', 'approve', 'export'],
        scope: 'department',
      },
      {
        resource: 'sales.requests',
        actions: ['view', 'create', 'edit', 'approve', 'export'],
        scope: 'department',
      },
      {
        resource: 'sales.quotes',
        actions: ['view', 'create', 'edit', 'approve', 'export'],
        scope: 'department',
      },
      {
        resource: 'sales.contracts',
        actions: ['view', 'create', 'edit', 'approve', 'export'],
        scope: 'department',
      },
      { resource: 'sales.pricelist', actions: ['view', 'edit'], scope: 'all' },
      { resource: 'finance.invoices', actions: ['view'], scope: 'department' },
      { resource: 'tags', actions: ['view', 'create', 'edit', 'delete'], scope: 'department' },
      { resource: 'calendar', actions: ['view', 'create', 'edit'], scope: 'department' },
      { resource: 'comments', actions: ['view', 'create'], scope: 'department' },
      { resource: 'documents', actions: ['view'], scope: 'department' },
      { resource: 'exports', actions: ['view', 'create'], scope: 'department' },
      // S4 [SAL §8.2 «رفع إجراءات العمل والتعليمات», §8.3, §11.1 «تحديد المستهدفات», §13]
      { resource: 'sales.targets', actions: ['view', 'edit'], scope: 'department' },
      { resource: 'sales.kpi', actions: ['view'], scope: 'department' },
      { resource: 'sales.dashboard', actions: ['view'], scope: 'department' },
      { resource: 'sales.library', actions: ['view', 'create', 'edit', 'delete'], scope: 'department' },
    ],
    fieldRules: [],
  },
];
