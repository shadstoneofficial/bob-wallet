import test from 'tape';
import {Resource} from 'hsd/lib/dns/resource';
import {
  MAX_ACTIVATE_PROPOSAL_BYTES,
  assertCanonicalStillCurrent,
  parseActivateProposal,
} from '../activateProposal';

const addresses = require('./fixtures/activate-proposal-v1-addresses.json');
const hnsbio = require('./fixtures/activate-proposal-v1-hnsbio.json');

const copy = value => JSON.parse(JSON.stringify(value));
const text = value => JSON.stringify(value);
const options = (currentResourceHex = '00') => ({
  expectedName: 'example',
  expectedNetwork: 'main',
  currentResourceHex,
});

test('imports valid SYNTH4 and SYNTH6 operations into a complete staged resource', t => {
  const review = parseActivateProposal(text(addresses), options());
  t.deepEqual(review.beforeResource, {records: []});
  t.deepEqual(review.afterResource.records, [
    {type: 'SYNTH4', address: '203.0.113.8'},
    {type: 'SYNTH6', address: '2001:db8::8'},
  ]);
  t.notEqual(review.resultingResourceHex, '00');
  t.end();
});

test('imports valid hns.bio TXT operations', t => {
  const review = parseActivateProposal(text(hnsbio), options());
  t.deepEqual(review.afterResource.records, [
    {type: 'TXT', txt: ['name:Example Name']},
    {type: 'TXT', txt: ['bio:Building useful names']},
  ]);
  t.end();
});

test('preserves unrelated and unknown-to-the-proposal records', t => {
  const current = Resource.fromJSON({records: [
    {type: 'NS', ns: 'ns1.example.'},
    {type: 'TXT', txt: ['custom-record:keep']},
    {type: 'TXT', txt: ['name:Old Name']},
    {type: 'SYNTH6', address: '2001:db8::7'},
  ]}).encode().toString('hex');
  const proposal = copy(hnsbio);
  proposal.canonicalResource.value = current;
  proposal.operations = [{op: 'upsert-hnsbio-txt', key: 'name', value: 'New Name'}];

  const review = parseActivateProposal(text(proposal), options(current));
  t.ok(review.afterResource.records.some(record => record.type === 'NS'));
  t.ok(review.afterResource.records.some(record => record.type === 'TXT' && record.txt[0] === 'custom-record:keep'));
  t.ok(review.afterResource.records.some(record => record.type === 'SYNTH6'));
  t.notOk(review.afterResource.records.some(record => record.type === 'TXT' && record.txt[0] === 'name:Old Name'));
  t.ok(review.afterResource.records.some(record => record.type === 'TXT' && record.txt[0] === 'name:New Name'));
  t.end();
});

test('rejects stale canonical state at import and again before submit', t => {
  const current = Resource.fromJSON({records: [{type: 'TXT', txt: ['custom:changed']}]}).encode().toString('hex');
  t.throws(() => parseActivateProposal(text(addresses), options(current)), /canonical resource changed after export/);
  const review = parseActivateProposal(text(addresses), options());
  t.throws(() => assertCanonicalStillCurrent(review, current), /changed since import/);
  t.equal(assertCanonicalStillCurrent(review, '00'), true);
  t.end();
});

test('rejects wrong names, networks, and publishing layers', t => {
  t.throws(() => parseActivateProposal(text(addresses), {...options(), expectedName: 'other'}), /target name/);
  t.throws(() => parseActivateProposal(text(addresses), {...options(), expectedNetwork: 'testnet'}), /target network/);
  const dotted = copy(addresses);
  dotted.target.name = 'www.example';
  dotted.target.publishingLayer = 'authoritative-zone';
  dotted.canonicalResource = null;
  dotted.operations = [{op: 'set-address', recordType: 'A', value: '203.0.113.8'}];
  t.throws(() => parseActivateProposal(text(dotted), {...options(), expectedName: 'www.example'}), /only imports handshake-onchain/);
  t.end();
});

test('rejects malformed, oversized, and schema-expanding files', t => {
  t.throws(() => parseActivateProposal('{broken', options()), /not valid JSON/);
  t.throws(() => parseActivateProposal(' '.repeat(MAX_ACTIVATE_PROPOSAL_BYTES + 1), options()), /65536 bytes/);
  const expanded = copy(addresses);
  expanded.automaticPublish = true;
  t.throws(() => parseActivateProposal(text(expanded), options()), /schema validation failed/);
  t.end();
});

test('rejects future versions, unsupported operations, and duplicates', t => {
  const future = copy(addresses);
  future.version = 2;
  t.throws(() => parseActivateProposal(text(future), options()), /unsupported version 2/);

  const zoneRecord = copy(addresses);
  zoneRecord.operations[0].recordType = 'A';
  zoneRecord.operations.splice(1);
  t.throws(() => parseActivateProposal(text(zoneRecord), options()), /not valid in an on-chain Bob resource/);

  const duplicate = copy(addresses);
  duplicate.operations[1] = copy(duplicate.operations[0]);
  t.throws(() => parseActivateProposal(text(duplicate), options()), /duplicate SYNTH4/);
  t.end();
});

test('rejects a merged resource above the Handshake 512-byte limit', t => {
  const proposal = copy(hnsbio);
  proposal.operations = ['name', 'bio', 'pfp'].map(key => ({
    op: 'upsert-hnsbio-txt',
    key,
    value: 'x'.repeat(240),
  }));
  t.throws(() => parseActivateProposal(text(proposal), options()), /Handshake permits at most 512/);
  t.end();
});
