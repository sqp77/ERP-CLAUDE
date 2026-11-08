/**
 * Open a signed download URL in a new tab (go-live review H1, C19).
 *
 * - The tab is opened synchronously, before the `await`, because iPhone Safari blocks `window.open`
 *   after an async gap. It is opened WITHOUT `noopener` (that returns null and we could not point it
 *   at the URL); instead `opener` is cleared by hand so the download page cannot reach the app.
 * - When the popup is blocked the app tab is never navigated away: the URL is handed to the
 *   registered handler (a toast with a link) and to the caller.
 */
export interface OpenSignedUrlResult {
  opened: boolean;
  url: string;
}

let onBlocked: ((url: string) => void) | undefined;
/** Registered by the toast provider: shows the link when the browser blocked the new tab. */
export function setPopupBlockedHandler(fn: ((url: string) => void) | undefined): void {
  onBlocked = fn;
}

export async function openSignedUrl(
  fetchUrl: () => Promise<string>,
  win: Pick<Window, 'open'> = window,
): Promise<OpenSignedUrlResult> {
  const tab = win.open('about:blank', '_blank');
  if (tab) {
    try {
      tab.opener = null;
    } catch {
      /* cross-origin opener already detached */
    }
  }
  let url: string;
  try {
    url = await fetchUrl();
  } catch (e) {
    tab?.close();
    throw e;
  }
  if (tab) {
    tab.location.href = url;
    return { opened: true, url };
  }
  onBlocked?.(url);
  return { opened: false, url };
}
