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
  { label: 'Русский', value: 'ru-RU' },
  { label: 'ไทย', value: 'th-TH' },
  { label: 'Custom JSON', value: 'custom' },
];

// Predefined choices are shared by Settings and the logged-out header.
export const predefinedLanguageItems = languageDropdownItems.filter(item => item.value !== 'custom');
export function normalizeLocale(locale) {
  if (predefinedLanguageItems.some(item => item.value === locale)) return locale;
  if (/^ru(?:-|$)/i.test(locale || '')) return 'ru-RU';
  if (/^th(?:-|$)/i.test(locale || '')) return 'th-TH';
  if (locale === 'en' || /^en-/i.test(locale || '')) return 'en-US';
  return 'en-US';
}

// Interpolate once, after fallback selection. External values may contain %s or $&.
export function translateLocale(locale, customLocale, key, ...values) {
  const language = locale === 'custom' ? 'custom' : normalizeLocale(locale);
  const selected = language === 'custom' ? (customLocale || {}) : (translations[language] || {});
  const root = translations[language.split('-')[0]] || {};
  const template = selected[key] || root[key] || translations.en[key] || `this.context.t(${key})`;
  let index = 0;
  return template.replace(/%s/g, () => index < values.length ? String(values[index++]) : '%s');
}
