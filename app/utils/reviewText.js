import english from '../../locales/en.json';

// Pass values only after translating the template: replacement strings and any
// %s inside external data must remain literal, never become another placeholder.
export function reviewText(t, key, ...values) {
  const translated = t && t(key);
  const template = translated && translated !== key && translated !== `this.context.t(${key})`
    ? translated : english[key] || key;
  let index = 0;
  return template.replace(/%s/g, () => index < values.length ? String(values[index++]) : '%s');
}

export function reviewDate(value, locale) {
  const date = new Date(value);
  try {
    return date.toLocaleString(locale === 'custom' ? undefined : locale);
  } catch (error) {
    return date.toLocaleString('en');
  }
}
