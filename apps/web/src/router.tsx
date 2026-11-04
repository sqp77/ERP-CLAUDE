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

export const router = createBrowserRouter([
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
          {
            element: <RequirePermission resource="tasks" action="view" />,
            children: [{ path: '/tasks', element: <TasksPage /> }],
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
]);
