const assert = require('bsert');
const sha256 = require('bcrypto/lib/sha256');
const {Address, Coin, MTX, Output} = require('hsd/lib/primitives');
const Script = require('hsd/lib/script/script');
const {opcodes} = require('hsd/lib/script/common');

const ZERO = Buffer.alloc(0);

function ensureHex(name, value, length) {
  assert(typeof value === 'string', `${name} is required.`);
  assert(/^[0-9a-f]+$/i.test(value), `${name} must be hex.`);
  if (length)
    assert(value.length === length * 2, `${name} must be ${length} bytes.`);
  return Buffer.from(value, 'hex');
}

function ensurePublicKey(name, value) {
  const key = ensureHex(name, value);
  assert(key.length === 33 || key.length === 65, `${name} must be a compressed or uncompressed public key.`);
  return key;
}

function ensureLocktime(value) {
  assert(Number.isSafeInteger(value) && value >= 0, 'refundLocktime must be a non-negative integer.');
  return value;
}

function ensureValue(value, name = 'value') {
  assert(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer.`);
  return value;
}

function ensureNonNegativeValue(value, name = 'value') {
  assert(Number.isSafeInteger(value) && value >= 0, `${name} must be a non-negative integer.`);
  return value;
}

function hnsToDollary(value) {
  const numeric = Number(value);
  assert(Number.isFinite(numeric) && numeric > 0, 'amountHns must be a positive number.');
  return Math.round(numeric * 1e6);
}

function buildHnsHtlcScript(options) {
  const secretHash = ensureHex('secretHash', options.secretHash, 32);
  const claimPublicKey = ensurePublicKey('claimPublicKey', options.claimPublicKey);
  const refundPublicKey = ensurePublicKey('refundPublicKey', options.refundPublicKey);
  const refundLocktime = ensureLocktime(options.refundLocktime);

  const script = new Script();
  script.pushOp(opcodes.OP_IF);
  script.pushOp(opcodes.OP_SHA256);
  script.pushData(secretHash);
  script.pushOp(opcodes.OP_EQUALVERIFY);
  script.pushData(claimPublicKey);
  script.pushOp(opcodes.OP_CHECKSIG);
  script.pushOp(opcodes.OP_ELSE);
  script.pushInt(refundLocktime);
  script.pushOp(opcodes.OP_CHECKLOCKTIMEVERIFY);
  script.pushOp(opcodes.OP_DROP);
  script.pushData(refundPublicKey);
  script.pushOp(opcodes.OP_CHECKSIG);
  script.pushOp(opcodes.OP_ENDIF);
  script.compile();

  return script;
}

function getHnsHtlcAddress(options, network) {
  const script = buildHnsHtlcScript(options);
  const address = Address.fromScripthash(script.sha3());
  return {
    script,
    address,
    addressString: address.toString(network),
    scriptHex: script.encode().toString('hex'),
  };
}

function createHnsHtlcOutput(options, network) {
  const value = options.amountDollary != null
    ? ensureValue(options.amountDollary, 'amountDollary')
    : hnsToDollary(options.amountHns);
  const {script, address, addressString, scriptHex} = getHnsHtlcAddress(options, network);
  const output = new Output();
  output.value = value;
  output.address = address;

  return {
    output,
    script,
    address,
    addressString,
    scriptHex,
    value,
  };
}

function coinFromJSON(json, network) {
  const coin = new Coin();
  coin.fromJSON(json, network);
  return coin;
}

function buildHnsHtlcSpend(options) {
  const {
    coin,
    destinationAddress,
    network,
    privateKey,
    feeDollary = 0,
    path,
  } = options;
  const script = options.script || buildHnsHtlcScript(options);
  const spendCoin = coin instanceof Coin ? coin : coinFromJSON(coin, network);
  const value = spendCoin.value - ensureNonNegativeValue(feeDollary, 'feeDollary');

  assert(value > 0, 'HTLC coin value must be greater than the fee.');
  assert(path === 'claim' || path === 'refund', 'path must be claim or refund.');

  const mtx = new MTX();
  mtx.addCoin(spendCoin);
  mtx.outputs.push(Output.fromOptions({
    value,
    address: Address.fromString(destinationAddress, network),
  }));

  if (path === 'refund') {
    mtx.locktime = ensureLocktime(options.refundLocktime);
    mtx.inputs[0].sequence = 0xfffffffe;
  }

  const key = Buffer.isBuffer(privateKey)
    ? privateKey
    : ensureHex('privateKey', privateKey, 32);
  const signature = mtx.signature(0, script, spendCoin.value, key, Script.hashType.ALL);

  if (path === 'claim') {
    const secret = ensureHex('secret', options.secret);
    assert(sha256.digest(secret).equals(ensureHex('secretHash', options.secretHash, 32)), 'secret does not match secretHash.');
    mtx.inputs[0].witness.fromItems([
      signature,
      secret,
      Buffer.from([1]),
      script.encode(),
    ]);
  } else {
    mtx.inputs[0].witness.fromItems([
      signature,
      ZERO,
      script.encode(),
    ]);
  }

  return {
    mtx,
    txHex: mtx.toHex(),
    txid: mtx.txid(),
    scriptHex: script.encode().toString('hex'),
  };
}

module.exports = {
  buildHnsHtlcScript,
  buildHnsHtlcSpend,
  coinFromJSON,
  createHnsHtlcOutput,
  getHnsHtlcAddress,
};
