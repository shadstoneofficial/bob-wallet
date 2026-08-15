const dnssec = require('bns/lib/dnssec');
const util = require('bns/lib/util');
const {keyFlags, types} = require('bns/lib/constants');

function exactRecords(message, name, type) {
  if (!message || !Array.isArray(message.answer)) return [];

  const owner = util.fqdn(name);
  return message.answer.filter(record => (
    record.type === type && util.equal(record.name, owner)
  ));
}

function zoneKeys(message, signerName) {
  const keys = new Map();

  for (const record of exactRecords(message, signerName, types.DNSKEY)) {
    const {flags, protocol} = record.data;

    if (!(flags & keyFlags.ZONE)
        || flags & keyFlags.REVOKE
        || protocol !== 3) {
      continue;
    }

    keys.set(record.data.keyTag(), record);
  }

  return keys;
}

/**
 * Validate a signed child-zone RRset when HSD/BNS returned it without AD.
 *
 * The fallback is deliberately anchored to a parent DS response which the
 * recursive resolver did authenticate. It never treats a bare RRSIG as trust.
 */
async function validateDelegatedRRSet(message, name, type, resolveRaw) {
  const owner = util.fqdn(name);
  const rrset = exactRecords(message, owner, type);
  const signatures = exactRecords(message, owner, types.RRSIG)
    .filter(record => record.data.typeCovered === type);

  if (rrset.length === 0 || signatures.length === 0) return null;

  const signers = new Map();
  for (const signature of signatures) {
    const signerName = util.fqdn(signature.data.signerName);
    signers.set(signerName.toLowerCase(), signerName);
  }

  if (signers.size !== 1) return null;

  const signerName = [...signers.values()][0];
  if (!util.isSubdomain(signerName, owner)) return null;

  const dsMessage = await resolveRaw(signerName, types.DS);
  if (!dsMessage || !dsMessage.ad) return null;

  const dsRecords = exactRecords(dsMessage, signerName, types.DS);
  if (dsRecords.length === 0) return null;

  const keyMessage = await resolveRaw(signerName, types.DNSKEY);
  const authenticatedKSKs = dnssec.verifyDS(
    keyMessage,
    dsRecords,
    signerName,
  );

  if (!(authenticatedKSKs instanceof Map) || authenticatedKSKs.size === 0) {
    return null;
  }

  if (!dnssec.verifyZSK(keyMessage, authenticatedKSKs, signerName)) {
    return null;
  }

  const keys = zoneKeys(keyMessage, signerName);
  if (keys.size === 0) return null;

  for (const signature of signatures) {
    const key = keys.get(signature.data.keyTag);
    if (!key || !signature.data.validityPeriod()) continue;

    if (dnssec.verify(signature, key, rrset)) return rrset;
  }

  return null;
}

export async function collectSecureRecords(
  message,
  name,
  type,
  resolveRaw,
) {
  if (message && message.ad) return message.collect(name, type);

  try {
    return await validateDelegatedRRSet(message, name, type, resolveRaw);
  } catch (error) {
    return null;
  }
}

export {exactRecords, validateDelegatedRRSet};
