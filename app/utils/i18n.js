import React from "react";
const r = require.context('../../locales/', true, /\.json$/);
const keys = r.keys();
const localeStrings = keys.map(k => k.replace('./', '').replace('.json', ''));
const jsons = keys.map(r);
const translations = keys.reduce((acc, key, i) => {
  acc[localeStrings[i]] = jsons[i];
  return acc;
}, {});

export const I18nContext = React.createContext({
  t: function() {},
});

export default translations;

export const languageDropdownItems = [
  { label: 'English (US)', value: 'en-US' },
  { label: 'Français (FR)', value: 'fr-FR' },
  { label: 'Español (ES)', value: 'es-ES' },
  { label: 'Català (CAT)', value: 'ca' },
  { label: '简体中文', value: 'zh-CN' },
  { label: 'Custom JSON', value: 'custom' },
];

// Predefined choices are shared by Settings and the logged-out header.
export const predefinedLanguageItems = languageDropdownItems.filter(item => item.value !== 'custom');
export function normalizeLocale(locale) {
  if (predefinedLanguageItems.some(item => item.value === locale)) return locale;
  if (locale === 'en' || /^en-/i.test(locale || '')) return 'en-US';
  return 'en-US';
}
