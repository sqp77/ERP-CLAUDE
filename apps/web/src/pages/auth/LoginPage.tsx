import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { loginSchema, type LoginInput } from '@eayni/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { AuthLayout } from '@/shared/layout/AuthLayout';
import { Alert, Button, Field, Input } from '@/shared/ui';

/** Login page [EP §3]: logo, work email, password, clear error, forgot-password link. */
export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string>();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(undefined);
    try {
      const mfa = await login(values.email, values.password);
      nav(mfa === 'none' ? (loc.state?.from ?? '/') : '/mfa', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthLayout title={t('actions.login')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t('auth.email')} error={form.formState.errors.email?.message} required>
          <Input
            type="email"
            autoComplete="username"
            inputMode="email"
            dir="ltr"
            {...form.register('email')}
            invalid={!!form.formState.errors.email}
          />
        </Field>
        <Field label={t('auth.password')} error={form.formState.errors.password?.message} required>
          <Input
            type="password"
            autoComplete="current-password"
            dir="ltr"
            {...form.register('password')}
            invalid={!!form.formState.errors.password}
          />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {t('actions.login')}
        </Button>
        <div className="text-center text-sm">
          <Link to="/forgot-password" className="text-brand-700 hover:underline">
            {t('auth.forgot')}
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
