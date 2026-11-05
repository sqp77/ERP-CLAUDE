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
import { RouteError } from './shared/layout/RouteError';

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
                  { path: '/hr/employees', element: <EmployeesPage /> },
                  { path: '/hr/employees/:id', element: <EmployeePage /> },
                  { path: '/hr/secondments', element: <SecondmentsPage /> },
                ],
              },
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
            ],
          },
        ],
      },
    ],
  },
]);
