import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Building2, ChevronDown, Inbox, KanbanSquare, PhoneCall, UserPlus } from 'lucide-react';
import { SALES_SERVICE_TYPES } from '@eayni/shared';
import { Badge, Button, Card, PageHeader, QueryError, Spinner } from '@/shared/ui';
import { NewCustomerDialog } from './NewCustomerDialog';
import { useSalesHome } from './_data';

/**
 * الواجهة الرئيسية لقسم المبيعات [SAL §18]: the two main buttons «عميل جديد / فرصة بيعية جديدة» and «الخدمات»
 * (dropdown of the seven services [SAL §5]; the service screens arrive in S2), plus my follow-ups and queues.
 */
export function SalesHomePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const home = useSalesHome();
  const [newOpen, setNewOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const card = (
    to: string,
    icon: typeof Inbox,
    label: string,
    value: number | null | undefined,
    tone?: 'red' | 'amber',
  ) => {
    const Icon = icon;
    return (
      <Link to={to} className="block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50">
        <div className="flex items-center justify-between">
          <Icon className="size-5 text-slate-500" aria-hidden />
          {tone && value ? (
            <Badge tone={tone}>{value}</Badge>
          ) : (
            <span className="text-2xl font-bold tabular">{value ?? '—'}</span>
          )}
        </div>
        <div className="mt-2 text-sm text-slate-700">{label}</div>
      </Link>
    );
  };
  return (
    <>
      <PageHeader
        title={t('sales.home.title')}
        subtitle={t('sales.home.subtitle')}
        actions={
          <>
            <Button onClick={() => setNewOpen(true)}>
              <UserPlus className="size-4" aria-hidden /> {t('sales.newCustomer')}
            </Button>
            <div className="relative">
              <Button
                variant="secondary"
                onClick={() => setServicesOpen((o) => !o)}
                aria-expanded={servicesOpen}
              >
                {t('sales.services.title')} <ChevronDown className="size-4" aria-hidden />
              </Button>
              {servicesOpen && (
                <ul
                  className="absolute end-0 z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                  role="menu"
                >
                  {SALES_SERVICE_TYPES.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm hover:bg-slate-50"
                        onClick={() => {
                          setServicesOpen(false);
                          nav(`/sales/requests/new/${s}`);
                        }}
                      >
                        <span>{t(`sales.services.${s}`)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        }
      />
      {home.isError ? (
        <QueryError error={home.error} onRetry={() => home.refetch()} />
      ) : home.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {card(
              '/sales/customers?view=mine',
              Building2,
              t('sales.home.myCustomers'),
              home.data!.myCustomers,
            )}
            {card(
              '/sales/customers?followUpDue=true',
              PhoneCall,
              t('sales.home.followUpsDue'),
              home.data!.followUpsDue,
              'amber',
            )}
            {card(
              '/sales/pipeline?open=true',
              KanbanSquare,
              t('sales.home.openOpportunities'),
              home.data!.openOpportunities,
            )}
            {card(
              '/sales/pipeline?followUpDue=true',
              KanbanSquare,
              t('sales.home.overdueOpportunities'),
              home.data!.overdueOpportunities,
              'red',
            )}
            {card(
              '/sales/leads?view=mine&open=true',
              Inbox,
              t('sales.home.leadsForMe'),
              home.data!.leadsForMe,
            )}
            {home.data!.isManager &&
              card('/sales/customers', Building2, t('sales.home.deptCustomers'), home.data!.deptCustomers)}
            {home.data!.isManager &&
              card(
                '/sales/leads?open=true',
                Inbox,
                t('sales.home.unassignedLeads'),
                home.data!.unassignedLeads,
                'amber',
              )}
          </div>
          <Card title={t('sales.home.nextSlices')}>
            <p className="text-sm text-slate-600">{t('sales.home.nextSlicesHint')}</p>
          </Card>
        </div>
      )}
      <NewCustomerDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}
