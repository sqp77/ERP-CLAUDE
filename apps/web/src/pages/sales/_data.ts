import { useQuery } from '@tanstack/react-query';
import type {
  CommunicationMethod,
  CustomerClassification,
  CustomerSource,
  CustomerStatus,
  LeadState,
  OpportunityStage,
  SalesServiceType,
} from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface CustomerRow {
  _id: string;
  number: string;
  kind: 'organization' | 'individual';
  nameAr: string;
  country?: string;
  region?: string;
  city?: string;
  activity?: string;
  organizationType?: string;
  facilitySize?: string;
  source: CustomerSource;
  sourceNote?: string;
  status: CustomerStatus;
  classification?: CustomerClassification;
  phone?: string;
  email?: string;
  notes?: string;
  tags: string[];
  ownerUserId: string;
  ownerName?: string;
  leadId?: string;
  lastContactAt?: string;
  nextFollowUpAt?: string;
  createdAt: string;
}
export interface ContactRow {
  _id: string;
  nameAr: string;
  jobTitle?: string;
  phone?: string;
  email?: string;
  notes?: string;
}
export interface CustomerEventRow {
  _id: string;
  type: 'created' | 'owner_changed' | 'status_changed' | 'classification_changed' | 'updated' | 'lead_linked';
  from?: string;
  to?: string;
  fromUserName?: string;
  toUserName?: string;
  byUserName?: string;
  reason?: string;
  at: string;
}
export interface CustomerDetail extends CustomerRow {
  createdByName?: string;
  party: null | {
    id: string;
    legalNameAr: string;
    crNumber?: string;
    unifiedNumber?: string;
    vatNumber?: string;
    nationalAddress?: string;
  };
  contacts: ContactRow[];
  events: CustomerEventRow[];
  canManage: boolean;
}
export interface LogRow {
  _id: string;
  authorName?: string;
  at: string;
  method: CommunicationMethod;
  details: string;
  outcome?: string;
  customerNeed?: string;
  nextStep?: string;
  nextFollowUpAt?: string;
  attachmentIds: string[];
  opportunityId?: string;
  /** Written by the system from another record (a calendar meeting's outcome — SAL §9). */
  source?: { type: string; id: string; label?: string };
}
export interface OpportunityRow {
  _id: string;
  number: string;
  customerId: string;
  customerName?: string;
  customerNumber?: string;
  title: string;
  serviceType?: SalesServiceType;
  stage: OpportunityStage;
  expectedValueHalalas?: number;
  ownerUserId: string;
  ownerName?: string;
  nextFollowUpAt?: string;
  lastContactAt?: string;
  lostReason?: string;
  lostNote?: string;
  tags: string[];
  attachmentIds: string[];
  leadId?: string;
  updatedAt: string;
}
export interface OpportunityDetail extends OpportunityRow {
  events: {
    _id: string;
    type: string;
    from?: string;
    to?: string;
    byUserName?: string;
    fromUserName?: string;
    toUserName?: string;
    note?: string;
    at: string;
  }[];
  canManage: boolean;
}
export interface LeadRow {
  _id: string;
  number: string;
  customerName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  interest: string;
  channel?: string;
  notes?: string;
  targetDepartment: 'sales' | 'sustainability';
  referredByName?: string;
  referredAt: string;
  assigneeUserId?: string;
  assigneeName?: string;
  registeredAt?: string;
  registrationDeadline: string;
  overdue: boolean;
  state: LeadState;
  outcome?: string;
  customerId?: string;
  opportunityId?: string;
}
export interface LeadDetail extends LeadRow {
  events: {
    _id: string;
    type: string;
    from?: string;
    to?: string;
    byEmail?: string;
    note?: string;
    at: string;
  }[];
  canManage: boolean;
}
export interface CrmMeta {
  organizationTypes: string[];
  facilitySizes: string[];
  lossReasons: string[];
  registrationHours: number;
  canReferLeads: boolean;
}
export interface Person {
  userId: string;
  fullNameAr: string;
  departmentId?: string;
}
export interface TagRow {
  _id: string;
  scope: string;
  name: string;
  color?: string;
}
export interface SalesHome {
  myCustomers: number;
  followUpsDue: number;
  openOpportunities: number;
  overdueOpportunities: number;
  leadsForMe: number;
  deptCustomers: number | null;
  unassignedLeads: number | null;
  isManager: boolean;
}

