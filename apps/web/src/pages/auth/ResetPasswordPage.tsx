import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { AuthLayout } from '@/shared/layout/AuthLayout';
import { Alert, Button, Field, Input } from '@/shared/ui';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<{ done?: boolean; error?: string }>({});
  const form = useForm<{ newPassword: string; confirm: string }>({
    defaultValues: { newPassword: '', confirm: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    if (v.newPassword !== v.confirm) return form.setError('confirm', { message: t('auth.passwordMismatch') });
    try {
      await post('/auth/password/reset', { token, newPassword: v.newPassword });
      setState({ done: true });
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  });
  return (
    <AuthLayout title={t('auth.resetTitle')}>
      {state.done ? (
        <div className="space-y-4">
          <Alert kind="success">{t('auth.resetDone')}</Alert>
          <Link to="/login">
            <Button className="w-full">{t('actions.login')}</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {state.error && <Alert kind="error">{state.error}</Alert>}
          <Field label={t('auth.newPassword')} required>
            <Input
              type="password"
              autoComplete="new-password"
              dir="ltr"
              {...form.register('newPassword', { required: true, minLength: 8 })}
            />
          </Field>
          <Field label={t('auth.confirmPassword')} error={form.formState.errors.confirm?.message} required>
            <Input
              type="password"
              autoComplete="new-password"
              dir="ltr"
              {...form.register('confirm', { required: true })}
            />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            {t('actions.save')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
