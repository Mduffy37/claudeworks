import type common from './locales/en/common.json';
import type profile from './locales/en/profile.json';
import type team from './locales/en/team.json';
import type plugin from './locales/en/plugin.json';
import type marketplace from './locales/en/marketplace.json';
import type settings from './locales/en/settings.json';
import type scripts from './locales/en/scripts.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      profile: typeof profile;
      team: typeof team;
      plugin: typeof plugin;
      marketplace: typeof marketplace;
      settings: typeof settings;
      scripts: typeof scripts;
    };
  }
}
