import type { HrRequestType } from '@eayni/shared';

export interface HrRequestRow {
  _id: string;
  number: string;
  type: HrRequestType;
  typeAr: string;
  state: string;
  pendingWith?: string | null;
  flags: string[];
  details: Record<string, unknown>;
  attachmentIds: string[];
  notes?: string;
  dueAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  requesterUserId: string;
  directManagerUserId?: string | null;
  employee?: { fullNameAr: string; employeeNumber: string; departmentId: string };
  decision?: { outcome?: string; reason?: string; at?: string };
  handoff?: { department: string; status: string; since: string } | null;
  certificate?: { number: string; issuedAt: string } | null;
  route?: { viaManager: boolean; finalApprover: string };
}

export interface HrRequestDetail extends HrRequestRow {
  directManager?: { displayNameAr: string } | null;
  actions: string[];
  attachments: { _id: string; originalName: string; mimeType: string; size: number }[];
  history: {
    actions: {
      _id: string;
      action: string;
      fromState?: string;
      toState?: string;
      actorEmail?: string;
      actorRole?: string;
      note?: string;
      at: string;
    }[];
    stages: {
      _id: string;
      fromState?: string;
      toState: string;
      transition: string;
      at: string;
      overdue: boolean;
      durationMs?: number;
    }[];
  };
}

export const stateTone: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'brand'> = {
  new: 'slate',
  under_review: 'blue',
  awaiting_manager: 'blue',
  awaiting_hr: 'blue',
  awaiting_final: 'brand',
  needs_completion: 'amber',
  approved: 'green',
  rejected: 'red',
  closed: 'slate',
};
