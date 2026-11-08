import { useQuery } from '@tanstack/react-query';
import type { ReportState } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface ReportRow {
  _id: string;
  number: string;
  type: string;
  title: string;
  body?: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  state: ReportState;
  submittedAt: string;
  userId: string;
  employeeId: string;
  employee?: { fullNameAr: string; employeeNumber: string };
  managerUserId?: string;
  notes: { by: string; byName?: string; byEmail?: string; note: string; at: string }[];
  attachmentIds: string[];
}
export interface ReportDetail extends ReportRow {
  body: string;
  attachments: { _id: string; originalName: string }[];
  managerName?: string;
  canNote: boolean;
}
export interface ReportType {
  code: string;
  labelAr: string;
}
export interface ReportRequestRow {
  _id: string;
  type: string;
  dueDate?: string;
  note?: string;
  managerName?: string;
  createdAt: string;
}

export const useReportTypes = () =>
  useQuery({ queryKey: ['reports', 'types'], queryFn: () => get<{ items: ReportType[] }>('/hr/employee-reports/types'), staleTime: 60_000 });
export const useReports = (params: Record<string, string | number | undefined>) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return useQuery({ queryKey: ['reports', params], queryFn: () => get<Paged<ReportRow>>(`/hr/employee-reports?${qs}`) });
};
export const useReportRequests = () =>
  useQuery({ queryKey: ['reports', 'requests'], queryFn: () => get<{ items: ReportRequestRow[] }>('/hr/employee-reports/requests') });
export const typeLabel = (types: ReportType[] | undefined, code: string) => types?.find((t) => t.code === code)?.labelAr ?? code;
