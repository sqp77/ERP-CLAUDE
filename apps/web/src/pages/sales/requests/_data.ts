import { useQuery } from '@tanstack/react-query';
import type { RequestHolder, SalesListKey, SalesServiceType } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface RequestRow {
  _id: string;
  number: string;
  type: SalesServiceType;
  title: string;
  state: string;
  stateAr: string;
  holder: RequestHolder;
  holdersInvolved: RequestHolder[];
  customerId: string;
  customerName?: string;
  customerNumber?: string;
  ownerUserId: string;
  ownerName?: string;
  dueAt?: string;
  overdue: boolean;
  tags: string[];
  lastActivityAt?: string;
  createdAt: string;
  closingOutcome?: string;
}
export interface StageRow {
  _id: string;
  fromState?: string;
  toState: string;
  transition: string;
  actorEmail?: string;
  at: string;
  durationMs?: number;
  overdue: boolean;
  delayReason?: string;
  reason?: string;
  meta?: { responsibleDepartment?: RequestHolder };
}
export interface ActionDef {
  code: string;
  labelAr: string;
  to: string;
  requireReason: boolean;
  requiredFields: string[];
}
export interface FileRow {
  _id: string;
  originalName: string;
  mimeType: string;
}
export interface RequestDetail extends RequestRow {
  typeAr: string;
  details: Record<string, unknown>;
  attachmentIds: string[];
  photoIds: string[];
  needsProcurement?: boolean;
  needsFinanceApproval?: boolean;
  needsOperations?: boolean;
  closingNote?: string;
  procurement?: {
    supplierName?: string;
    supplierQuoteAttachmentIds: string[];
    receiptFormAttachmentId?: string;
    deliveryDate?: string;
    notes?: string;
  };
  finance?: {
    decision?: string;
    decidedAt?: string;
    notes?: string;
    rejectionReason?: string;
    infoRequest?: string;
    purchaseDocumentAttachmentIds: string[];
  };
  operations?: {
    scheduledVisitAt?: string;
    estimatedWeightKg?: number;
    estimatedQuantity?: string;
    quantitiesKg?: number;
    weightsKg?: number;
    receiptReportAttachmentIds: string[];
    deliveryReportAttachmentIds: string[];
    notes?: string;
    postponedTo?: string;
    completedAt?: string;
  };
  scrap?: {
    proposedPriceHalalas?: number;
    agreedPriceHalalas?: number;
    actualWeightKg?: number;
    receiptReportAttachmentIds: string[];
    transferStatus?: string;
    transferProofAttachmentId?: string;
    transferredHalalas?: number;
    transferredAt?: string;
  };
  assetReturn?: { nextConversationAt?: string; nonCooperationReason?: string };
  relations: string[];
  actions: ActionDef[];
  canEdit: boolean;
  history: {
    _id: string;
    action: string;
    fromState?: string;
    toState?: string;
    holderFrom?: string;
    holderTo?: string;
    actorName?: string;
    actorEmail?: string;
    note?: string;
    at: string;
  }[];
  stageLog: StageRow[];
  inspections: {
    _id: string;
    phase: string;
    containerNumber?: string;
    photoIds: string[];
    at: string;
    byName?: string;
    containerCondition: string;
    notes?: string;
    signatureAttachmentId?: string;
    receiptProofAttachmentId?: string;
  }[];
  assessments: {
    _id: string;
    visitAt?: string;
    result: string;
    photoIds: string[];
    quantitiesKg?: number;
    estimatedWeightKg?: number;
    categories: string[];
    proposedPriceHalalas?: number;
    agreedPriceHalalas?: number;
    nextAction?: string;
    byName?: string;
    at: string;
  }[];
  scrapTasks: {
    _id: string;
    taskType: string;
    assigneeName?: string;
    customersToContact?: number;
    assignedAt?: string;
    visitAt?: string;
    agreedPriceHalalas?: number;
    transferStatus: string;
    taskStatus: 'done' | 'not_done';
    notes?: string;
    task: { number: string; status: string } | null;
  }[];
  files: FileRow[];
  states: Record<string, { labelAr: string; category: string }>;
}
export interface RequestsMeta {
  lists: Record<SalesListKey, string[]>;
  incomingHolders: RequestHolder[];
}

