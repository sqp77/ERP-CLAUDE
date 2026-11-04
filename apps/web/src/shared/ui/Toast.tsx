import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cx } from './index';

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}
const Ctx = createContext<{ toast: (text: string, kind?: Toast['kind']) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);
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
