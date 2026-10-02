// Run: NODE_BACKEND=js node app/addons/shakex/records.spec.cjs
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const assert = require('node:assert/strict');
const {Resource} = require('hsd/lib/dns/resource');
const {buildSaleReview} = require('./records');
const {assertCanonicalStillCurrent} = require('../../utils/activateProposal');
const original = {records: [
 {type: 'NS', ns: 'ns1.example.'},
 {type: 'TXT', txt: ['x:alice']},
 {type: 'DS', keyTag: 1, algorithm: 13, digestType: 2, digest: 'ab'.repeat(32)},
 {type: 'TXT', txt: ['v=FORSALE1;fval=USD20']},
 {type: 'TXT', txt: ['v=FORSALE1;ftxt=old contact']},
]};
const hex = Resource.fromJSON(original).encode().toString('hex');
const review = buildSaleReview(hex, {price: '0.000001', contact: 'X @alice'});
assert.deepEqual(review.afterResource.records.slice(0, 3), Resource.fromJSON(original).toJSON().records.slice(0, 3));
assert.equal(review.afterResource.records[3].txt[0], 'v=FORSALE1;fval=HNS0.000001');
assert.equal(review.afterResource.records.length, 5);
assert.deepEqual(buildSaleReview(hex, {remove: true}).afterResource.records, review.afterResource.records.slice(0, 3));
assert.equal(buildSaleReview('00', {contact: 'X @alice'}).afterResource.records.length, 1);
assert.throws(() => buildSaleReview('00', {remove: true}), /no sale records/);
for (const price of ['-1', '0', 'NaN', '1e6', '1.0000001', '01']) assert.throws(() => buildSaleReview('00', {price, contact: 'X @alice'}), /positive HNS/);
assert.throws(() => buildSaleReview('00', {contact: '🔥'.repeat(70)}), /too long/);
assert.throws(() => buildSaleReview('00', {contact: 'a\u202eb'}), /control/);
const mixed = Resource.fromJSON({records: [{type: 'TXT', txt: ['v=FORSALE1;ftxt=x', 'x:keep']}]}).encode().toString('hex');
assert.throws(() => buildSaleReview(mixed, {remove: true}), /multiple strings/);
const large = Resource.fromJSON({records: [{type: 'TXT', txt: ['a'.repeat(240)]}, {type: 'TXT', txt: ['b'.repeat(240)]}]}).encode().toString('hex');
assert.throws(() => buildSaleReview(large, {price: '5000', contact: 'X @alice'}), /limit is 512/);
assert.throws(() => buildSaleReview('0000', {contact: 'X @alice'}), /unsupported/);
assertCanonicalStillCurrent(review, hex);
assert.throws(() => assertCanonicalStillCurrent(review, '00'), /changed/);
console.log('ShakeX record checks passed: preservation, replacement, delisting, exact prices, byte limits, ambiguous records and stale review rejection.');
