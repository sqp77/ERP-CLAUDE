/**
 * PDF adapter. Phase 0 ships the interface and an explicit "not configured" implementation.
 * A Chromium-based renderer (puppeteer-core + @sparticuz/chromium in its own Lambda) is added when
 * the first template needs a PDF (HR certificates in phase 1). Listed in DECISIONS "Pending before staging".
 */
export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
}

export class NotConfiguredPdfRenderer implements PdfRenderer {
  async render(): Promise<Buffer> {
    throw new Error('PDF renderer is not configured yet');
  }
}

let renderer: PdfRenderer = new NotConfiguredPdfRenderer();
export const pdf = (): PdfRenderer => renderer;
export const setPdfRenderer = (r: PdfRenderer): void => {
  renderer = r;
};
