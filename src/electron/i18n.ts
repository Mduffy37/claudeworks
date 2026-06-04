/**
 * i18n utilities for the Electron main process.
 *
 * Self-contained version that doesn't import from src/i18n/ (which is
 * outside the electron tsconfig's rootDir). Uses i18next-fs-backend to
 * load the same translation JSON files shared with the React frontend.
 */

import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

export function detectSystemLang(): string {
  const envLang = process.env.CLAUDEWORKS_LANG || process.env.LANG || process.env.LC_ALL || '';
  if (envLang.startsWith('zh')) return 'zh';
  return 'en';
}

let initialized = false;

export async function initNodeI18n(lang?: string): Promise<typeof i18next> {
  if (initialized) return i18next;

  await i18next.use(Backend).init({
    lng: lang || detectSystemLang(),
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'scripts', 'profile', 'team', 'plugin', 'settings'],
    backend: {
      // At runtime: dist/electron/i18n.js → ../../src/i18n/locales/…
      // In dev: src/electron/i18n.ts → ../i18n/locales/…
      loadPath: path.join(__dirname, '..', '..', 'src', 'i18n', 'locales', '{{lng}}', '{{ns}}.json'),
    },
    interpolation: { escapeValue: false },
  });

  initialized = true;
  return i18next;
}

export function changeNodeLang(lang: string): void {
  i18next.changeLanguage(lang);
}

export { i18next as i18n };
