import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadFile } from './FileUploader';
import { openSignedUrl } from '@/lib/download';

afterEach(() => vi.unstubAllGlobals());

describe('C15 — presigned PUT goes to the bucket without cookies', () => {
  it('does not send credentials to the storage URL', async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        if (url.endsWith('/files/presign'))
          return new Response(
            JSON.stringify({
              attachmentId: 'a1',
              upload: { url: 'https://bucket.example/k', method: 'PUT', headers: {} },
            }),
            { status: 201 },
          );
        return new Response('{}', { status: 200 });
      }),
    );
    const file = new File([new Uint8Array([1, 2, 3])], 'x.pdf', { type: 'application/pdf' });
    await uploadFile(file);
    const put = calls.find(([u]) => u === 'https://bucket.example/k')!;
    expect(put[1].credentials).not.toBe('include');
    expect(put[1].credentials ?? 'omit').toBe('omit');
  });
});

describe('C19 — downloads work on iPhone (window opened before the await)', () => {
  it('opens the tab synchronously, then points it at the signed URL', async () => {
    const order: string[] = [];
    const tab = { location: { href: '' }, close: vi.fn() };
    const win = {
      open: vi.fn(() => {
        order.push('open');
        return tab;
      }),
      location: { assign: vi.fn() },
    };
    await openSignedUrl(
      async () => {
        order.push('fetch');
        return 'https://files.example/signed';
      },
      win as unknown as Window,
    );
    expect(order).toEqual(['open', 'fetch']);
    expect(tab.location.href).toBe('https://files.example/signed');
  });
});
