import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CurrentUser } from '@eayni/shared';
import { ApiError, get, post, setUnauthorizedHandler } from './api';

export type MfaState = 'none' | 'required' | 'enroll_required';

interface MeResponse {
  user: CurrentUser;
  mfa: MfaState;
  mustChangePassword: boolean;
}

interface AuthState {
  loading: boolean;
  user: CurrentUser | null;
  mfa: MfaState;
  mustChangePassword: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<MfaState>;
  logout: () => Promise<void>;
  can: (resource: string, action: string) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await get<MeResponse>('/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else if (e instanceof ApiError && e.status === 0) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A lost session anywhere → drop cached data (salaries, IBANs…) and fall back to the login page (review C16).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.clear();
      setMe(null);
    });
    return () => setUnauthorizedHandler(undefined);
  }, [qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await post<{ mfa: MfaState; user: CurrentUser }>('/auth/login', { email, password });
      await refresh();
      return r.mfa;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setMe(null);
      qc.clear();
    }
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user: me?.user ?? null,
      mfa: me?.mfa ?? 'none',
      mustChangePassword: me?.mustChangePassword ?? false,
      refresh,
      login,
      logout,
      // Mirrors the server's grants to hide what the API forbids; the API still enforces (golden rule 1).
      can: (resource, action) =>
        !!me?.user.permissions.some((p) => p.resource === resource && p.actions.includes(action)),
    }),
    [loading, me, refresh, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
