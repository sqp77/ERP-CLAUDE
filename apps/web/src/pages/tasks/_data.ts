import { useQuery } from '@tanstack/react-query';
import type { Priority, TaskStatus } from '@eayni/shared';
import { get, type Paged } from '@/lib/api';

export interface Task {
  _id: string;
  number: string;
  title: string;
  description?: string;
  assigneeId?: string | null;
  assignerId: string;
  departmentId: string;
  priority: Priority;
  status: TaskStatus;
  dueAt?: string | null;
  startAt?: string | null;
  completedAt?: string | null;
  progressPercent: number;
  reviewNote?: string;
  source?: { type: string; id: string; label?: string } | null;
  attachmentIds: string[];
  createdAt: string;
}
export interface TaskEvent {
  _id: string;
  type: string;
  fromStatus?: string;
  toStatus?: string;
  note?: string;
  actorEmail?: string;
  at: string;
}
export interface TeamMember {
  _id: string;
  userId?: string;
  fullNameAr: string;
  employeeNumber: string;
  positionId?: string;
  departmentId: string;
  directReport: boolean;
  status: string;
  workEmail: string;
  openTasks: number;
  lateTasks: number;
  pendingRequests: number;
  secondment: null | {
    destination: string;
    startDate?: string;
    endDate?: string;
    reportedAt?: string;
    reportAttachmentId?: string;
  };
}

export const OPEN: readonly TaskStatus[] = ['new', 'in_progress', 'waiting_review', 'late'];

/** Card / badge colour per MKT §11: red late, orange high priority, blue in progress, green done, grey not started. */
export type TaskTone = 'red' | 'orange' | 'blue' | 'green' | 'grey';
export function taskTone(
  task: Pick<Task, 'status' | 'priority' | 'dueAt'>,
  now: Date = new Date(),
): TaskTone {
  if (task.status === 'done') return 'green';
  if (task.status === 'cancelled') return 'grey';
  if (task.status === 'late' || (task.dueAt && new Date(task.dueAt) < now)) return 'red';
  if (task.priority === 'high' || task.priority === 'urgent') return 'orange';
  if (task.status === 'in_progress' || task.status === 'waiting_review') return 'blue';
  return 'grey';
}
export const TONE_CLASS: Record<TaskTone, string> = {
  red: 'border-s-red-500',
  orange: 'border-s-orange-500',
  blue: 'border-s-sky-500',
  green: 'border-s-emerald-500',
  grey: 'border-s-slate-300',
};
export const TONE_BADGE: Record<TaskTone, 'red' | 'amber' | 'blue' | 'green' | 'slate'> = {
  red: 'red',
  orange: 'amber',
  blue: 'blue',
  green: 'green',
  grey: 'slate',
};

/** My team / department members (manager view), shared by the team page, the board and the assign dialog. */
export const useTeam = (enabled = true) =>
  useQuery({
    queryKey: ['team'],
    queryFn: () => get<{ items: TeamMember[]; scope: string }>('/hr/team'),
    enabled,
    staleTime: 60_000,
  });

export const useTasks = (params: Record<string, string | number | boolean | undefined>, enabled = true) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return useQuery({ queryKey: ['tasks', params], queryFn: () => get<Paged<Task>>(`/tasks?${qs}`), enabled });
};
