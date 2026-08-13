import punycode from 'punycode';

import isValidAddress from '../../utils/verifyAddress';

const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

export function aliasError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function normalizeHostname(input) {
  if (typeof input !== 'string') {
    throw aliasError('invalid alias', 'EINVALIDALIAS');
  }

  let hostname = input.trim();

  if (hostname.startsWith('@')) {
    hostname = hostname.slice(1);
  }

  if (hostname.endsWith('.')) {
    hostname = hostname.slice(0, -1);
  }

  if (!hostname
      || hostname.includes('@')
      || /[\s/:?#\\]/.test(hostname)) {
    throw aliasError('invalid alias', 'EINVALIDALIAS');
  }

  try {
    hostname = punycode.toASCII(hostname).toLowerCase();
  } catch (error) {
    throw aliasError('invalid alias', 'EINVALIDALIAS');
  }

  if (!hostname || hostname.length > MAX_HOSTNAME_LENGTH) {
    throw aliasError('invalid alias', 'EINVALIDALIAS');
  }

  for (const label of hostname.split('.')) {
    if (!label
        || label.length > MAX_LABEL_LENGTH
        || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      throw aliasError('invalid alias', 'EINVALIDALIAS');
    }
  }

  return hostname;
}

export function parseHNSAddressTXT(records, network) {
  const valid = new Set();
  let recognized = false;
  let invalid = false;

  for (const record of records) {
    const match = /^hns[:=](.*)$/.exec(record);
    if (!match) continue;

    recognized = true;
    const address = match[1].trim();

    if (!isValidAddress(address, network)) {
      invalid = true;
      continue;
    }

    valid.add(address);
  }

  if (valid.size > 1) {
    throw aliasError('ambiguous HNS TXT records', 'ECOLLISION');
  }

  if (invalid) {
    throw aliasError('invalid address in HNS TXT record', 'EINVALID');
  }

  if (valid.size === 1) {
    return [...valid][0];
  }

  if (recognized) {
    throw aliasError('invalid address in HNS TXT record', 'EINVALID');
  }

  throw aliasError('HNS TXT record not found', 'ETXTNOTFOUND');
}

export function shouldFallbackToTXT(error) {
  return new Set([
    'ETLSANOTFOUND',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENODATA',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEOUT',
    'ETIMEDOUT',
    404,
  ]).has(error && error.code);
}

export function selectAliasError(hip2Error, txtError) {
  const connectionErrors = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEOUT',
    'ETIMEDOUT',
  ]);

  // A missing optional TXT fallback should not hide the more useful reason
  // that the primary HIP-2 request could not reach its host.
  if (txtError && txtError.code === 'ETXTNOTFOUND'
      && connectionErrors.has(hip2Error && hip2Error.code)) {
    return hip2Error;
  }

  return txtError;
}
