import { useQuery } from '@tanstack/react-query';
import type { PriceUnit, QuoteApprovalLevel, QuoteState } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface PriceItemRow {
  _id: string;
  kind: 'material' | 'service';
  nameAr: string;
  category?: string;
  unit: PriceUnit;
  active: boolean;
  notes?: string;
  priceHalalas: number | null;
  validFrom: string | null;
  marketPriceHalalas: number | null;
  marketWeekOf: string | null;
}
export interface PriceListResponse {
  items: PriceItemRow[];
  matrix: {
    limits: { rep: number | null; manager: number | null };
    mode: 'above_limit' | 'always';
    limitsUnset: boolean;
  };
  canEdit: boolean;
}
export interface QuoteLine {
  itemId: string;
  descriptionAr: string;
  unit: string;
  quantity: number;
  listPriceHalalas?: number;
  marketPriceHalalas?: number;
  discountPercentBp?: number;
  discountHalalas?: number;
  netUnitPriceHalalas: number;
  lineTotalHalalas: number;
  vatHalalas: number;
}
export interface QuoteRow {
  _id: string;
  number: string;
  version: number;
  customerId: string;
  customerName?: string;
  customerNumber?: string;
  opportunityId?: string;
  requestId?: string;
  ownerUserId: string;
  ownerName?: string;
  lines: QuoteLine[];
  subtotalHalalas: number;
  discountTotalHalalas?: number;
  vatTotalHalalas: number;
  totalHalalas: number;
  maxDiscountBp?: number;
  state: QuoteState;
  stateAr: string;
  approval?: {
    requiredLevel: QuoteApprovalLevel;
    limitsUnset: boolean;
    approvedByName?: string;
    approvedAt?: string;
    note?: string;
  };
  validityDays: number;
  validUntil?: string;
  sentAt?: string;
  customerResponse?: { state: string; reason?: string; note?: string; at: string };
  salesOrderId?: string;
  notesForCustomer?: string;
  internalNotes?: string;
  attachmentIds: string[];
  documentAttachmentId?: string;
  updatedAt: string;
}
export interface QuoteDetail extends QuoteRow {
  events?: {
    _id: string;
    type: string;
    fromState?: string;
    toState?: string;
    byName?: string;
    note?: string;
    at: string;
  }[];
  salesOrder: { _id: string; number: string; state: string; invoiceIds: string[] } | null;
  files: { _id: string; originalName: string }[];
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canSend: boolean;
  canRespond: boolean;
  canRevise: boolean;
  rejectionReasons: string[];
}
export interface ContractRow {
  _id: string;
  number: string;
  customerId: string;
  customerName?: string;
  contractType?: string;
  ownerName?: string;
  startDate: string;
  endDate: string;
  durationMonths?: number;
  state: string;
  stateAr: string;
  daysLeft: number;
  yearOrMore: boolean;
}
export interface ContractDetail extends ContractRow {
  items: {
    itemId?: string;
    descriptionAr: string;
    quantity?: number;
    unit?: string;
    agreedPriceHalalas?: number;
  }[];
  schedule: {
    _id: string;
    plannedAt: string;
    kind: string;
    status: string;
    doneAt?: string;
    note?: string;
  }[];
  signedFileAttachmentId?: string;
  notes?: string;
  renewalOf?: string;
  renewedById?: string;
  certificateWindowFrom: string;
  canCertify: boolean;
  canEdit: boolean;
  events: { _id: string; type: string; note?: string; byName?: string; at: string }[];
  certificates: {
    _id: string;
    number: string;
    issuedAt: string;
    attachmentId: string;
    sendLog: { at: string; to: string[] }[];
  }[];
  files: { _id: string; originalName: string }[];
}
export interface InvoiceRow {
  _id: string;
  number: string;
  externalNumber: string;
  kind: string;
  salesOrderId: string;
  customerId: string;
  customer?: { nameAr?: string; legalNameAr?: string; vatNumber?: string };
  issueDateTime: string;
  dueDate: string;
  totalHalalas: number;
  collectedHalalas: number;
  remainingHalalas: number;
  collectionState: string;
  collectionStateAr: string;
  zatca?: { state: string; uuid: string; sequence: number };
  zatcaStateAr?: string;
  ownerName?: string;
  daysToCollect?: number | null;
  payments: {
    amountHalalas: number;
    paidAt: string;
    method: string;
    methodAr?: string;
    reference?: string;
  }[];
  canRecordPayment?: boolean;
  pdfAttachmentId?: string;
}

const qs = (params: Record<string, string | number | boolean | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const usePriceList = (includeInactive = false) =>
  useQuery({
    queryKey: ['sales', 'pricelist', includeInactive],
    queryFn: () =>
      get<PriceListResponse>(`/sales/pricelist${includeInactive ? '?includeInactive=true' : ''}`),
  });
export const usePriceHistory = (id: string | null) =>
  useQuery({
    queryKey: ['sales', 'pricelist', 'history', id],
    queryFn: () =>
      get<{
        entries: {
          _id: string;
          priceHalalas: number;
          validFrom: string;
          byEmail?: string;
          note?: string;
          at: string;
        }[];
        market: { _id: string; weekOf: string; priceHalalas: number; source?: string; byEmail?: string }[];
      }>(`/sales/pricelist/items/${id}/history`),
    enabled: !!id,
  });
export const useQuotes = (params: Record<string, string | number | boolean | undefined>) =>
  useQuery({
    queryKey: ['sales', 'quotes', params],
    queryFn: () => get<Paged<QuoteRow>>(`/sales/quotes?${qs(params)}`),
  });
export const useQuote = (id: string) =>
  useQuery({
    queryKey: ['sales', 'quote', id],
    queryFn: () => get<QuoteDetail>(`/sales/quotes/${id}`),
    enabled: !!id,
  });
export const useContracts = (params: Record<string, string | number | boolean | undefined>) =>
  useQuery({
    queryKey: ['sales', 'contracts', params],
    queryFn: () => get<Paged<ContractRow>>(`/sales/contracts?${qs(params)}`),
  });
export const useContract = (id: string) =>
  useQuery({
    queryKey: ['sales', 'contract', id],
    queryFn: () => get<ContractDetail>(`/sales/contracts/${id}`),
    enabled: !!id,
  });
export const useInvoices = (params: Record<string, string | number | boolean | undefined>) =>
  useQuery({
    queryKey: ['finance', 'invoices', params],
    queryFn: () => get<Paged<InvoiceRow>>(`/finance/invoices?${qs(params)}`),
  });
export const useInvoice = (id: string) =>
  useQuery({
    queryKey: ['finance', 'invoice', id],
    queryFn: () => get<InvoiceRow>(`/finance/invoices/${id}`),
    enabled: !!id,
  });

export const quoteTone: Record<QuoteState, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'blue',
  sent: 'brand',
  accepted: 'green',
  rejected: 'red',
  negotiating: 'amber',
  cancelled: 'slate',
};
export const collectionTone: Record<string, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  due: 'blue',
  partially_collected: 'amber',
  collected: 'green',
  overdue: 'red',
};
export const contractTone: Record<string, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  draft: 'slate',
  active: 'green',
  expiring: 'amber',
  expired: 'red',
  renewed: 'blue',
  terminated: 'slate',
};
