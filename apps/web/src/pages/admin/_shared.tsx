import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

export interface Dept {
  _id: string;
  code: string;
  nameAr: string;
  parentId?: string | null;
  active: boolean;
}
export const useDepartments = (all = true) =>
  useQuery({
    queryKey: ['departments', all],
    queryFn: () => get<{ items: Dept[] }>(`/org/departments${all ? '?all=true' : ''}`),
  });

export interface RoleRow {
  _id: string;
  code: string;
  nameAr: string;
  system: boolean;
  departmentScoped: boolean;
  grants: { resource: string; actions: string[]; scope: string }[];
}
export const useRoles = () =>
  useQuery({ queryKey: ['roles'], queryFn: () => get<{ items: RoleRow[] }>('/roles') });
