import { useQuery } from '@tanstack/react-query';
import type { EmployeeStatus } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface Lookup {
  _id: string;
  nameAr?: string;
  titleAr?: string;
  code?: string;
  departmentId?: string;
  branchId?: string;
}
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

const list = <T>(path: string) => get<{ items: T[] }>(path).then((r) => r.items);

/** Lookup tables used across HR screens. */
export function useHrLookups() {
  const departments = useQuery({
    queryKey: ['departments', true],
    queryFn: () => list<Lookup>('/org/departments?all=true'),
  });
  const units = useQuery({ queryKey: ['units'], queryFn: () => list<Lookup>('/org/units?all=true') });
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: () => list<Lookup>('/org/positions?all=true'),
  });
  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => list<Lookup>('/org/branches?all=true'),
  });
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => list<Lookup>('/org/sites?all=true') });
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => get<Paged<EmployeeRow>>('/hr/employees?limit=200').then((r) => r.items),
  });
  const name = (items: Lookup[] | undefined, id?: string | null) => {
    const x = items?.find((i) => i._id === id);
    return x?.nameAr ?? x?.titleAr ?? '';
  };
  return {
    departments: departments.data ?? [],
    units: units.data ?? [],
    positions: positions.data ?? [],
    branches: branches.data ?? [],
    sites: sites.data ?? [],
    employees: employees.data ?? [],
    deptName: (id?: string | null) => name(departments.data, id),
    unitName: (id?: string | null) => name(units.data, id),
    positionName: (id?: string | null) => name(positions.data, id),
    branchName: (id?: string | null) => name(branches.data, id),
    siteName: (id?: string | null) => name(sites.data, id),
    employeeName: (id?: string | null) => employees.data?.find((e) => e._id === id)?.fullNameAr ?? '',
  };
}

export const sar = (halalas?: number) =>
  typeof halalas === 'number'
    ? `${(halalas / 100).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })} ر.س`
    : '—';
