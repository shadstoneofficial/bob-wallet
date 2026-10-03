process.env.NODE_BACKEND = 'js';
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const assert = require('node:assert/strict');
const punycode = require('punycode/');
const {displayName, matchesName} = require('../displayName');
const {parseListings} = require('../client');
for (const [ascii, unicode] of [['xn--k77hya', '🇬🇸'], ['xn--ep8h', '🐹'], ['xn--ev9h', '🧔']]) {
  assert.equal(displayName(ascii), unicode);
  assert(matchesName(ascii, unicode));
  assert(matchesName(ascii, ascii.toUpperCase()));
  const original = {name: ascii, prices: [], contacts: []};
  const parsed = parseListings({listings: [original]})[0];
  displayName(parsed.name);
  assert.equal(parsed.name, ascii, 'canonical/action identity remains unchanged');
  assert.equal(original.name, ascii, 'source feed is not mutated');
}
for (const value of ['example', 'hello-world', 'xn--', 'xn--abc-', 'xn--a', 'xn--9999999999999999999999999999', 'XN--EP8H', '-xn--ep8h']) {
  assert.equal(displayName(value), value);
}
for (const unicode of ['a\u202Eb', 'a\u2066b', 'a\u061Cb', 'a\u0000b', 'a\u007fb', 'a\u00adb', 'a\u200bb', 'a\ud800b', 'a\ue000b', '\u0301a', 'a b', '👩\u200d💻']) {
  const ascii = punycode.toASCII(unicode);
  assert.equal(displayName(ascii), ascii, 'display hazards/joiners use ASCII fallback');
}
for (const unicode of ['café', '中文', 'שלוםabc', '❤️', '🐹'.repeat(40)]) {
  const ascii = punycode.toASCII(unicode);
  assert.equal(displayName(ascii), unicode);
  assert(matchesName(ascii, unicode));
}
assert(matchesName('example', 'AMP'));
assert(!matchesName('xn--ep8h', '🧔'));
console.log('ShakeX Unicode checks passed: emoji, canonical round trip, malformed ACE, controls/bidi, search and identity preservation.');
