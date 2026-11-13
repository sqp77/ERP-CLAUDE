import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Briefcase,
  Building2,
  IdCard,
  CalendarDays,
  ClipboardList,
  FileClock,
  Home,
  UserRound,
  Inbox,
  Send,
  FileCheck2,
  LogOut,
  Menu,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Workflow,
  FileText,
  Newspaper,
  Ticket,
  X,
  KanbanSquare,
  HandCoins,
  Landmark,
  LayoutDashboard,
  Gauge,
  Target,
  ListChecks,
  Library,
  MessagesSquare,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/preferences';
import { get } from '@/lib/api';
import { cx } from '@/shared/ui';

/** RTL application shell: sidebar on the start side, phone-first collapsible (EP §17, golden rule 9). */
export function AppShell() {
  const { t } = useTranslation();
  const { user, logout, can } = useAuth();
  const { calendar, setCalendar } = usePrefs();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const inbox = useQuery({
    queryKey: ['hr-requests', 'inbox', 'count'],
    queryFn: () => get<{ total: number }>('/hr/requests?view=inbox&limit=1', { background: true }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => get<{ unread: number }>('/notifications?limit=1', { background: true }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const team = useQuery({
    queryKey: ['team'],
    queryFn: () => get<{ items: unknown[] }>('/hr/team'),
    staleTime: 5 * 60_000,
  });
  // Customer Service users may refer leads to Sales without any Sales grant [SAL §3]; the API decides.
  const crmMeta = useQuery({
    queryKey: ['crm', 'meta'],
    queryFn: () => get<{ canReferLeads: boolean }>('/crm/meta'),
    staleTime: 5 * 60_000,
  });
  // «الطلبات الواردة من المبيعات»: members of Procurement, Finance and Operations [SAL §3 ملاحظة, §19].
  const reqMeta = useQuery({
    queryKey: ['sales', 'requests', 'meta'],
    queryFn: () => get<{ incomingHolders: string[] }>('/sales/requests/meta'),
    staleTime: 5 * 60_000,
  });
  const salesItems = [
    { to: '/sales', label: t('nav.salesHome'), icon: HandCoins, show: can('crm.customers', 'view') },
    {
      to: '/sales/dashboard',
      label: t('nav.salesDashboard'),
      icon: LayoutDashboard,
      show: can('sales.dashboard', 'view'),
    },
    {
      to: '/sales/customers',
      label: t('nav.customers'),
      icon: Building2,
      show: can('crm.customers', 'view'),
    },
    {
      to: '/sales/pipeline',
      label: t('nav.pipeline'),
      icon: KanbanSquare,
      show: can('sales.opportunities', 'view'),
    },
    { to: '/sales/leads', label: t('nav.leads'), icon: Inbox, show: can('crm.leads', 'view') },
    {
      to: '/sales/requests',
      label: t('nav.salesRequests'),
      icon: ClipboardList,
      show: can('sales.requests', 'view'),
    },
    {
      to: '/incoming',
      label: t('nav.incomingFromSales'),
      icon: Inbox,
      show: !!reqMeta.data?.incomingHolders.length,
    },
    { to: '/sales/quotes', label: t('nav.quotes'), icon: FileText, show: can('sales.quotes', 'view') },
    {
      to: '/sales/pricelist',
      label: t('nav.pricelist'),
      icon: HandCoins,
      show: can('sales.pricelist', 'view'),
    },
    {
      to: '/sales/contracts',
      label: t('nav.contracts'),
      icon: FileCheck2,
      show: can('sales.contracts', 'view'),
    },
    {
      to: '/sales/invoices',
      label: t('nav.invoices'),
      icon: Landmark,
      show: can('finance.invoices', 'view'),
    },
    { to: '/sales/kpi', label: t('nav.salesKpi'), icon: Gauge, show: can('sales.kpi', 'view') },
    { to: '/sales/targets', label: t('nav.salesTargets'), icon: Target, show: can('sales.targets', 'view') },
    {
      to: '/sales/tasks',
      label: t('nav.salesTasks'),
      icon: ListChecks,
      show: can('sales.dashboard', 'view'),
    },
    { to: '/sales/library', label: t('nav.salesLibrary'), icon: Library, show: can('sales.library', 'view') },
    {
      to: '/cs/refer-lead',
      label: t('nav.referLead'),
      icon: Send,
      show: !!crmMeta.data?.canReferLeads && !can('crm.leads', 'view'),
    },
  ];

  const items = [
    { to: '/', label: t('nav.dashboard'), icon: Home, show: true },
    { to: '/me/profile', label: t('nav.profile'), icon: UserRound, show: true },
    { to: '/me/requests', label: t('nav.myRequests'), icon: Send, show: can('hr.requests', 'create') },
    { to: '/me/tickets', label: t('nav.myTickets'), icon: Ticket, show: can('tickets', 'view') },
    { to: '/manager/requests', label: t('nav.teamRequests'), icon: Inbox, show: !!inbox.data?.total },
    { to: '/manager/team', label: t('nav.team'), icon: Users, show: !!team.data?.items.length },
    {
      to: '/manager/dashboard',
      label: t('nav.managerDashboard'),
      icon: Home,
      show: !!team.data?.items.length,
    },
    { to: '/tasks', label: t('nav.tasks'), icon: ClipboardList, show: can('tasks', 'view') },
    { to: '/tasks/board', label: t('nav.taskBoard'), icon: ClipboardList, show: can('tasks', 'create') },
    { to: '/calendar', label: t('nav.calendar'), icon: CalendarDays, show: can('calendar', 'view') },
    {
      to: '/discussions',
      label: t('nav.discussions'),
      icon: MessagesSquare,
      show: can('discussions', 'view'),
    },
    { to: '/me/reports', label: t('nav.myReports'), icon: FileText, show: can('hr.reports', 'view') },
    { to: '/news', label: t('nav.news'), icon: Newspaper, show: can('news', 'view') },
    { to: '/notifications', label: t('nav.notifications'), icon: Bell, show: true },
    { to: '/me/security', label: t('nav.security'), icon: ShieldCheck, show: true },
  ];
  const hrItems = [
    {
      to: '/hr/employees',
      label: t('nav.employees'),
      icon: IdCard,
      show:
        can('hr.employees', 'view') &&
        (can('hr.employees', 'create') ||
          can('hr.employees', 'export') ||
          user?.roles.some((r) => r.role === 'department_manager' || r.role === 'executive')),
    },
    {
      to: '/hr/dashboard',
      label: t('nav.hrDashboard'),
      icon: Home,
      // Same rule the API applies to the dashboard (review H5): whoever sees all employees.
      show:
        can('hr.employees', 'view') &&
        user?.permissions.find((p) => p.resource === 'hr.employees')?.scope === 'all',
    },
    {
      to: '/hr/export',
      label: t('nav.export'),
      icon: FileText,
      show: can('hr.employees', 'export'),
    },
    {
      to: '/hr/requests',
      label: t('nav.hrRequests'),
      icon: Inbox,
      show: can('hr.requests', 'approve'),
    },
    {
      to: '/hr/secondments',
      label: t('nav.secondments'),
      icon: Briefcase,
      show: can('hr.employees', 'create'),
    },
    {
      to: '/hr/profile-changes',
      label: t('nav.profileChanges'),
      icon: FileCheck2,
      show: (user?.permissions.find((p) => p.resource === 'hr.profile_changes')?.scope ?? 'own') !== 'own',
    },
  ];
  const admin = [
    { to: '/admin/users', label: t('nav.users'), icon: Users, show: can('users', 'view') },
    { to: '/admin/roles', label: t('nav.roles'), icon: Shield, show: can('roles', 'view') },
    {
      to: '/admin/departments',
      label: t('nav.departments'),
      icon: Building2,
      show: can('org.departments', 'edit'),
    },
    { to: '/admin/branches', label: t('nav.branches'), icon: Building2, show: can('org.branches', 'edit') },
    { to: '/admin/units', label: t('nav.units'), icon: Building2, show: can('org.units', 'edit') },
    {
      to: '/admin/positions',
      label: t('nav.positions'),
      icon: Briefcase,
      show: can('org.positions', 'edit'),
    },
    { to: '/admin/holidays', label: t('nav.holidays'), icon: CalendarDays, show: can('holidays', 'edit') },
    { to: '/admin/workflows', label: t('nav.workflows'), icon: Workflow, show: can('workflows', 'view') },
    { to: '/admin/settings', label: t('nav.settings'), icon: Settings, show: can('settings', 'view') },
    { to: '/admin/audit', label: t('nav.audit'), icon: FileClock, show: can('audit', 'view') },
    { to: '/admin/outbox', label: t('nav.outbox'), icon: Send, show: can('outbox', 'view') },
  ];

  const link = (to: string, label: string, Icon: typeof Home) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      onClick={() => setOpen(false)}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
          isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100',
        )
      }
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span>{label}</span>
    </NavLink>
  );

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label={t('nav.mainMenu')}>
      <div className="mb-3 flex items-center justify-between px-2 py-1">
        <div className="text-lg font-bold text-brand-800">{t('app.name')}</div>
        <button
          className="rounded-md p-1 text-slate-500 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label={t('actions.close')}
        >
          <X className="size-5" />
        </button>
      </div>
      {items.filter((i) => i.show).map((i) => link(i.to, i.label, i.icon))}
      {salesItems.some((a) => a.show) && (
        <>
          <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('nav.sales')}
          </div>
          {salesItems.filter((i) => i.show).map((i) => link(i.to, i.label, i.icon))}
        </>
      )}
      {hrItems.some((a) => a.show) && (
        <>
          <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('nav.hr')}
          </div>
          {hrItems.filter((i) => i.show).map((i) => link(i.to, i.label, i.icon))}
        </>
      )}
      {admin.some((a) => a.show) && (
        <>
          <div className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('nav.admin')}
          </div>
          {admin.filter((i) => i.show).map((i) => link(i.to, i.label, i.icon))}
        </>
      )}
      <div className="mt-auto border-t border-slate-200 pt-3">
        <div className="truncate px-3 text-sm font-medium text-slate-800">{user?.displayNameAr}</div>
        <div className="truncate px-3 text-xs text-slate-500">{user?.email}</div>
        <button
          onClick={() => logout().then(() => nav('/login'))}
          className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-100"
        >
          <LogOut className="size-5" aria-hidden />
          {t('actions.logout')}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden border-e border-slate-200 bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 max-w-[85vw] bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur sm:px-5">
          <button
            className="rounded-md p-2 text-slate-600 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={t('nav.openMenu')}
          >
            <Menu className="size-5" />
          </button>
          <div className="text-sm font-semibold text-slate-700 lg:hidden">{t('app.name')}</div>
          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            <div
              className="flex rounded-lg border border-slate-200 p-0.5 text-xs"
              role="group"
              aria-label={t('nav.calendarKind')}
            >
              {(['gregorian', 'hijri'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCalendar(c)}
                  className={cx(
                    'rounded-md px-2.5 py-1.5',
                    calendar === c ? 'bg-brand-700 text-white' : 'text-slate-600',
                  )}
                >
                  {c === 'gregorian' ? t('common.calendarG') : t('common.calendarH')}
                </button>
              ))}
            </div>
            <NavLink
              to="/notifications"
              className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
              aria-label={t('nav.notifications')}
            >
              <Bell className="size-5" />
              {!!unread.data?.unread && (
                <span className="absolute -top-0.5 -end-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-5 text-white">
                  {unread.data.unread > 99 ? '99+' : unread.data.unread}
                </span>
              )}
            </NavLink>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
