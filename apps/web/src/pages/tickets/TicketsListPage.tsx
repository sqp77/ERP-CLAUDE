import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TICKET_STATES, TICKET_TYPES } from '@eayni/shared';
import { usePrefs } from '@/lib/preferences';
import { useAuth } from '@/lib/auth';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  QueryError,
  Select,
  Spinner,
  Table,
  Td,
} from '@/shared/ui';
import { NewTicketDialog } from './NewTicketDialog';
import { ticketTone, useTicketTargets, useTickets } from './_data';

type View = 'mine' | 'assigned' | 'department';

/** Tickets list: my tickets [EP §9.5], the ones assigned to me, or my department's queue (managers). */
export function TicketsListPage({ view: initial }: { view: View }) {
  const { t } = useTranslation();
  const { formatDateTime } = usePrefs();
  const { can, user } = useAuth();
  const [view, setView] = useState<View>(initial);
  const [state, setState] = useState('');
  const [type, setType] = useState('');
  const [unassigned, setUnassigned] = useState(false);
  const [open, setOpen] = useState(false);
  const targets = useTicketTargets();
  const manager = (user?.permissions.find((p) => p.resource === 'tickets')?.scope ?? 'own') !== 'own';
  const queueVisible = manager || !!targets.data?.queue.canView;
  const q = useTickets({
    view,
    state: state || undefined,
    type: type || undefined,
    unassigned: view === 'department' && unassigned,
    limit: 200,
  });
  return (
    <>
      <PageHeader
        title={t(`tickets.views.${view}`)}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {(['mine', 'assigned', ...(queueVisible ? ['department' as const] : [])] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-2.5 py-1.5 ${view === v ? 'bg-brand-700 text-white' : 'text-slate-600'}`}
                >
                  {t(`tickets.views.${v}`)}
                </button>
              ))}
            </div>
            {can('tickets', 'create') && <Button onClick={() => setOpen(true)}>{t('tickets.new')}</Button>}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={state} onChange={(e) => setState(e.target.value)} aria-label={t('common.status')}>
          <option value="">{t('tasks.allStatuses')}</option>
          {TICKET_STATES.map((s) => (
            <option key={s} value={s}>
              {t(`tickets.states.${s}`)}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('tickets.type')}>
          <option value="">{t('tickets.allTypes')}</option>
          {TICKET_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`tickets.types.${s}`)}
            </option>
          ))}
        </Select>
        {view === 'department' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} />{' '}
            {t('tickets.unassignedOnly')}
          </label>
        )}
      </div>
      <Card>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <EmptyState title={t('tickets.empty')} />
        ) : (
          <Table
            head={[
              t('common.number'),
              t('tickets.subject'),
              t('tickets.department'),
              t('tickets.type'),
              t('tickets.assignee'),
              t('common.status'),
              t('tickets.lastActivity'),
            ]}
          >
            {q.data.items.map((r) => (
              <tr key={r._id}>
                <Td className="tabular text-xs text-slate-500">
                  <Link to={`/tickets/${r._id}`} className="text-brand-800 hover:underline">
                    {r.number}
                  </Link>
                </Td>
                <Td className="font-medium">
                  <Link to={`/tickets/${r._id}`} className="hover:underline">
                    {r.subject}
                  </Link>
                  {view !== 'mine' && <div className="text-xs text-slate-500">{r.requesterName}</div>}
                </Td>
                <Td>{t(`departments.${r.departmentCode}`, r.departmentCode)}</Td>
                <Td>{t(`tickets.types.${r.type}`)}</Td>
                <Td>
                  {r.assigneeName ?? (
                    <span className="text-xs text-slate-400">{t('tickets.unassigned')}</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={ticketTone[r.state]}>{t(`tickets.states.${r.state}`)}</Badge>
                </Td>
                <Td className="tabular text-xs text-slate-500">
                  {formatDateTime(r.lastActivityAt ?? r.createdAt)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewTicketDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
