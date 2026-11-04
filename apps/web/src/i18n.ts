import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar/common.json';

/** Arabic-first UI: all copy lives in the ar translation files, never hard-coded (CLAUDE.md). */
void i18n.use(initReactI18next).init({
  resources: { ar: { common: ar } },
  lng: 'ar',
  fallbackLng: 'ar',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export default i18n;
