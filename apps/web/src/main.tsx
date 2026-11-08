import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import './styles.css';
import './i18n';
import { router } from './router';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './shared/ui/Toast';
import { PreferencesProvider } from './lib/preferences';

// After a deploy a tab still running the previous build may ask for a chunk that no longer exists (or a new
// index.html references chunks the tab never saw). Vite raises `vite:preloadError`; reload once, guarded by a
// sessionStorage flag so a genuinely broken build cannot loop (staging readiness item 4).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'eayni.preloadReload';
  let already = false;
  try {
    already = sessionStorage.getItem(KEY) === String(location.pathname);
    if (!already) sessionStorage.setItem(KEY, location.pathname);
  } catch {
    /* storage blocked: reload once anyway */
  }
  if (already) return;
  event.preventDefault();
  location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
