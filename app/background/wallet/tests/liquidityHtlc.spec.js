const test = require('tape');
const crypto = require('crypto');
const sha256 = require('bcrypto/lib/sha256');
const KeyRing = require('hsd/lib/primitives/keyring');
const {Coin} = require('hsd/lib/primitives');
const {
  buildHnsHtlcScript,
  buildHnsHtlcSpend,
  getHnsHtlcAddress,
} = require('../liquidityHtlc');

function makeFixture() {
  const claimKey = KeyRing.generate();
  const refundKey = KeyRing.generate();
  const secret = Buffer.from(crypto.randomBytes(32));
  const secretHash = sha256.digest(secret).toString('hex');
  const refundLocktime = 144;
  const htlc = getHnsHtlcAddress({
    secretHash,
    claimPublicKey: claimKey.publicKey.toString('hex'),
    refundPublicKey: refundKey.publicKey.toString('hex'),
    refundLocktime,
  }, 'regtest');
  const coin = new Coin({
    hash: Buffer.from(crypto.randomBytes(32)),
    index: 0,
    value: 1000000,
    address: htlc.address,
  });

  return {
    claimKey,
    refundKey,
    secret,
    secretHash,
    refundLocktime,
    htlc,
    coin,
  };
}

test('Liquidity HNS HTLC script creates a regtest P2WSH address', t => {
  const {htlc} = makeFixture();

  t.equal(htlc.address.hash.length, 32);
  t.equal(htlc.address.version, 0);
  t.ok(htlc.addressString.startsWith('rs1'), 'uses regtest address prefix');
  t.ok(htlc.script.getSize() > 0, 'script compiles');
  t.end();
});

test('Liquidity HNS HTLC claim path spends with the revealed secret', t => {
  const {
    claimKey,
    refundKey,
    secret,
    secretHash,
    refundLocktime,
    coin,
  } = makeFixture();
  const destination = claimKey.getAddress().toString('regtest');
  const spend = buildHnsHtlcSpend({
    coin,
    destinationAddress: destination,
    network: 'regtest',
    privateKey: claimKey.privateKey,
    feeDollary: 1000,
    path: 'claim',
    secret: secret.toString('hex'),
    secretHash,
    claimPublicKey: claimKey.publicKey.toString('hex'),
    refundPublicKey: refundKey.publicKey.toString('hex'),
    refundLocktime,
  });

  t.ok(spend.mtx.verify(), 'claim spend verifies');
  t.equal(spend.mtx.outputs[0].value, 999000, 'fee is subtracted from output');
  t.end();
});

test('Liquidity HNS HTLC refund path spends after locktime', t => {
  const {
    claimKey,
    refundKey,
    secretHash,
    refundLocktime,
    coin,
  } = makeFixture();
  const destination = refundKey.getAddress().toString('regtest');
  const spend = buildHnsHtlcSpend({
    coin,
    destinationAddress: destination,
    network: 'regtest',
    privateKey: refundKey.privateKey,
    feeDollary: 1000,
    path: 'refund',
    secretHash,
    claimPublicKey: claimKey.publicKey.toString('hex'),
    refundPublicKey: refundKey.publicKey.toString('hex'),
    refundLocktime,
  });

  t.equal(spend.mtx.locktime, refundLocktime);
  t.equal(spend.mtx.inputs[0].sequence, 0xfffffffe);
  t.ok(spend.mtx.verify(), 'refund spend verifies');
  t.end();
});

test('Liquidity HNS HTLC rejects a wrong claim secret', t => {
  const {
    claimKey,
    refundKey,
    secretHash,
    refundLocktime,
    coin,
  } = makeFixture();

  t.throws(() => buildHnsHtlcSpend({
    coin,
    destinationAddress: claimKey.getAddress().toString('regtest'),
    network: 'regtest',
    privateKey: claimKey.privateKey,
    path: 'claim',
    secret: Buffer.from(crypto.randomBytes(32)).toString('hex'),
    secretHash,
    claimPublicKey: claimKey.publicKey.toString('hex'),
    refundPublicKey: refundKey.publicKey.toString('hex'),
    refundLocktime,
  }), /secret does not match secretHash/);
  t.end();
});

test('Liquidity HNS HTLC script is deterministic', t => {
  const {claimKey, refundKey, secretHash, refundLocktime} = makeFixture();
  const options = {
    secretHash,
    claimPublicKey: claimKey.publicKey.toString('hex'),
    refundPublicKey: refundKey.publicKey.toString('hex'),
    refundLocktime,
  };
  const a = buildHnsHtlcScript(options).encode().toString('hex');
  const b = buildHnsHtlcScript(options).encode().toString('hex');

  t.equal(a, b);
  t.end();
});
