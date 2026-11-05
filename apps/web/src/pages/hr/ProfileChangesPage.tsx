import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
  QueryError,
} from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { downloadAttachment } from '@/shared/files/FileUploader';

interface Row {
  _id: string;
  number: string;
  type: string;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled';
  employee?: { fullNameAr: string; employeeNumber: string };
  bankName?: string;
  ibanLast4?: string;
  proofAttachmentId: string;
  notes?: string;
  createdAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

/** Pending profile changes: Finance approves bank changes with proof; HR sees the queue [EP §8.1, DECISIONS §10]. */
export function ProfileChangesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { formatDateTime } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const [state, setState] = useState('pending');
  const q = useQuery({
    queryKey: ['profile-changes', state],
    queryFn: () => get<{ items: Row[] }>(`/hr/profile-changes?state=${state}`),
  });
  const [reject, setReject] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['profile-changes'] });
  const approve = useMutation({
    mutationFn: (id: string) => post(`/hr/profile-changes/${id}/approve`, {}),
    onSuccess: () => {
      invalidate();
      toast(t('actions.confirm'));
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const doReject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      post(`/hr/profile-changes/${id}/reject`, { reason }),
    onSuccess: () => {
      invalidate();
      setReject(null);
      setReason('');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const tone = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'slate' } as const;
  const canApprove = can('hr.profile_changes', 'approve');
  return (
    <>
      <PageHeader
        title={t('profileChanges.title')}
        subtitle={t('profileChanges.hint')}
        actions={
          <Select value={state} onChange={(e) => setState(e.target.value)} className="w-44">
            {['pending', 'approved', 'rejected', 'all'].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('common.all') : t(`profile.changeStates.${s}`)}
              </option>
            ))}
          </Select>
        }
      />
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <Table
            head={[
              '#',
              t('hr.directory'),
              t('profileChanges.change'),
              t('profile.proof'),
              t('common.date'),
              t('common.status'),
              '',
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={r._id}>
                <Td className="tabular text-xs">{r.number}</Td>
                <Td>
                  <div className="font-medium">{r.employee?.fullNameAr}</div>
                  <div className="text-xs text-slate-500">{r.employee?.employeeNumber}</div>
                </Td>
                <Td>
                  {t('profile.bank')}: {r.bankName}{' '}
                  <span dir="ltr" className="text-xs text-slate-500">
                    ••••{r.ibanLast4}
                  </span>
                  {r.notes && <div className="text-xs text-slate-500">{r.notes}</div>}
                </Td>
                <Td>
                  <Button variant="ghost" onClick={() => downloadAttachment(r.proofAttachmentId)}>
                    {t('files.download')}
                  </Button>
                </Td>
                <Td className="tabular text-xs">{formatDateTime(r.createdAt)}</Td>
                <Td>
                  <Badge tone={tone[r.state]}>{t(`profile.changeStates.${r.state}`)}</Badge>
                  {r.decisionReason && <div className="text-xs text-slate-500">{r.decisionReason}</div>}
                </Td>
                <Td>
                  {r.state === 'pending' && canApprove && (
                    <div className="flex gap-1">
                      <Button onClick={() => approve.mutate(r._id)}>{t('profileChanges.approve')}</Button>
                      <Button variant="danger" onClick={() => setReject(r)}>
                        {t('profileChanges.reject')}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={!!reject} onClose={() => setReject(null)} title={t('profileChanges.reject')}>
        <div className="space-y-3">
          <Field label={t('profileChanges.rejectReason')} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReject(null)}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              onClick={() => reject && doReject.mutate({ id: reject._id, reason })}
            >
              {t('profileChanges.reject')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
