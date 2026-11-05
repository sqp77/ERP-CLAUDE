import { useQuery } from '@tanstack/react-query';
import type { EmployeeStatus } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';
import i18n from '@/i18n';
import {
  lookupKeys,
  lookupName,
  useBranches,
  useDepartments,
  usePositions,
  useSites,
  useUnits,
  type Lookup,
} from '@/lib/lookups';

export type { Lookup };
export interface EmployeeRow {
  _id: string;
  employeeNumber: string;
  fullNameAr: string;
  workEmail: string;
  mobile?: string;
  departmentId: string;
  unitId?: string;
  positionId?: string;
  branchId?: string;
  directManagerId?: string;
  employmentType: string;
  status: EmployeeStatus;
  hireDate: string;
  userId?: string;
}
export interface EmployeeFull extends EmployeeRow {
  firstNameAr: string;
  lastNameAr: string;
  fullNameEn?: string;
  gender: 'male' | 'female';
  birthDate?: string;
  nationality: string;
  religion?: string;
  identity: { type: string; number?: string; numberMasked?: string; expiryDate?: string };
  extension?: string;
  address?: { buildingNo?: string; street?: string; district?: string; city?: string; postalCode?: string };
  siteId?: string;
  grade?: string;
  endDate?: string;
  secondment?: { destination?: string; startDate?: string; endDate?: string };
  basicSalaryHalalas?: number;
  allowances?: { type: string; amountHalalas: number }[];
  bank?: { bankName?: string; iban?: string; ibanMasked?: string };
  medicalInsurance?: boolean;
  statusAr: string;
}

/** Lookup tables used across HR screens — all from the shared lookup hooks (review C12). */
export function useHrLookups() {
  const departments = useDepartments(true);
  const units = useUnits();
  const positions = usePositions();
  const branches = useBranches();
  const sites = useSites();
  const employees = useQuery({
    queryKey: lookupKeys.employeesAll,
    queryFn: () => get<Paged<EmployeeRow>>('/hr/employees?limit=200'),
    staleTime: 60_000,
  });
  return {
    departments: departments.data?.items ?? [],
    units: units.data?.items ?? [],
    positions: positions.data?.items ?? [],
    branches: branches.data?.items ?? [],
    sites: sites.data?.items ?? [],
    employees: employees.data?.items ?? [],
    deptName: (id?: string | null) => lookupName(departments.data?.items, id),
    unitName: (id?: string | null) => lookupName(units.data?.items, id),
    positionName: (id?: string | null) => lookupName(positions.data?.items, id),
    branchName: (id?: string | null) => lookupName(branches.data?.items, id),
    siteName: (id?: string | null) => lookupName(sites.data?.items, id),
    employeeName: (id?: string | null) => employees.data?.items.find((e) => e._id === id)?.fullNameAr ?? '',
  };
}

export const sar = (halalas?: number) =>
  typeof halalas === 'number'
    ? `${(halalas / 100).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })} ${i18n.t('common.currency')}`
    : '—';
