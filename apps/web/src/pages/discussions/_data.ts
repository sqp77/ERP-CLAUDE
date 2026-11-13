import { useQuery } from '@tanstack/react-query';
import type { DiscussionState } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

/** Department discussions [SAL §10.3]. */
export interface DiscussionRow {
  _id: string;
  number: string;
  recordType: string;
  recordId: string;
  recordLabel?: string;
  title: string;
  details: string;
  openedByUserId: string;
  openedByName?: string;
  openedByDepartmentName?: string;
  targetDepartmentId: string;
  targetDepartmentName?: string;
  participantUserIds: string[];
  state: DiscussionState;
  lastActivityAt: string;
  createdAt: string;
}
export interface DiscussionEntryRow {
  _id: string;
  kind: 'opened' | 'message' | 'state' | 'participants';
  body?: string;
  fromState?: DiscussionState;
  toState?: DiscussionState;
  auto?: boolean;
  attachmentIds: string[];
  participantUserIds: string[];
  authorUserId: string;
  authorName?: string;
  authorDepartmentName?: string;
  at: string;
}
export interface DiscussionDetail extends DiscussionRow {
  attachmentIds: string[];
  participants: { userId: string; name: string; departmentName?: string }[];
  entries: DiscussionEntryRow[];
  side: 'requester' | 'handler' | 'both' | 'viewer';
  canReply: boolean;
  canAddParticipants: boolean;
  allowedStates: DiscussionState[];
}

const qs = (p: Record<string, string | number | boolean | undefined>) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const useDiscussions = (p: Record<string, string | number | boolean | undefined>, enabled = true) =>
  useQuery({
    queryKey: ['discussions', p],
    queryFn: () => get<Paged<DiscussionRow>>(`/discussions?${qs(p)}`),
    enabled,
  });
export const useDiscussion = (id: string) =>
  useQuery({
    queryKey: ['discussion', id],
    queryFn: () => get<DiscussionDetail>(`/discussions/${id}`),
    enabled: !!id,
  });

export const discussionTone: Record<DiscussionState, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> =
  {
    new: 'blue',
    in_progress: 'amber',
    awaiting_reply: 'red',
    resolved: 'green',
    closed: 'slate',
  };
