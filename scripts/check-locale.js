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
// Preserve machine-readable text, including the literal percent after %s.
const markers = value => String(value).match(/%s%?|\n|<[^>]+>|`+|\*\*/g) || [];
const urls = value => String(value).match(/https?:\/\/[^\s<>]+/g) || [];
const technicalTokens = value => String(value).match(/\b(?:HNS|Handshake|Bob|LearnHNS|HIP-2|HSD|hsd|hsd_data|hs-client|DNSSEC|DNS|TXT|TLSA|RPC|HTTP|API|JSON|SPV|OPEN|BID|BIDDING|OPENING|Shakedex|ShakeX|GFAVIP|Gems|P2P|Bitcoin|Electrum|SLD|TLD|Ledger|ledger|ICANN|TLDs|SSH|PGP|WOT|RSA|GooSig|goosig|GitHub|Github|WalletDB|walletdb|xpriv|xprv|xpub|xPub|nonce|nonces|Urkel|DB|OS|QR|TX|CSV|USD|ID)\b/g) || [];
const domains = value => String(value).match(/\b(?:shakex\.fun|hns\.bio|liquidity\.spot)\b/g) || [];
const sameTokens = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
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

const valueErrors = englishKeys.filter(key => typeof locale[key] !== 'string' || !locale[key].trim());
const tokenErrors = englishKeys.filter(key => (
  typeof locale[key] === 'string' && (
    !sameTokens(markers(english[key]), markers(locale[key]))
    || !sameTokens(urls(english[key]), urls(locale[key]))
    || !sameTokens(domains(english[key]), domains(locale[key]))
    || !sameTokens(technicalTokens(english[key]), technicalTokens(locale[key]))
  )
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

if (valueErrors.length) console.error(`Missing/empty/non-string values: ${valueErrors.join(', ')}`);
if (tokenErrors.length) console.error(`URL, technical token, or formatting marker mismatch: ${tokenErrors.join(', ')}`);
if (missing.length || extra.length || placeholderErrors.length || valueErrors.length || tokenErrors.length) process.exit(1);

console.log('Locale structure, placeholders, URLs, technical tokens, and formatting markers are valid.');
