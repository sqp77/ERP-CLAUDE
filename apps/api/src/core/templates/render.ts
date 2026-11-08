import type { Response } from 'express';
import Handlebars from 'handlebars';
import { TIMEZONE } from '@eayni/shared';
import { formatHijri } from '../dates/businessDays';

const hb = Handlebars.create();
hb.registerHelper('date', (d: Date | string | undefined) =>
  d
    ? new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: TIMEZONE, dateStyle: 'medium' }).format(
        new Date(d),
      )
    : '',
);
hb.registerHelper('hijri', (d: Date | string | undefined) => (d ? formatHijri(new Date(d)) : ''));
hb.registerHelper('money', (halalas: number | undefined) =>
  typeof halalas === 'number'
    ? `${(halalas / 100).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2 })} ر.س`
    : '',
);

/** Render an HTML template (certificates, letters, invoices) from data. Output is RTL-ready HTML. */
export function renderTemplate(source: string, data: Record<string, unknown>): string {
  return hb.compile(source, { noEscape: false })(data);
}

/** Wrap a body in a minimal RTL document with Arabic font fallbacks (CLAUDE.md "PDF"). */
export function htmlDocument(bodyHtml: string, title = ''): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:"Noto Naskh Arabic","Tajawal",Arial,sans-serif;margin:32px;color:#111;line-height:1.7}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px;text-align:start}</style>
</head><body>${bodyHtml}</body></html>`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Every HTML we serve (exports, reports, certificates) is inert: no scripts, no external loads (go-live review E10). */
export const HTML_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  'X-Content-Type-Options': 'nosniff',
} as const;
export function sendHtml(res: Response, html: string, status = 200): void {
  for (const [k, v] of Object.entries(HTML_SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(status).send(html);
}
