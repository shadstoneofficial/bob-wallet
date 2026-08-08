function fail(name, message) {
  throw new Error(`Cannot safely register ${name}/: ${message}`);
}

function isUint32(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/**
 * Validate the consensus-critical subset of HSD getnameinfo used to build a
 * REGISTER transaction. Amounts are integer dollary, exactly as returned by
 * HSD; callers must not convert or reinterpret them.
 */
export function getRegisterAuthority(name, expectedNameHash, result) {
  if (!result || typeof result !== 'object' || !result.info)
    fail(name, 'the configured SPV helper returned no current name state.');

  const {info} = result;

  if (info.name !== name)
    fail(name, 'the configured SPV helper returned a different name.');

  if (info.nameHash !== expectedNameHash)
    fail(name, 'the configured SPV helper returned a different name hash.');

  if (info.state !== 'CLOSED')
    fail(name, `the auction state is ${info.state || 'unknown'}, not CLOSED.`);

  if (info.registered !== false)
    fail(name, 'the configured SPV helper does not report an unregistered auction win.');

  if (!isUint32(info.height))
    fail(name, 'the configured SPV helper returned an invalid auction height.');

  if (!Number.isSafeInteger(info.value) || info.value < 0)
    fail(name, 'the configured SPV helper returned an invalid auction value.');

  const {owner} = info;
  if (!owner
      || typeof owner.hash !== 'string'
      || !/^[0-9a-f]{64}$/i.test(owner.hash)
      || !isUint32(owner.index)) {
    fail(name, 'the configured SPV helper returned an invalid winning outpoint.');
  }

  return {
    height: info.height,
    nameHash: info.nameHash.toLowerCase(),
    owner: {
      hash: owner.hash.toLowerCase(),
      index: owner.index,
    },
    value: info.value,
  };
}

/**
 * Confirm that Bob's locally created REGISTER spends and describes the same
 * auction win as the configured helper, then replace only the value before
 * wallet funding and signing.
 */
export function applyRegisterAuthority(name, mtx, outputIndex, authority) {
  const output = mtx?.outputs?.[outputIndex];
  const input = mtx?.inputs?.[outputIndex];

  if (!output || !input || !input.prevout)
    fail(name, 'the local wallet created an incomplete REGISTER transaction.');

  const localOwnerHash = input.prevout.hash?.toString('hex');
  if (localOwnerHash !== authority.owner.hash
      || input.prevout.index !== authority.owner.index) {
    fail(name, 'the local wallet and configured SPV helper disagree about the auction winner.');
  }

  let localHeight;
  try {
    localHeight = output.covenant.getU32(1);
  } catch (e) {
    fail(name, 'the local wallet created an invalid REGISTER auction height.');
  }

  if (localHeight !== authority.height)
    fail(name, 'the local wallet and configured SPV helper disagree about the auction height.');

  output.value = authority.value;
  return output;
}
