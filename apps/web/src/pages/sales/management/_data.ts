import { useQuery } from '@tanstack/react-query';
import type { KpiStatus, SalesLibraryCategory, SalesTargetDimension, SalesTargetMetric } from '@eayni/shared';
import { get } from '@/lib/api';
import i18n from '@/i18n';
import { sar } from '../../hr/_data';

/** Sales S4 data hooks [SAL §8.2, §11, §11.1, §11.2, §13]. Figures come from the API, computed from Finance data. */

export type KpiUnit = 'halalas' | 'kg' | 'bp' | 'days' | 'count' | 'halalas_per_ton';
export interface KpiValue {
  code: string;
  nameAr: string;
  unit: KpiUnit;
  direction: 'higher' | 'lower';
  actual: number | null;
  target: number | null;
  status: KpiStatus;
  expectedNow?: number | null;
  pace?: 'ahead' | 'behind' | null;
}
export interface BoardCard {
  value: number | null;
  link?: string;
  amountHalalas?: number | null;
}
export interface KpiResponse {
  period: string;
  scope: string;
  financeDataAvailable: boolean;
  kpis: KpiValue[];
  materials: {
    itemId: string | null;
    nameAr: string;
    kg: number;
    revenueHalalas: number;
    pricePerTonHalalas: number | null;
    marketPerTonHalalas: number | null;
  }[];
  board: Record<
    | 'monthlyTarget'
    | 'achieved'
    | 'achievementBp'
    | 'remaining'
    | 'newCustomers'
    | 'opportunities'
    | 'quotesSent'
    | 'quotesAccepted'
    | 'quotesRejected'
    | 'revenue'
    | 'unpaidInvoices'
    | 'avgCollectionDays',
    BoardCard
  >;
}
export interface DashboardEmployee {
  userId: string;
  name: string;
  target: number | null;
  achieved: number | null;
  achievementBp: number | null;
  openTasks: number;
  scheduledMeetings: number;
  links: { customers: string; invoices: string; tasks: string };
}
export interface DashboardResponse {
  period: string;
  scope: string;
  financeDataAvailable: boolean;
  sales: Record<
    | 'revenue'
    | 'achieved'
    | 'monthlyTarget'
    | 'achievementBp'
    | 'remaining'
    | 'openDealsValue'
    | 'won'
    | 'lost',
    BoardCard
  >;
  customers: Record<'total' | 'new' | 'potential' | 'active' | 'followUpDue' | 'referredFromCs', BoardCard>;
  opportunities: Record<
    'new' | 'inProgress' | 'quotesSent' | 'quotesAccepted' | 'quotesRejected' | 'followUpOverdue',
    BoardCard
  >;
  employees: DashboardEmployee[];
  collection: Record<'invoices' | 'paid' | 'unpaid' | 'overdue' | 'avgCollectionDays', BoardCard>;
  budget: {
    revenueHalalas: number | null;
    spentHalalas: number | null;
    remainingBudgetHalalas: number | null;
    budgetsAvailable: boolean;
  };
  kpis: KpiValue[];
}
export interface TargetVersion {
  _id: string;
  key: string;
  period: string;
  scope: 'department' | 'user';
  userId?: string;
  dimension: SalesTargetDimension;
  dimensionKey?: string;
  metric: SalesTargetMetric;
  value: number;
  previousValue: number | null;
  version: number;
  withdrawn: boolean;
  reason?: string;
  byName?: string;
  at: string;
}
export interface TargetRow extends TargetVersion {
  userName?: string;
  dimensionLabel?: string;
  achieved: number | null;
  achievementBp: number | null;
  met: boolean | null;
  history: TargetVersion[];
}
export interface TargetsResponse {
  periods: string[];
  financeDataAvailable: boolean;
  items: TargetRow[];
  withdrawn: TargetVersion[][];
}
export interface LibraryDoc {
  _id: string;
  title: string;
  category: SalesLibraryCategory;
  description?: string;
  attachmentId: string;
  version: number;
  versions: number;
  uploadedByName?: string;
  createdAt: string;
}

const qs = (p: Record<string, string | number | boolean | undefined>) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const useSalesKpi = (p: { period?: string; userId?: string; serviceType?: string }) =>
  useQuery({
    queryKey: ['sales', 'kpi', p],
    queryFn: () => get<KpiResponse>(`/sales/management/kpi?${qs(p)}`),
  });
export const useSalesDashboard = (period?: string) =>
  useQuery({
    queryKey: ['sales', 'dashboard', period ?? ''],
    queryFn: () => get<DashboardResponse>(`/sales/management/dashboard?${qs({ period })}`),
  });
export const useSalesTargets = (p: { period?: string; from?: string; to?: string; userId?: string }) =>
  useQuery({
    queryKey: ['sales', 'targets', p],
    queryFn: () => get<TargetsResponse>(`/sales/management/targets?${qs(p)}`),
  });
export const useSalesLibrary = () =>
  useQuery({
    queryKey: ['sales', 'library'],
    queryFn: () => get<{ items: LibraryDoc[]; canManage: boolean }>('/sales/management/library'),
  });
export const useLibraryHistory = (id: string | null) =>
  useQuery({
    queryKey: ['sales', 'library', id, 'history'],
    queryFn: () =>
      get<{ items: (LibraryDoc & { replacedById?: string })[] }>(`/sales/management/library/${id}/history`),
    enabled: !!id,
  });

/** Current month in Riyadh time, `YYYY-MM`. */
export function currentPeriod(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
}

const num = (n: number, digits = 0) =>
  n.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const tons = (kg: number | null | undefined) =>
  typeof kg === 'number' ? `${num(kg / 1000, 3)} ${i18n.t('sales.kpi.tonUnit')}` : '—';
export const pct = (bp: number | null | undefined) => (typeof bp === 'number' ? `${num(bp / 100, 1)}%` : '—');
export const days = (d: number | null | undefined) =>
  typeof d === 'number' ? `${num(d, 1)} ${i18n.t('sales.kpi.dayUnit')}` : '—';

/** Display a KPI value in its unit. */
export function formatKpi(unit: KpiUnit, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  switch (unit) {
    case 'halalas':
      return sar(v);
    case 'halalas_per_ton':
      return `${sar(v)} / ${i18n.t('sales.kpi.tonUnit')}`;
    case 'kg':
      return tons(v);
    case 'bp':
      return pct(v);
    case 'days':
      return days(v);
    default:
      return num(v);
  }
}

export const kpiTone: Record<KpiStatus, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  below: 'red',
  achieved: 'green',
  exceeded: 'brand',
  no_target: 'slate',
  no_data: 'slate',
};