const qs = (params: Record<string, string | number | boolean | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const useCrmMeta = () =>
  useQuery({ queryKey: ['crm', 'meta'], queryFn: () => get<CrmMeta>('/crm/meta'), staleTime: 60_000 });
export const useSalesTeam = (enabled = true) =>
  useQuery({
    queryKey: ['crm', 'sales-team'],
    queryFn: () => get<{ items: Person[] }>('/crm/sales-team'),
    enabled,
    staleTime: 60_000,
  });
export const useSalesTags = () =>
  useQuery({
    queryKey: ['tags', 'sales'],
    queryFn: () => get<{ items: TagRow[] }>('/tags?scope=sales'),
    staleTime: 60_000,
  });
export const useCustomers = (params: Record<string, string | number | boolean | undefined>) =>
  useQuery({
    queryKey: ['crm', 'customers', params],
    queryFn: () => get<Paged<CustomerRow>>(`/crm/customers?${qs(params)}`),
  });
export const useCustomer = (id: string) =>
  useQuery({
    queryKey: ['crm', 'customer', id],
    queryFn: () => get<CustomerDetail>(`/crm/customers/${id}`),
    enabled: !!id,
  });
export const useCustomerLogs = (id: string) =>
  useQuery({
    queryKey: ['crm', 'customer', id, 'logs'],
    queryFn: () => get<{ items: LogRow[] }>(`/crm/customers/${id}/logs`),
    enabled: !!id,
  });
export const useOpportunities = (
  params: Record<string, string | number | boolean | undefined>,
  enabled = true,
) =>
  useQuery({
    queryKey: ['sales', 'opportunities', params],
    queryFn: () => get<Paged<OpportunityRow>>(`/sales/opportunities?${qs(params)}`),
    enabled,
  });
export const useOpportunity = (id: string | null) =>
  useQuery({
    queryKey: ['sales', 'opportunity', id],
    queryFn: () => get<OpportunityDetail>(`/sales/opportunities/${id}`),
    enabled: !!id,
  });
export const usePipeline = (ownerUserId?: string) =>
  useQuery({
    queryKey: ['sales', 'pipeline', ownerUserId ?? ''],
    queryFn: () =>
      get<{ stages: Record<string, { count: number; valueHalalas: number; overdue: number }> }>(
        `/sales/opportunities/pipeline${ownerUserId ? `?ownerUserId=${ownerUserId}` : ''}`,
      ),
  });
export const useLeads = (params: Record<string, string | number | boolean | undefined>) =>
  useQuery({
    queryKey: ['crm', 'leads', params],
    queryFn: () => get<Paged<LeadRow> & { registrationHours: number }>(`/crm/leads?${qs(params)}`),
  });
export const useLead = (id: string | null) =>
  useQuery({
    queryKey: ['crm', 'lead', id],
    queryFn: () => get<LeadDetail>(`/crm/leads/${id}`),
    enabled: !!id,
  });
export const useSalesHome = () =>
  useQuery({ queryKey: ['sales', 'home'], queryFn: () => get<SalesHome>('/sales/home') });

export const statusTone: Record<CustomerStatus, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  active: 'green',
  potential: 'blue',
  not_interested: 'slate',
  cooperating: 'brand',
  stopped: 'red',
};
export const stageTone: Record<OpportunityStage, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  new: 'slate',
  in_progress: 'blue',
  contacted: 'blue',
  meeting_scheduled: 'amber',
  quote_sent: 'brand',
  negotiating: 'amber',
  won: 'green',
  lost: 'red',
};
export const leadTone: Record<LeadState, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  new: 'slate',
  contacted: 'blue',
  referred: 'blue',
  following_up: 'amber',
  opportunity: 'brand',
  converted: 'green',
  not_interested: 'slate',
  closed: 'slate',
};
