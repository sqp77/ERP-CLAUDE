import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, BACKGROUND_HEADER, setUnauthorizedHandler } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(undefined);
});

describe('C14 — background polling is not user activity', () => {
  it('adds the background header only when asked', async () => {
    const f = mockFetch(200, { unread: 0 });
    await api('/notifications?limit=1', { background: true });
    await api('/notifications?limit=1');
    const first = (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    const second = (f.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(first[BACKGROUND_HEADER]).toBe('1');
    expect(second[BACKGROUND_HEADER]).toBeUndefined();
  });
});

describe('C16 — a lost session clears the client state', () => {
  it('calls the unauthorized handler when the session is gone, not for a wrong password or code', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { error: { code: 'session_idle', message: 'انتهت الجلسة' } });
    await expect(api('/hr/me')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    mockFetch(401, { error: { code: 'invalid_credentials', message: 'خطأ' } });
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError);
    mockFetch(401, { error: { code: 'mfa_invalid', message: 'خطأ' } });
    await expect(api('/auth/mfa/verify', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
