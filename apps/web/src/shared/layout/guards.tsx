import { Navigate, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/shared/ui';

/** Requires a verified session; routes the user through MFA / forced password change first. */
export function RequireAuth() {
  const { loading, user, mfa, mustChangePassword } = useAuth();
  const loc = useLocation();
  const { t } = useTranslation();
  if (loading) return <Spinner label={t('common.loading')} />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (mfa !== 'none' && loc.pathname !== '/mfa') return <Navigate to="/mfa" replace />;
  if (mfa === 'none' && mustChangePassword && loc.pathname !== '/change-password')
    return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function RequireGuest() {
  const { loading, user, mfa } = useAuth();
  const { t } = useTranslation();
  if (loading) return <Spinner label={t('common.loading')} />;
  if (user) return <Navigate to={mfa === 'none' ? '/' : '/mfa'} replace />;
  return <Outlet />;
}

export function RequirePermission({ resource, action }: { resource: string; action: string }) {
  const { can } = useAuth();
  if (!can(resource, action)) return <Navigate to="/" replace />;
  return <Outlet />;
}