const qs = (params: Record<string, string | number | boolean | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const useRequestsMeta = () =>
  useQuery({
    queryKey: ['sales', 'requests', 'meta'],
    queryFn: () => get<RequestsMeta>('/sales/requests/meta'),
    staleTime: 60_000,
  });
export const useRequests = (params: Record<string, string | number | boolean | undefined>, enabled = true) =>
  useQuery({
    queryKey: ['sales', 'requests', params],
    queryFn: () => get<Paged<RequestRow>>(`/sales/requests?${qs(params)}`),
    enabled,
  });
export const useRequest = (id: string) =>
  useQuery({
    queryKey: ['sales', 'request', id],
    queryFn: () => get<RequestDetail>(`/sales/requests/${id}`),
    enabled: !!id,
  });

export const holderTone: Record<RequestHolder, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  sales: 'brand',
  procurement: 'amber',
  finance: 'blue',
  ops: 'green',
};
export function stateTone(
  state: string,
  category?: string,
): 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand' {
  if (['closed_success', 'cooperated', 'ops_completed', 'execution_done', 'transferred'].includes(state))
    return 'green';
  if (
    [
      'finance_rejected',
      'execution_rejected',
      'ops_rejected',
      'ops_cancelled',
      'execution_cancelled',
      'cancelled',
      'not_cooperated',
      'closed_incomplete',
    ].includes(state)
  )
    return 'red';
  if (['at_finance', 'quote_sent', 'ops_postponed', 'suspended', 'finance_needs_info'].includes(state))
    return 'amber';
  if (category === 'done' || category === 'cancelled') return 'slate';
  return 'blue';
}

/** Field definitions per service [SAL §5.1–§5.7], driving the one-screen-per-service form. */
export type FieldKind =
  | 'text'
  | 'number'
  | 'money'
  | 'kg'
  | 'date'
  | 'datetime'
  | 'phone'
  | 'textarea'
  | 'list'
  | 'select'
  | 'tags';
export interface FieldDef {
  key: string;
  kind: FieldKind;
  required?: boolean;
  /** Settings list key for `list` fields (Q7 lists; free text when the list is empty). */
  list?: SalesListKey;
  options?: readonly string[];
  optionLabelKey?: string;
}
export const SERVICE_FIELDS: Record<SalesServiceType, FieldDef[]> = {
  containerSale: [
    { key: 'region', kind: 'text' },
    { key: 'containerType', kind: 'list', list: 'containerTypes' },
    { key: 'size', kind: 'list', list: 'containerSizes' },
    { key: 'count', kind: 'number', required: true },
    { key: 'color', kind: 'list', list: 'containerColors' },
    { key: 'dimensions', kind: 'text' },
    { key: 'requestDate', kind: 'date' },
    { key: 'agreedPriceHalalas', kind: 'money' },
    { key: 'notes', kind: 'textarea' },
  ],
  sortingContract: [
    { key: 'contractType', kind: 'list', list: 'contractTypes' },
    { key: 'materialTypes', kind: 'tags' },
    { key: 'expectedQuantityKg', kind: 'kg' },
    { key: 'customerLocation', kind: 'text' },
    { key: 'contractDurationMonths', kind: 'number' },
    { key: 'pickupSchedule', kind: 'text' },
    { key: 'notes', kind: 'textarea' },
  ],
  cleaningContract: [
    { key: 'serviceLocation', kind: 'text' },
    { key: 'wasteType', kind: 'list', list: 'wasteTypes' },
    { key: 'serviceType', kind: 'list', list: 'cleaningServiceTypes' },
    {
      key: 'mode',
      kind: 'select',
      required: true,
      options: ['provide_container', 'direct_collection'],
      optionLabelKey: 'cleaningModes',
    },
    { key: 'containerCount', kind: 'number' },
    { key: 'visitCount', kind: 'number' },
    { key: 'contractDurationMonths', kind: 'number' },
    { key: 'contractStart', kind: 'date' },
    { key: 'contractEnd', kind: 'date' },
  ],
  destruction: [
    { key: 'contactPersonName', kind: 'text' },
    { key: 'contactPhone', kind: 'phone' },
    { key: 'customerLocation', kind: 'text' },
    { key: 'materialType', kind: 'list', list: 'destructionMaterials' },
    { key: 'estimatedQuantityKg', kind: 'kg' },
    { key: 'notes', kind: 'textarea' },
  ],
  containerRental: [
    { key: 'contactPhone', kind: 'phone' },
    { key: 'address', kind: 'text' },
    { key: 'region', kind: 'text' },
    { key: 'containerSize', kind: 'list', list: 'containerSizes' },
    { key: 'containerCount', kind: 'number', required: true },
    { key: 'color', kind: 'list', list: 'containerColors' },
    { key: 'dimensions', kind: 'text' },
    {
      key: 'deliveryZone',
      kind: 'select',
      required: true,
      options: ['inside_eastern', 'outside_eastern'],
      optionLabelKey: 'deliveryZones',
    },
    { key: 'requestDate', kind: 'date' },
    { key: 'requestedDeliveryDate', kind: 'date' },
    { key: 'rentalDurationDays', kind: 'number' },
    { key: 'agreedPriceHalalas', kind: 'money' },
    { key: 'notes', kind: 'textarea' },
  ],
  scrap: [
    { key: 'region', kind: 'text' },
    { key: 'materialType', kind: 'list', list: 'scrapCategories' },
    { key: 'mobile', kind: 'phone' },
    { key: 'address', kind: 'text' },
    { key: 'contactPersonName', kind: 'text' },
    { key: 'materialDescription', kind: 'textarea' },
    { key: 'estimatedQuantityKg', kind: 'kg' },
    { key: 'proposedPriceHalalas', kind: 'money' },
    { key: 'agreedPriceHalalas', kind: 'money' },
  ],
  assetReturn: [
    { key: 'region', kind: 'text' },
    { key: 'facilitySize', kind: 'text' },
    { key: 'tenderSource', kind: 'list', list: 'tenderSources' },
    { key: 'tenderInfo', kind: 'textarea' },
    { key: 'assetType', kind: 'text' },
    { key: 'opportunityDate', kind: 'date' },
    { key: 'lastContactAt', kind: 'datetime' },
    { key: 'nextConversationAt', kind: 'datetime' },
  ],
};

