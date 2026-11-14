import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from '@/lib/api';
import { usePrefs } from '@/lib/preferences';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  QueryError,
  Spinner,
  Table,
  Td,
} from '@/shared/ui';
import { sar } from '../../hr/_data';
import { usePriceList } from './_data';

interface ApprovalEvent {
  _id: string;
  at: string;
  type: 'approval_requested' | 'approved' | 'approval_rejected' | 'auto_approved';
  quoteId: string;
  quoteNumber: string;
  customer: string;
  maxDiscountBp: number;
  totalHalalas: number;
  requiredLevel: 'none' | 'manager' | 'executive';
  approvedLevel: 'none' | 'manager' | 'executive' | null;
  byName: string;
  note: string;
}
const tone = {
  approval_requested: 'amber',
  approved: 'green',
  approval_rejected: 'red',
  auto_approved: 'slate',
} as const;

/**
 * واجهة مصفوفة الخصومات والاعتمادات [SAL §7.2, §18 (8)]: the discount limits per level and the approval mode (read-only;
 * the admin edits them in /admin/settings «المبيعات»), and the log of every discount approval with who decided.
 */
export function DiscountMatrixPage() {
  const { t } = useTranslation();
  const { formatDate } = usePrefs();
  const prices = usePriceList();
  const [range, setRange] = useState({ from: '', to: '' });
  const log = useQuery({
    queryKey: ['sales', 'approvals-log', range],
    queryFn: () =>
      get<{ items: ApprovalEvent[] }>(
        `/sales/quotes/approvals-log?${new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString()}`,
      ),
  });
  const m = prices.data?.matrix;
  const pct = (bp: number | null | undefined) =>
    typeof bp === 'number'
      ? `⁦${(bp / 100).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 1 })}%⁩`
      : '—';
  return (
    <>
      <PageHeader title={t('sales.matrix.title')} subtitle={t('sales.matrix.subtitle')} />
      <div className="space-y-4">
        <Card title={t('sales.pricelist.matrixTitle')}>
          {prices.isError ? (
            <QueryError error={prices.error} onRetry={() => prices.refetch()} />
          ) : !m ? (
            <Spinner />
          ) : (
            <div className="space-y-3">
              {m.limitsUnset && <Alert kind="warning">{t('sales.pricelist.limitsUnset')}</Alert>}
              <Table head={[t('sales.matrix.level'), t('sales.matrix.maxDiscount'), t('sales.matrix.above')]}>
                <tr>
                  <Td className="font-medium">{t('sales.matrix.rep')}</Td>
                  <Td className="tabular">{pct(m.limits.rep)}</Td>
                  <Td>{t('sales.quotes.levels.manager')}</Td>
                </tr>
                <tr>
                  <Td className="font-medium">{t('sales.quotes.levels.manager')}</Td>
                  <Td className="tabular">{pct(m.limits.manager)}</Td>
                  <Td>{t('sales.quotes.levels.executive')}</Td>
                </tr>
                <tr>
                  <Td className="font-medium">{t('sales.quotes.levels.executive')}</Td>
                  <Td>{t('sales.matrix.noLimit')}</Td>
                  <Td>—</Td>
                </tr>
              </Table>
              <p className="text-xs text-slate-500">
                {t(`sales.pricelist.modes.${m.mode}`)} · {t('sales.matrix.editHint')}
              </p>
            </div>
          )}
        </Card>
        <Card title={t('sales.matrix.logTitle')}>
          <div className="mb-3 grid max-w-md grid-cols-2 gap-2">
            <Field label={t('sales.targets.from')}>
              <Input
                type="date"
                dir="ltr"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </Field>
            <Field label={t('sales.targets.to')}>
              <Input
                type="date"
                dir="ltr"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </Field>
          </div>
          {log.isError ? (
            <QueryError error={log.error} onRetry={() => log.refetch()} />
          ) : log.isLoading ? (
            <Spinner />
          ) : !log.data?.items.length ? (
            <EmptyState title={t('sales.matrix.empty')} />
          ) : (
            <Table
              head={[
                t('common.date'),
                t('sales.matrix.quote'),
                t('sales.matrix.customer'),
                t('sales.matrix.discount'),
                t('sales.matrix.required'),
                t('sales.matrix.event'),
                t('sales.matrix.by'),
                t('sales.matrix.note'),
              ]}
            >
              {log.data.items.map((e) => (
                <tr key={e._id}>
                  <Td className="tabular whitespace-nowrap">
                    {formatDate(e.at, { dateStyle: 'medium', timeStyle: 'short' })}
                  </Td>
                  <Td>
                    <Link to={`/sales/quotes/${e.quoteId}`} className="text-brand-700 hover:underline">
                      {e.quoteNumber}
                    </Link>
                    <div className="text-xs text-slate-500 tabular">{sar(e.totalHalalas)}</div>
                  </Td>
                  <Td>{e.customer}</Td>
                  <Td className="tabular">{pct(e.maxDiscountBp)}</Td>
                  <Td>{t(`sales.quotes.levels.${e.requiredLevel}`)}</Td>
                  <Td>
                    <Badge tone={tone[e.type]}>{t(`sales.matrix.events.${e.type}`)}</Badge>
                    {e.approvedLevel && e.approvedLevel !== e.requiredLevel && (
                      <div className="text-xs text-slate-500">
                        {t('sales.matrix.actedAt', { level: t(`sales.quotes.levels.${e.approvedLevel}`) })}
                      </div>
                    )}
                  </Td>
                  <Td>{e.byName}</Td>
                  <Td className="text-xs">{e.note || '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
