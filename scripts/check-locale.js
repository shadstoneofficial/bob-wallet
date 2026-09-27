const fs = require('fs');
const path = require('path');

const localeName = process.argv[2];

if (!localeName) {
  console.error('Usage: npm run check-locale -- <locale>');
  process.exit(1);
}

const readLocale = name => {
  const filename = path.join(__dirname, '..', 'locales', `${name}.json`);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
};

const placeholders = value => String(value).match(/%s/g) || [];
const english = readLocale('en');
const locale = readLocale(localeName);
const englishKeys = Object.keys(english);
const localeKeys = Object.keys(locale);

const missing = englishKeys.filter(key => !Object.prototype.hasOwnProperty.call(locale, key));
const extra = localeKeys.filter(key => !Object.prototype.hasOwnProperty.call(english, key));
const unchanged = englishKeys.filter(key => locale[key] === english[key]);
const placeholderErrors = englishKeys.filter(key => (
  Object.prototype.hasOwnProperty.call(locale, key)
  && placeholders(locale[key]).length !== placeholders(english[key]).length
));

console.log(`Locale: ${localeName}`);
console.log(`English keys: ${englishKeys.length}`);
console.log(`Locale keys: ${localeKeys.length}`);
console.log(`Still matching English: ${unchanged.length}`);

if (missing.length) console.error(`Missing keys: ${missing.join(', ')}`);
if (extra.length) console.error(`Unexpected keys: ${extra.join(', ')}`);
if (placeholderErrors.length) {
  console.error(`Placeholder count differs from English: ${placeholderErrors.join(', ')}`);
}

if (missing.length || extra.length || placeholderErrors.length) process.exit(1);

console.log('Locale structure and placeholders are valid.');
