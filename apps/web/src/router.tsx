import { createBrowserRouter } from 'react-router';
import { AppShell } from './shared/layout/AppShell';
import { RequireAuth, RequireGuest, RequirePermission } from './shared/layout/guards';
import { LoginPage } from './pages/auth/LoginPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { MfaPage } from './pages/auth/MfaPage';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SecurityPage } from './pages/me/SecurityPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { CalendarPage } from './pages/calendar/CalendarPage';
import { UsersPage } from './pages/admin/UsersPage';
import { RolesPage } from './pages/admin/RolesPage';
import { DepartmentsPage } from './pages/admin/DepartmentsPage';
import { BranchesPage } from './pages/admin/BranchesPage';
import { HolidaysPage } from './pages/admin/HolidaysPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { AuditPage } from './pages/admin/AuditPage';
import { OutboxPage } from './pages/admin/OutboxPage';
import { WorkflowsPage } from './pages/admin/WorkflowsPage';
import { UnitsPage } from './pages/admin/UnitsPage';
import { PositionsPage } from './pages/admin/PositionsPage';
import { EmployeesPage } from './pages/hr/EmployeesPage';
import { EmployeePage } from './pages/hr/EmployeePage';
import { ProfilePage } from './pages/me/ProfilePage';
import { ProfileChangesPage } from './pages/hr/ProfileChangesPage';
import { SecondmentsPage } from './pages/hr/SecondmentsPage';
import { RequestsListPage } from './pages/requests/RequestsListPage';
import { RequestDetailPage } from './pages/requests/RequestDetailPage';
import { TeamPage } from './pages/manager/TeamPage';
import { BoardPage } from './pages/tasks/BoardPage';
import { TicketsListPage } from './pages/tickets/TicketsListPage';
import { TicketDetailPage } from './pages/tickets/TicketDetailPage';
import { NewsPage } from './pages/news/NewsPage';
import { NewsDetailPage } from './pages/news/NewsDetailPage';
import { ReportsListPage } from './pages/reports/ReportsListPage';
import { ReportDetailPage } from './pages/reports/ReportDetailPage';
import { ManagerDashboardPage } from './pages/dashboards/ManagerDashboardPage';
import { HrDashboardPage } from './pages/dashboards/HrDashboardPage';
import { ExportPage } from './pages/hr/ExportPage';
import { ExpiringPage } from './pages/hr/ExpiringPage';
import { RouteError } from './shared/layout/RouteError';
import { SalesHomePage } from './pages/sales/SalesHomePage';
import { CustomersPage } from './pages/sales/CustomersPage';
import { CustomerPage } from './pages/sales/CustomerPage';
import { PipelinePage } from './pages/sales/PipelinePage';
import { LeadsPage } from './pages/sales/LeadsPage';
import { ReferLeadPage } from './pages/cs/ReferLeadPage';
import { RequestsPage } from './pages/sales/requests/RequestsPage';
import { NewRequestPage } from './pages/sales/requests/NewRequestPage';
import { RequestDetailPage as SalesRequestDetailPage } from './pages/sales/requests/RequestDetailPage';
import { PriceListPage } from './pages/sales/pricing/PriceListPage';
import { QuotesPage } from './pages/sales/pricing/QuotesPage';
import { QuotePage } from './pages/sales/pricing/QuotePage';
import { ContractsPage, ContractPage } from './pages/sales/pricing/ContractsPage';
import { InvoicesPage } from './pages/sales/pricing/InvoicesPage';
import { SalesDashboardPage } from './pages/sales/management/SalesDashboardPage';
import { SalesKpiPage } from './pages/sales/management/SalesKpiPage';
import { SalesTargetsPage } from './pages/sales/management/SalesTargetsPage';
import { SalesLibraryPage } from './pages/sales/management/SalesLibraryPage';
import { SalesTasksPage } from './pages/sales/management/SalesTasksPage';
import { SalesReportsPage } from './pages/sales/management/SalesReportsPage';
import { DiscussionPage, DiscussionsPage } from './pages/discussions/DiscussionsPage';

