import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { forgotPasswordSchema } from '@eayni/shared';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { AuthLayout } from '@/shared/layout/AuthLayout';
import { Alert, Button, Field, Input } from '@/shared/ui';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<{ sent?: boolean; debugToken?: string; error?: string }>({});
  const form = useForm<{ email: string }>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await post<{ ok: boolean; debugToken?: string }>('/auth/password/forgot', v);
      setState({ sent: true, debugToken: r.debugToken });
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  });
  return (
    <AuthLayout title={t('auth.forgotTitle')}>
      {state.sent ? (
        <div className="space-y-3">
          <Alert kind="success">{t('auth.forgotSent')}</Alert>
          {state.debugToken && (
            <Alert kind="warning">
              {t('auth.devToken')}:{' '}
              <Link className="underline" to={`/reset-password?token=${state.debugToken}`}>
                {t('auth.resetTitle')}
              </Link>
            </Alert>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">{t('auth.forgotHint')}</p>
          {state.error && <Alert kind="error">{state.error}</Alert>}
          <Field label={t('auth.email')} error={form.formState.errors.email?.message} required>
            <Input type="email" dir="ltr" {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            {t('actions.send')}
          </Button>
        </form>
      )}
      <div className="mt-4 text-center text-sm">
        <Link to="/login" className="text-brand-700 hover:underline">
          {t('actions.back')}
        </Link>
      </div>
    </AuthLayout>
  );
}
