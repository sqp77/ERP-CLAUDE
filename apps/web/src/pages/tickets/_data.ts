import { useQuery } from '@tanstack/react-query';
import type { Priority, TicketDepartmentConfig, TicketState, TicketType } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface TicketRow {
  _id: string;
  number: string;
  subject: string;
  body: string;
  type: TicketType;
  priority: Priority;
  state: TicketState;
  pendingWith?: string | null;
  departmentCode: string;
  departmentId: string;
  workflowType: string;
  requesterUserId: string;
  requester?: { fullNameAr?: string; employeeNumber?: string };
  requesterName?: string;
  assigneeId?: string | null;
  assigneeName?: string;
  fields: Record<string, string | number | boolean>;
  attachmentIds: string[];
  createdAt: string;
  lastActivityAt?: string;
  closedAt?: string | null;
  resolvedAt?: string | null;
  processingStartedAt?: string | null;
  resolution?: string;
  rating?: { score: number; comment?: string; at: string } | null;
  reopenCount: number;
}
export interface TicketDetail extends TicketRow {
  actions: string[];
  history: {
    _id: string;
    action: string;
    fromState?: string;
    toState?: string;
    actorEmail?: string;
    actorRelation?: string;
    note?: string;
    at: string;
  }[];
  attachments: { _id: string; originalName: string }[];
  department?: { nameAr: string; code: string } | null;
  departmentConfig: TicketDepartmentConfig;
  reopenWithinDays: number;
}
export interface TicketTarget {
  code: string;
  departmentId: string;
  nameAr: string;
  managersOnly: boolean;
  config: TicketDepartmentConfig;
}

export const ticketTone: Record<TicketState, 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'brand'> = {
  new: 'slate',
  under_review: 'blue',
  in_progress: 'blue',
  waiting_requester: 'amber',
  resolved: 'green',
  awaiting_confirmation: 'amber',
  closed: 'slate',
  reopened: 'red',
  stalled: 'red',
};

export const useTicketTargets = (enabled = true) =>
  useQuery({ queryKey: ['tickets', 'targets'], queryFn: () => get<{ items: TicketTarget[] }>('/tickets/targets'), enabled, staleTime: 60_000 });

export const useTickets = (params: Record<string, string | number | boolean | undefined>, enabled = true) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return useQuery({ queryKey: ['tickets', 'list', params], queryFn: () => get<Paged<TicketRow>>(`/tickets?${qs}`), enabled });
};

/** Priority label: the department's own wording when configured (IT §7.1), else the general one. */
export function priorityLabel(t: (k: string) => string, priority: Priority, config?: TicketDepartmentConfig | null): string {
  return config?.priorityLabelsAr?.[priority] ?? t(`tasks.priorities.${priority}`);
}
