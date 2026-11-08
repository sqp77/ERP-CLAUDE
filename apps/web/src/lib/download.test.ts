import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSignedUrl, setPopupBlockedHandler } from './download';

afterEach(() => setPopupBlockedHandler(undefined));

describe('H1 — signed downloads open in a detached tab and never navigate the app tab', () => {
  it('opens the tab before awaiting, detaches the opener, then points it at the URL', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.fn(() => tab as unknown as Window);
    let resolve!: (v: string) => void;
    const pending = openSignedUrl(() => new Promise<string>((r) => (resolve = r)), { open });
    expect(open).toHaveBeenCalledWith('about:blank', '_blank'); // synchronous, no noopener
    expect(tab.opener).toBeNull();
    resolve('https://files.example/signed');
    expect(await pending).toEqual({ opened: true, url: 'https://files.example/signed' });
    expect(tab.location.href).toBe('https://files.example/signed');
  });

  it('closes the blank tab when fetching the URL fails', async () => {
    const tab = { opener: null, location: { href: '' }, close: vi.fn() };
    await expect(
      openSignedUrl(() => Promise.reject(new Error('403')), { open: () => tab as unknown as Window }),
    ).rejects.toThrow('403');
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });

  it('when the popup is blocked it reports the URL to the handler instead of navigating', async () => {
    const blocked = vi.fn();
    setPopupBlockedHandler(blocked);
    const r = await openSignedUrl(async () => 'https://files.example/x', { open: () => null });
    expect(r).toEqual({ opened: false, url: 'https://files.example/x' });
    expect(blocked).toHaveBeenCalledWith('https://files.example/x');
  });
});
