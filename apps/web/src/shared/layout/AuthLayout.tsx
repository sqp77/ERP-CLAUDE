import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Login-side layout with the cooperative's identity (text logo until brand assets arrive, DECISIONS §1) [EP §3.1]. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-slate-100 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-brand-700 text-2xl font-bold text-white shadow">
            عيني
          </div>
          <div className="text-lg font-bold text-slate-900">{t('app.org')}</div>
          <div className="text-sm text-slate-600">{t('app.tagline')}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
