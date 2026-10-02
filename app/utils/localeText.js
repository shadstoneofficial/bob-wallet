import english from '../../locales/en.json';

// Non-React helpers use the English source when no UI translator is supplied.
export function translateEnglish(key, ...values) {
  let text = english[key] || key;
  for (const value of values) text = text.replace('%s', value);
  return text;
}
