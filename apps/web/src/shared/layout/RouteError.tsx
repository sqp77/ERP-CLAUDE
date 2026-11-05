import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@/shared/ui';

/** Arabic error boundary for the router (review C12): a crashed page never leaves a blank screen. */
export function RouteError() {
  const err = useRouteError();
  const { t } = useTranslation();
  const detail = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : '';
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6" dir="rtl">
      <Alert kind="error">
        <div className="font-semibold">{t('routeError.title')}</div>
        <div className="text-sm">{t('routeError.body')}</div>
        {detail && (
          <pre
            dir="ltr"
            className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-slate-600"
          >
            {detail}
          </pre>
        )}
      </Alert>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>{t('actions.retry')}</Button>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-sm"
        >
          {t('routeError.home')}
        </Link>
      </div>
    </div>
  );
}
