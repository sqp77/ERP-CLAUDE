import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { AuthLayout } from '@/shared/layout/AuthLayout';
import { Alert, Button, Field, Input } from '@/shared/ui';

/** Forced change of a temporary password before first use. */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string>();
  const form = useForm<{ currentPassword: string; newPassword: string; confirm: string }>();
  const submit = form.handleSubmit(async (v) => {
    if (v.newPassword !== v.confirm) return form.setError('confirm', { message: t('auth.passwordMismatch') });
    try {
      await post('/auth/password/change', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      await refresh();
      nav('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <AuthLayout title={t('auth.changePassword')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Alert kind="warning">{t('auth.mustChange')}</Alert>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('auth.currentPassword')} required>
          <Input
            type="password"
            dir="ltr"
            autoComplete="current-password"
            {...form.register('currentPassword', { required: true })}
          />
        </Field>
        <Field label={t('auth.newPassword')} required>
          <Input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            {...form.register('newPassword', { required: true, minLength: 8 })}
          />
        </Field>
        <Field label={t('auth.confirmPassword')} error={form.formState.errors.confirm?.message} required>
          <Input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            {...form.register('confirm', { required: true })}
          />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {t('actions.save')}
        </Button>
      </form>
    </AuthLayout>
  );
}
