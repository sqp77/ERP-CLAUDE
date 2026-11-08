import { useQuery } from '@tanstack/react-query';
import type { NewsState } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface NewsRow {
  _id: string;
  number: string;
  title: string;
  body?: string;
  departmentCode: string;
  departmentName?: string;
  authorName?: string;
  authorUserId: string;
  audienceAll: boolean;
  audienceDepartmentIds: string[];
  pinned: boolean;
  publishFrom?: string | null;
  publishTo?: string | null;
  attachmentIds: string[];
  coverAttachmentId?: string | null;
  state: NewsState;
  publishedAt?: string | null;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
}
export interface NewsDetail extends NewsRow {
  body: string;
  attachments: { _id: string; originalName: string; mimeType: string }[];
  canEdit: boolean;
  canApprove: boolean;
  history: { _id: string; action: string; actorEmail?: string; note?: string; at: string }[];
}

export const newsTone: Record<NewsState, 'slate' | 'amber' | 'green' | 'red' | 'blue'> = {
  draft: 'slate',
  pending_approval: 'amber',
  published: 'green',
  rejected: 'red',
  archived: 'slate',
};

export const useNews = (params: Record<string, string | number | undefined>) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return useQuery({ queryKey: ['news', params], queryFn: () => get<Paged<NewsRow>>(`/news?${qs}`) });
};
export const usePublishableDepartments = (enabled = true) =>
  useQuery({
    queryKey: ['news', 'departments'],
    queryFn: () => get<{ items: { code: string; departmentId: string; nameAr: string }[] }>('/news/departments'),
    enabled,
    staleTime: 60_000,
  });