/** Payload fields a transition may carry, by transition code (the service validates them). */
export const TRANSITION_FIELDS: Record<string, FieldDef[]> = {
  procurement_to_finance: [
    { key: 'supplierName', kind: 'text' },
    { key: 'notes', kind: 'textarea' },
  ],
  execution_start: [{ key: 'notes', kind: 'textarea' }],
  execution_progress: [
    { key: 'deliveryDate', kind: 'date' },
    { key: 'notes', kind: 'textarea' },
  ],
  execution_done: [
    { key: 'deliveryDate', kind: 'date' },
    { key: 'notes', kind: 'textarea' },
  ],
  finance_approve: [{ key: 'notes', kind: 'textarea' }],
  ops_schedule: [
    { key: 'scheduledVisitAt', kind: 'datetime', required: true },
    { key: 'visitDurationMinutes', kind: 'number' },
    { key: 'notes', kind: 'textarea' },
  ],
  schedule_pickup: [{ key: 'scheduledVisitAt', kind: 'datetime', required: true }],
  ops_postpone: [{ key: 'postponedTo', kind: 'datetime' }],
  estimate_done: [
    { key: 'estimatedWeightKg', kind: 'kg', required: true },
    { key: 'estimatedQuantity', kind: 'text' },
    { key: 'notes', kind: 'textarea' },
  ],
  ops_complete: [
    { key: 'quantitiesKg', kind: 'kg' },
    { key: 'weightsKg', kind: 'kg' },
    { key: 'notes', kind: 'textarea' },
  ],
  record_assessment: [
    { key: 'estimatedWeightKg', kind: 'kg', required: true },
    { key: 'proposedPriceHalalas', kind: 'money' },
    { key: 'notes', kind: 'textarea' },
  ],
  agree_price: [{ key: 'agreedPriceHalalas', kind: 'money', required: true }],
  record_collection: [
    { key: 'actualWeightKg', kind: 'kg', required: true },
    { key: 'notes', kind: 'textarea' },
  ],
  record_transfer: [{ key: 'transferredHalalas', kind: 'money' }],
  negotiate: [{ key: 'nextConversationAt', kind: 'datetime' }],
  back_to_study: [{ key: 'nextConversationAt', kind: 'datetime' }],
};
/** Attachment lists a transition may carry (uploaded in the dialog). */
export const TRANSITION_FILES: Record<string, { key: string; required?: boolean }[]> = {
  procurement_to_finance: [{ key: 'supplierQuoteAttachmentIds' }],
  execution_done: [{ key: 'receiptFormAttachmentId' }],
  finance_approve: [{ key: 'purchaseDocumentAttachmentIds' }],
  ops_complete: [{ key: 'receiptReportAttachmentIds' }, { key: 'deliveryReportAttachmentIds' }],
  record_collection: [{ key: 'receiptReportAttachmentIds', required: true }],
  record_transfer: [{ key: 'transferProofAttachmentId', required: true }],
};
export const SINGLE_FILE_KEYS = new Set(['receiptFormAttachmentId', 'transferProofAttachmentId']);
