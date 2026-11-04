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
