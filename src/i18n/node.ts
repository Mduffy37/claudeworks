import i18n from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

export function detectSystemLang(): string {
  const envLang = process.env.CLAUDEWORKS_LANG || process.env.LANG || process.env.LC_ALL || '';
  if (envLang.startsWith('zh')) return 'zh';
  return 'en';
}

let initialized = false;

export async function initNodeI18n(lang?: string): Promise<typeof i18n> {
  if (initialized) return i18n;

  await i18n.use(Backend).init({
    lng: lang || detectSystemLang(),
    fallbackLng: 'en',
    defaultNS: 'scripts',
    ns: ['common', 'scripts', 'profile', 'team', 'plugin', 'settings'],
    backend: {
      loadPath: path.join(__dirname, 'locales/{{lng}}/{{ns}}.json'),
    },
    interpolation: { escapeValue: false },
  });

  initialized = true;
  return i18n;
}

export function changeNodeLang(lang: string): void {
  i18n.changeLanguage(lang);
}

export { i18n };
