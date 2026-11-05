import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

/**
 * One hook per lookup table, one cache entry per lookup (review C12). Every page that needs
 * departments, units, positions, branches, sites or roles goes through here, so the shape under a key
 * is always `{ items }` and an admin page can never poison an HR page's cache.
 */
export interface Lookup {
  _id: string;
  code?: string;
  nameAr?: string;
  titleAr?: string;
  parentId?: string | null;
  departmentId?: string;
  branchId?: string;
  city?: string;
  active?: boolean;
}
export interface RoleRow {
  _id: string;
  code: string;
  nameAr: string;
  system: boolean;
  departmentScoped: boolean;
  grants: { resource: string; actions: string[]; scope: string }[];
}

export const lookupKeys = {
  departments: (all: boolean) => ['lookup', 'departments', all] as const,
  units: ['lookup', 'units'] as const,
  positions: ['lookup', 'positions'] as const,
  branches: ['lookup', 'branches'] as const,
  sites: ['lookup', 'sites'] as const,
  roles: ['lookup', 'roles'] as const,
  employeesAll: ['lookup', 'employees'] as const,
};

const STALE = 60_000;

export const useDepartments = (all = true) =>
  useQuery({
    queryKey: lookupKeys.departments(all),
    queryFn: () => get<{ items: Lookup[] }>(`/org/departments${all ? '?all=true' : ''}`),
    staleTime: STALE,
  });
export const useUnits = () =>
  useQuery({
    queryKey: lookupKeys.units,
    queryFn: () => get<{ items: Lookup[] }>('/org/units?all=true'),
    staleTime: STALE,
  });
export const usePositions = () =>
  useQuery({
    queryKey: lookupKeys.positions,
    queryFn: () => get<{ items: Lookup[] }>('/org/positions?all=true'),
    staleTime: STALE,
  });
export const useBranches = () =>
  useQuery({
    queryKey: lookupKeys.branches,
    queryFn: () => get<{ items: Lookup[] }>('/org/branches?all=true'),
    staleTime: STALE,
  });
export const useSites = () =>
  useQuery({
    queryKey: lookupKeys.sites,
    queryFn: () => get<{ items: Lookup[] }>('/org/sites?all=true'),
    staleTime: STALE,
  });
export const useRoles = () =>
  useQuery({
    queryKey: lookupKeys.roles,
    queryFn: () => get<{ items: RoleRow[] }>('/roles'),
    staleTime: STALE,
  });

/** Name of a lookup row by id (department / unit / branch / site use nameAr, positions use titleAr). */
export function lookupName(items: Lookup[] | undefined, id?: string | null): string {
  const x = items?.find((i) => i._id === id);
  return x?.nameAr ?? x?.titleAr ?? '';
}