export const router = createBrowserRouter([
  {
    // Arabic error boundary for every route (review C12).
    errorElement: <RouteError />,
    children: [
      {
        element: <RequireGuest />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { path: '/mfa', element: <MfaPage /> },
          { path: '/change-password', element: <ChangePasswordPage /> },
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <DashboardPage /> },
              { path: '/notifications', element: <NotificationsPage /> },
              { path: '/me/security', element: <SecurityPage /> },
              { path: '/me/profile', element: <ProfilePage /> },
              { path: '/me/requests', element: <RequestsListPage view="mine" /> },
              { path: '/me/requests/:id', element: <RequestDetailPage /> },
              { path: '/hr/requests/:id', element: <RequestDetailPage /> },
              { path: '/manager/requests', element: <RequestsListPage view="inbox" /> },
              { path: '/manager/team', element: <TeamPage /> },
              { path: '/me/tickets', element: <TicketsListPage view="mine" /> },
              { path: '/tickets', element: <TicketsListPage view="assigned" /> },
              { path: '/tickets/:id', element: <TicketDetailPage /> },
              { path: '/news', element: <NewsPage /> },
              { path: '/news/:id', element: <NewsDetailPage /> },
              { path: '/me/reports', element: <ReportsListPage view="mine" /> },
              { path: '/reports', element: <ReportsListPage view="team" /> },
              { path: '/reports/:id', element: <ReportDetailPage /> },
              { path: '/manager/dashboard', element: <ManagerDashboardPage /> },
              { path: '/hr/requests', element: <RequestsListPage view="queue" /> },
              {
                element: <RequirePermission resource="tasks" action="view" />,
                children: [
                  { path: '/tasks', element: <TasksPage /> },
                  { path: '/tasks/board', element: <BoardPage /> },
                  { path: '/tasks/:id', element: <TasksPage /> },
                ],
              },
              {
                element: <RequirePermission resource="calendar" action="view" />,
                children: [{ path: '/calendar', element: <CalendarPage /> }],
              },
              {
                element: <RequirePermission resource="users" action="view" />,
                children: [{ path: '/admin/users', element: <UsersPage /> }],
              },
              {
                element: <RequirePermission resource="roles" action="view" />,
                children: [{ path: '/admin/roles', element: <RolesPage /> }],
              },
              {
                element: <RequirePermission resource="org.departments" action="edit" />,
                children: [{ path: '/admin/departments', element: <DepartmentsPage /> }],
              },
              {
                element: <RequirePermission resource="org.branches" action="edit" />,
                children: [{ path: '/admin/branches', element: <BranchesPage /> }],
              },
              {
                element: <RequirePermission resource="org.units" action="edit" />,
                children: [{ path: '/admin/units', element: <UnitsPage /> }],
              },
              {
                element: <RequirePermission resource="org.positions" action="edit" />,
                children: [{ path: '/admin/positions', element: <PositionsPage /> }],
              },
              {
                element: <RequirePermission resource="hr.profile_changes" action="view" />,
                children: [{ path: '/hr/profile-changes', element: <ProfileChangesPage /> }],
              },
              {
                element: <RequirePermission resource="hr.employees" action="view" />,
                children: [
                  { path: '/hr/dashboard', element: <HrDashboardPage /> },
                  { path: '/hr/export', element: <ExportPage /> },
                  { path: '/hr/expiring', element: <ExpiringPage /> },
                  { path: '/hr/employees', element: <EmployeesPage /> },
                  { path: '/hr/employees/:id', element: <EmployeePage /> },
                  { path: '/hr/secondments', element: <SecondmentsPage /> },
                ],
              },
              {
                element: <RequirePermission resource="crm.customers" action="view" />,
                children: [
                  { path: '/sales', element: <SalesHomePage /> },
                  { path: '/sales/customers', element: <CustomersPage /> },
                  { path: '/sales/customers/:id', element: <CustomerPage /> },
                  { path: '/sales/pipeline', element: <PipelinePage /> },
                  { path: '/sales/leads', element: <LeadsPage /> },
                  { path: '/sales/requests/new/:type', element: <NewRequestPage /> },
                ],
              },
              // Requests are visible to Sales and to the receiving departments; the API decides per record.
              { path: '/sales/requests', element: <RequestsPage /> },
              { path: '/sales/requests/:id', element: <SalesRequestDetailPage /> },
              { path: '/incoming', element: <RequestsPage incoming /> },
              {
                element: <RequirePermission resource="sales.pricelist" action="view" />,
                children: [{ path: '/sales/pricelist', element: <PriceListPage /> }],
              },
              {
                element: <RequirePermission resource="sales.quotes" action="view" />,
                children: [
                  { path: '/sales/quotes', element: <QuotesPage /> },
                  { path: '/sales/quotes/:id', element: <QuotePage /> },
                ],
              },
              {
                element: <RequirePermission resource="sales.contracts" action="view" />,
                children: [
                  { path: '/sales/contracts', element: <ContractsPage /> },
                  { path: '/sales/contracts/:id', element: <ContractPage /> },
                ],
              },
              {
                element: <RequirePermission resource="finance.invoices" action="view" />,
                children: [
                  { path: '/sales/invoices', element: <InvoicesPage /> },
                  { path: '/sales/invoices/:id', element: <InvoicesPage /> },
                ],
              },
              // Sales S4 — management and follow-up [SAL §17 المرحلة الرابعة]
              {
                element: <RequirePermission resource="sales.dashboard" action="view" />,
                children: [
                  { path: '/sales/dashboard', element: <SalesDashboardPage /> },
                  { path: '/sales/tasks', element: <SalesTasksPage /> },
                ],
              },
              {
                element: <RequirePermission resource="sales.kpi" action="view" />,
                children: [{ path: '/sales/kpi', element: <SalesKpiPage /> }],
              },
              {
                element: <RequirePermission resource="sales.targets" action="view" />,
                children: [{ path: '/sales/targets', element: <SalesTargetsPage /> }],
              },
              {
                element: <RequirePermission resource="sales.library" action="view" />,
                children: [{ path: '/sales/library', element: <SalesLibraryPage /> }],
              },
              {
                element: <RequirePermission resource="sales.reports" action="export" />,
                children: [{ path: '/sales/reports', element: <SalesReportsPage /> }],
              },
              {
                element: <RequirePermission resource="discussions" action="view" />,
                children: [
                  { path: '/discussions', element: <DiscussionsPage /> },
                  { path: '/discussions/:id', element: <DiscussionPage /> },
                ],
              },
              { path: '/cs/refer-lead', element: <ReferLeadPage /> },
              {
                element: <RequirePermission resource="holidays" action="edit" />,
                children: [{ path: '/admin/holidays', element: <HolidaysPage /> }],
              },
              {
                element: <RequirePermission resource="workflows" action="view" />,
                children: [{ path: '/admin/workflows', element: <WorkflowsPage /> }],
              },
              {
                element: <RequirePermission resource="settings" action="view" />,
                children: [{ path: '/admin/settings', element: <SettingsPage /> }],
              },
              {
                element: <RequirePermission resource="audit" action="view" />,
                children: [{ path: '/admin/audit', element: <AuditPage /> }],
              },
              {
                element: <RequirePermission resource="outbox" action="view" />,
                children: [{ path: '/admin/outbox', element: <OutboxPage /> }],
              },
            ],
          },
        ],
      },
    ],
  },
]);
