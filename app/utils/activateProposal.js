import {IP} from 'binet';
import {Resource} from 'hsd/lib/dns/resource';

const schema = require('../schemas/activate-proposal-v1.schema.json');
const jsonSchemaValidate = require('jsonschema').validate;

export const MAX_ACTIVATE_PROPOSAL_BYTES = 64 * 1024;
export const MAX_RESOURCE_BYTES = 512;

function fail(message) {
  throw new Error(`LearnHNS proposal rejected: ${message}`);
}

function decodeCanonicalResource(rawHex) {
  const value = String(rawHex || '').toLowerCase();
  if (!/^(?:[0-9a-f]{2})+$/.test(value) || value.length > MAX_RESOURCE_BYTES * 2) {
    fail('Bob could not obtain a valid canonical Handshake resource.');
  }

  try {
    const resource = Resource.decode(Buffer.from(value, 'hex'));
    if (resource.encode().toString('hex') !== value) {
      fail('the canonical resource contains unsupported or trailing wire data.');
    }
    return {value, json: resource.toJSON()};
  } catch (error) {
    if (/^LearnHNS proposal rejected:/.test(error.message)) throw error;
    fail(`Bob could not decode the canonical Handshake resource (${error.message}).`);
  }
}

function assertTarget(proposal, expectedName, expectedNetwork) {
  const target = proposal.target;
  if (target.name !== expectedName) fail(`target name ${target.name}/ does not match the open name ${expectedName}/.`);
  if (target.network !== expectedNetwork) fail(`target network ${target.network} does not match Bob's ${expectedNetwork} network.`);
  if (target.publishingLayer !== 'handshake-onchain') {
    fail('Bob only imports handshake-onchain proposals; dotted authoritative-zone proposals belong in their DNS manager.');
  }
  if (target.name.includes('.')) fail('Bob only imports one-label Handshake TLD names.');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(target.name)) fail('target name is not a canonical one-label Handshake name.');
}

function validateOperation(operation, seen) {
  if (operation.op === 'set-address') {
    if (!['SYNTH4', 'SYNTH6'].includes(operation.recordType)) {
      fail(`record type ${operation.recordType} is not valid in an on-chain Bob resource.`);
    }
    const valid = operation.recordType === 'SYNTH4'
      ? IP.isIPv4String(operation.value)
      : IP.isIPv6String(operation.value);
    if (!valid) fail(`${operation.recordType} has an invalid IP address.`);
    const identity = `address:${operation.recordType}`;
    if (seen.has(identity)) fail(`duplicate ${operation.recordType} operation.`);
    seen.add(identity);
    return;
  }

  if (operation.op === 'upsert-hnsbio-txt') {
    const identity = `hnsbio:${operation.key}`;
    if (seen.has(identity)) fail(`duplicate hns.bio ${operation.key} operation.`);
    seen.add(identity);
    if (/[\u0000-\u001f\u007f]/.test(operation.value)) fail(`hns.bio ${operation.key} contains control characters.`);
    if (Buffer.byteLength(`${operation.key}:${operation.value}`, 'utf8') > 255) {
      fail(`hns.bio ${operation.key} exceeds one 255-byte Handshake TXT entry.`);
    }
    return;
  }

  fail(`unsupported operation ${operation.op}.`);
}

function applyOperations(beforeResource, operations) {
  let records = JSON.parse(JSON.stringify(beforeResource.records || []));
  const changes = [];

  for (const operation of operations) {
    if (operation.op === 'set-address') {
      const removed = records.filter((record) => record.type === operation.recordType);
      records = records.filter((record) => record.type !== operation.recordType);
      const added = {type: operation.recordType, address: IP.normalize(operation.value)};
      records.push(added);
      changes.push({operation, before: removed, after: [added]});
      continue;
    }

    const matcher = new RegExp(`^${operation.key}\\s*[:=]`, 'i');
    const removed = records.filter((record) => record.type === 'TXT' && matcher.test((record.txt || []).join('')));
    records = records.filter((record) => record.type !== 'TXT' || !matcher.test((record.txt || []).join('')));
    const added = {type: 'TXT', txt: [`${operation.key}:${operation.value}`]};
    records.push(added);
    changes.push({operation, before: removed, after: [added]});
  }

  return {records, changes};
}

export function parseActivateProposal(input, {
  expectedName,
  expectedNetwork,
  currentResourceHex,
}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_ACTIVATE_PROPOSAL_BYTES) {
    fail(`file must be between 1 byte and ${MAX_ACTIVATE_PROPOSAL_BYTES} bytes.`);
  }

  let proposal;
  try {
    proposal = JSON.parse(text);
  } catch {
    fail('file is not valid JSON.');
  }

  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) fail('top level must be an object.');
  if (proposal.kind !== 'activate-proposal') fail('file is not an activate-proposal.');
  if (proposal.version !== 1) fail(`unsupported version ${String(proposal.version)}; this Bob build supports version 1.`);

  const validation = jsonSchemaValidate(proposal, schema);
  if (validation.errors.length) {
    fail(`schema validation failed (${validation.errors[0].stack}).`);
  }

  assertTarget(proposal, expectedName, expectedNetwork);
  const canonical = decodeCanonicalResource(currentResourceHex);
  if (proposal.canonicalResource.value !== canonical.value) {
    fail('canonical resource changed after export; inspect the name again and create a fresh proposal.');
  }

  const seen = new Set();
  proposal.operations.forEach((operation) => validateOperation(operation, seen));
  const {records, changes} = applyOperations(canonical.json, proposal.operations);

  let finalResource;
  let encoded;
  try {
    finalResource = Resource.fromJSON({records});
    const size = finalResource.getSize(new Map());
    if (size > MAX_RESOURCE_BYTES) {
      fail(`resulting resource is ${size} bytes; Handshake permits at most ${MAX_RESOURCE_BYTES}.`);
    }
    encoded = finalResource.encode();
  } catch (error) {
    if (/^LearnHNS proposal rejected:/.test(error.message)) throw error;
    fail(`resulting resource is invalid (${error.message}).`);
  }
  if (encoded.length > MAX_RESOURCE_BYTES) {
    fail(`resulting resource is ${encoded.length} bytes; Handshake permits at most ${MAX_RESOURCE_BYTES}.`);
  }

  return {
    proposal,
    canonicalResourceHex: canonical.value,
    resultingResourceHex: encoded.toString('hex'),
    beforeResource: canonical.json,
    afterResource: finalResource.toJSON(),
    changes,
  };
}

export function assertCanonicalStillCurrent(importReview, currentResourceHex) {
  const current = decodeCanonicalResource(currentResourceHex);
  if (!importReview || current.value !== importReview.canonicalResourceHex) {
    fail('canonical resource changed since import; discard this review and import a fresh proposal.');
  }
  return true;
}
