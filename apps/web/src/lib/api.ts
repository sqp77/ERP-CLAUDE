export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Options = Omit<RequestInit, 'body'> & {
  body?: unknown;
  raw?: boolean;
  /** Periodic polling: the server does not count it as user activity for the idle timeout (review C14). */
  background?: boolean;
};

export const BACKGROUND_HEADER = 'x-background';

/** 401 codes that mean the session itself is gone (not a wrong password or code). */
const SESSION_LOST = new Set([
  'unauthorized',
  'invalid_session',
  'session_revoked',
  'session_expired',
  'session_idle',
  'account_disabled',
  'mfa_locked',
]);

let onUnauthorized: (() => void) | undefined;
/** Registered by AuthProvider: clears cached data (salaries, IBANs…) and returns to the login page (review C16). */
export function setUnauthorizedHandler(fn: (() => void) | undefined): void {
  onUnauthorized = fn;
}

/** Cookie-based session (httpOnly). All calls go through the Vite proxy in dev. */
export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { body, raw, headers, background, ...rest } = opts;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(background ? { [BACKGROUND_HEADER]: '1' } : {}),
        ...(headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', '');
  }
  if (res.status === 204) return undefined as T;
  if (raw) return res as unknown as T;
  const data = (await res.json().catch(() => ({}))) as {
    error?: { code: string; message: string; details?: unknown };
  };
  if (!res.ok) {
    const e = data.error ?? { code: 'unknown', message: '' };
    if (res.status === 401 && SESSION_LOST.has(e.code)) onUnauthorized?.();
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return data as T;
}

export const get = <T>(path: string, opts?: Pick<Options, 'background'>) => api<T>(path, opts);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
