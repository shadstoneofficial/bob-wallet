import test from 'tape';
import {secureRandomHex} from '../secureRandom';

test('secure random hex requests bytes from Web Crypto and preserves exact key width', t => {
  let calls = 0;
  const provider = {
    getRandomValues(bytes) {
      calls++;
      t.ok(bytes instanceof Uint8Array, 'Web Crypto receives a byte array');
      t.equal(bytes.byteLength, 20, 'API key requests exactly 20 random bytes');
      bytes.set(Array.from({length: bytes.length}, (_, index) => index));
      return bytes;
    },
  };

  const key = secureRandomHex(20, provider);
  t.equal(calls, 1, 'uses Web Crypto exactly once');
  t.equal(key, '000102030405060708090a0b0c0d0e0f10111213');
  t.equal(key.length, 40, 'API key remains 40 lowercase hex characters');
  t.end();
});

test('secure random hex rejects invalid sizes and providers without fallback', t => {
  for (const length of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    t.throws(() => secureRandomHex(length, {getRandomValues() {}}), RangeError);
  }
  t.throws(() => secureRandomHex(20, null), /secure random provider/);
  t.throws(() => secureRandomHex(20, {getRandomValues: true}), /secure random provider/);
  t.end();
});
