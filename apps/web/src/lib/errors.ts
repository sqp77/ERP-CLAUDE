import i18n from '../i18n';
import { ApiError } from './api';

/** Human message for an error: known codes are translated, otherwise the server's Arabic message. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    return i18n.exists(key) ? i18n.t(key) : e.message || i18n.t('common.error');
  }
  if (e instanceof Error) return e.message;
  return i18n.t('common.error');
}

/** Message for a failed query (review C19): 403 → no permission, 404 → not found, else generic. */
export function queryErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return i18n.t('errors.forbidden');
    if (e.status === 404) return i18n.t('errors.not_found');
    if (e.status === 0) return i18n.t('errors.network');
    if (e.status >= 500) return i18n.t('errors.server');
  }
  return errorMessage(e);
}

/**
 * Field-level messages from a 400 validation response (`details: [{ path, message }]`), keyed by the
 * last path segment so `details.endDate` lands on the `endDate` input (review C19).
 */
export function fieldErrorsFrom(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as { path?: string; message?: string }[]) {
    if (!d?.path || !d.message) continue;
    const key = d.path.split('.').pop()!;
    if (!out[key]) out[key] = d.message;
  }
  return out;
}
