/**
 * Open a signed download URL in a new tab. Safari on iPhone blocks `window.open` after an `await`, so
 * the tab is opened synchronously and pointed at the URL once it is known (review C19).
 */
export async function openSignedUrl(fetchUrl: () => Promise<string>, win: Window = window): Promise<void> {
  const tab = win.open('about:blank', '_blank', 'noopener');
  try {
    const url = await fetchUrl();
    if (tab) tab.location.href = url;
    else win.location.assign(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
