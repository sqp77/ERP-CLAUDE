import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/shared/ui';
import { useToast } from '@/shared/ui/Toast';
import { useReportTypes } from './_data';

/** The manager asks a team member for a report [EP §15.13]. */
export function RequestReportDialog({ target, onClose }: { target: { userId: string; name: string } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const types = useReportTypes();
  const [type, setType] = useState('weekly');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => post('/hr/employee-reports/requests', { employeeUserId: target!.userId, type, dueDate: dueDate || undefined, note: note || undefined }),
    onSuccess: () => {
      toast(t('reports.requestSent'));
      setNote('');
      setDueDate('');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Dialog open={!!target} onClose={onClose} title={t('reports.requestFrom', { name: target?.name ?? '' })}>
      <div className="space-y-3">
        <Field label={t('reports.type')}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {types.data?.items.map((x) => (
              <option key={x.code} value={x.code}>
                {x.labelAr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('reports.due')}>
          <Input type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={t('hr.notes')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button loading={send.isPending} onClick={() => send.mutate()}>
            {t('actions.send')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
