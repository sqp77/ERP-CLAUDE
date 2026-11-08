import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { setPopupBlockedHandler } from '@/lib/download';
import { cx } from './index';

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
  /** Optional link shown after the text (e.g. a blocked download — review H1). */
  link?: { href: string; label: string };
}
type ToastFn = (text: string, kind?: Toast['kind'], link?: Toast['link']) => void;
const Ctx = createContext<{ toast: ToastFn } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const { t } = useTranslation();
  const toast = useCallback<ToastFn>((text, kind = 'success', link) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text, link }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), link ? 12_000 : 4000);
  }, []);
  // A blocked download tab becomes a toast with the link (review H1); the app tab is never navigated.
  useEffect(() => {
    setPopupBlockedHandler((href) =>
      toast(t('files.popupBlocked'), 'info', { href, label: t('files.openLink') }),
    );
    return () => setPopupBlockedHandler(undefined);
  }, [toast, t]);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto rounded-lg px-4 py-2.5 text-sm text-white shadow-lg',
              t.kind === 'error' ? 'bg-red-600' : t.kind === 'info' ? 'bg-slate-800' : 'bg-emerald-600',
            )}
          >
            {t.text}
            {t.link && (
              <a
                href={t.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="ms-2 underline underline-offset-2"
              >
                {t.link.label}
              </a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v.toast;
}
