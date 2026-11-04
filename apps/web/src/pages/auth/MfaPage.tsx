import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { AuthLayout } from '@/shared/layout/AuthLayout';
import { Alert, Button, Field, Input } from '@/shared/ui';

/** Second factor: verify on login, or enroll when the role makes it mandatory (DECISIONS §2). */
export function MfaPage() {
  const { t } = useTranslation();
  const { mfa, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [enroll, setEnroll] = useState<{ qrDataUrl: string; manualKey: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mfa === 'none') nav('/', { replace: true });
    if (mfa === 'enroll_required' && !enroll) {
      post<{ qrDataUrl: string; manualKey: string }>('/auth/mfa/enroll/start')
        .then(setEnroll)
        .catch((e) => setError(errorMessage(e)));
    }
  }, [mfa, enroll, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await post(mfa === 'enroll_required' ? '/auth/mfa/enroll/confirm' : '/auth/mfa/verify', { code });
      await refresh();
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.mfaTitle')}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {mfa === 'enroll_required' ? (
          <>
            <p className="text-sm text-slate-600">{t('auth.mfaEnrollHint')}</p>
            {enroll && (
              <div className="flex flex-col items-center gap-2">
                <img src={enroll.qrDataUrl} alt="QR" className="size-48 rounded-lg border" />
                <div className="text-xs text-slate-500">{t('auth.mfaManualKey')}</div>
                <code dir="ltr" className="rounded bg-slate-100 px-2 py-1 text-sm tracking-wider">
                  {enroll.manualKey}
                </code>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600">{t('auth.mfaVerifyHint')}</p>
        )}
        <Field label={t('auth.mfaCode')} required>
          <Input
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="text-center text-lg tracking-[0.5em]"
            autoFocus
          />
        </Field>
        <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
          {t('actions.confirm')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => logout().then(() => nav('/login'))}
        >
          {t('actions.logout')}
        </Button>
      </form>
    </AuthLayout>
  );
}
