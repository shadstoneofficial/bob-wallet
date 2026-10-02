// Run: node app/addons/shakex/client.spec.cjs
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const assert = require('node:assert/strict');
const {parseListings, fetchListings} = require('./client');
(async () => {
  assert.throws(() => parseListings({}), /invalid/);
  assert.deepEqual(parseListings({listings: []}), []);
  const rows = parseListings({listings: [null, {name: '<script>'}, {
    name: 'example', prices: [{unit: 'HNS', amount: '5000'}, {unit: 'HNS', amount: '-1'}, {unit: 'FAKE', amount: '10'}],
    contacts: [{type: 'text', value: 'X @alice\u202e'}, {type: 'uri', value: '<script>alert(1)</script>'}], verifiedAt: 'invalid',
  }, {name: 'example'}, {name: 'xn--ls8h'}]});
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].prices, [{unit: 'HNS', amount: '5000'}]);
  assert.equal(rows[0].contacts[0], 'X @alice');
  assert.equal(rows[0].verifiedAt, null);
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://shakex.fun/api/listings');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return {ok: true, text: async () => JSON.stringify({listings: [{name: 'test'}]})};
  };
  assert.equal((await fetchListings())[0].name, 'test');
  global.fetch = async () => ({ok: false, status: 429});
  await assert.rejects(fetchListings(), /rate limiting/);
  global.fetch = async () => ({ok: true, text: async () => 'x'.repeat(2 * 1024 * 1024 + 1)});
  await assert.rejects(fetchListings(), /too much data/);
  console.log('ShakeX client checks passed (validation, precision, deduplication, request policy and failures).');
})().catch(error => {console.error(error); process.exitCode = 1;});
