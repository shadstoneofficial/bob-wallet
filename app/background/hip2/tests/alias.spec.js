import test from 'tape';
import sinon from 'sinon';
import {EventEmitter} from 'events';

import {
  normalizeHostname,
  parseHNSAddressTXT,
  selectAliasError,
  shouldFallbackToTXT,
} from '../alias';
import {getAddress, getTXTAddress} from '../hip2';

const hdns = require('hdns');
const https = require('https');
const {codes, Message, Record, TXTRecord, types} = require('bns/lib/wire');

const MAIN_ADDRESS = 'hs1q5e06h2fcwx9sx38k6skzwkzmm54meudhphkytx';
const OTHER_MAIN_ADDRESS = 'hs1q0000000000000000000000000000000000000000';
const TESTNET_ADDRESS = 'ts1q8tlzrx9lq9an302cju5q6msjnr06564sd9fnj9';

function stubHTTPSResponse(body, statusCode = 200) {
  let requestedURL = '';
  const stub = sinon.stub(https, 'get').callsFake((url, options, callback) => {
    requestedURL = url;
    const request = new EventEmitter();
    request.destroyed = false;
    request.end = () => {};
    request.destroy = () => { request.destroyed = true; };

    const response = new EventEmitter();
    response.statusCode = statusCode;
    response.statusMessage = statusCode === 404 ? 'Not Found' : 'OK';
    response.setEncoding = () => {};
    response.socket = {
      getPeerCertificate: () => ({raw: Buffer.from('certificate')}),
    };

    setTimeout(() => {
      callback(response);
      response.emit('data', body);
      response.emit('end');
    }, 0);

    return request;
  });

  return {
    get requestedURL() { return requestedURL; },
    restore: () => stub.restore(),
  };
}

test('HIP-2 hostname normalization removes UI-only syntax', t => {
  t.equal(normalizeHostname('@hnsbroker.hns.bio'), 'hnsbroker.hns.bio');
  t.equal(normalizeHostname('@HNSBroker.HNS.BIO.'), 'hnsbroker.hns.bio');
  t.equal(normalizeHostname(' hnsbroker.hns.bio '), 'hnsbroker.hns.bio');
  t.equal(normalizeHostname('@bücher.'), 'xn--bcher-kva');

  for (const invalid of [
    '', '@', '@@example', 'https://example', 'example/path',
    'user@example', 'example:443', 'bad..name', '-bad', 'bad-',
  ]) {
    t.throws(
      () => normalizeHostname(invalid),
      error => error.code === 'EINVALIDALIAS',
      `${invalid || '<empty>'} is rejected`,
    );
  }
  t.end();
});

test('HNS TXT parser accepts hns colon and equals prefixes', t => {
  t.equal(parseHNSAddressTXT([`hns:${MAIN_ADDRESS}`], 'main'), MAIN_ADDRESS);
  t.equal(parseHNSAddressTXT([`hns=${MAIN_ADDRESS}`], 'main'), MAIN_ADDRESS);
  t.equal(
    parseHNSAddressTXT(['unrelated=value', `hns:${MAIN_ADDRESS}`], 'main'),
    MAIN_ADDRESS,
  );
  t.end();
});

test('HNS TXT parser rejects wrong-network, missing, and ambiguous records', t => {
  t.throws(
    () => parseHNSAddressTXT([`hns:${TESTNET_ADDRESS}`], 'main'),
    error => error.code === 'EINVALID',
  );
  t.throws(
    () => parseHNSAddressTXT(['unrelated=value'], 'main'),
    error => error.code === 'ETXTNOTFOUND',
  );
  t.throws(
    () => parseHNSAddressTXT([
      `hns:${MAIN_ADDRESS}`,
      `hns=${OTHER_MAIN_ADDRESS}`,
    ], 'main'),
    error => error.code === 'ECOLLISION',
  );
  t.throws(
    () => parseHNSAddressTXT([
      `hns:${MAIN_ADDRESS}`,
      `hns=${TESTNET_ADDRESS}`,
    ], 'main'),
    error => error.code === 'EINVALID',
  );
  t.end();
});

test('TXT fallback is independent of every HIP-2 failure', t => {
  t.equal(shouldFallbackToTXT({code: 'ETLSANOTFOUND'}), true);
  t.equal(shouldFallbackToTXT({code: 'ENOTFOUND'}), true);
  t.equal(shouldFallbackToTXT({code: 'EAI_AGAIN'}), true);
  t.equal(shouldFallbackToTXT({code: 'ECONNRESET'}), true);
  t.equal(shouldFallbackToTXT({code: 'ETIMEDOUT'}), true);
  t.equal(shouldFallbackToTXT({code: 404}), true);
  t.equal(shouldFallbackToTXT({code: 'EINSECURE'}), true);
  t.equal(shouldFallbackToTXT({code: 'ETLSAMISMATCH'}), true);
  t.equal(shouldFallbackToTXT({code: 'EINVALID'}), true);
  t.equal(shouldFallbackToTXT({code: 'EBADSIGNATURE'}), true);
  t.equal(shouldFallbackToTXT(null), false);
  t.end();
});

test('missing TXT fallback does not hide a HIP-2 connection error', t => {
  const hip2Error = new Error('host lookup failed');
  hip2Error.code = 'ENOTFOUND';
  const txtError = new Error('HNS TXT record not found');
  txtError.code = 'ETXTNOTFOUND';

  t.equal(selectAliasError(hip2Error, txtError), hip2Error);

  const missingTLSA = new Error('TLSA record not found');
  missingTLSA.code = 'ETLSANOTFOUND';
  t.equal(
    selectAliasError(missingTLSA, txtError),
    txtError,
    'true record absence remains an alias-not-found result',
  );
  t.end();
});

test('secure TXT lookup requires AD and joins TXT chunks', async t => {
  const resolveRaw = sinon.stub(hdns, 'resolveRaw');

  const response = new Message();
  response.code = codes.NOERROR;
  response.ad = true;

  for (const chunks of [
    ['x:hnsbroker'],
    ['hns:', MAIN_ADDRESS],
  ]) {
    const record = new Record();
    record.name = 'hnsbroker.';
    record.type = types.TXT;
    record.data = new TXTRecord();
    record.data.txt = chunks;
    response.answer.push(record);
  }

  // Encode and decode the response so this test uses the same string-valued
  // TXT chunks returned by bns in a real DNS lookup.
  resolveRaw.resolves(Message.decode(response.compress()));

  t.equal(
    await getTXTAddress('hnsbroker', 'main'),
    MAIN_ADDRESS,
    'authenticated root-TLD TXT resolves after unrelated records',
  );

  resolveRaw.resolves({
    code: codes.NOERROR,
    ad: false,
    collect: () => [],
  });

  try {
    await getTXTAddress('hnsbroker.hns.bio', 'main');
    t.fail('unauthenticated TXT response should be rejected');
  } catch (error) {
    t.equal(error.code, 'ETXTINSECURE');
  }

  resolveRaw.restore();
  t.end();
});

test('HIP-2 uses one normalized hostname for HTTPS and TLSA', async t => {
  const request = stubHTTPSResponse(MAIN_ADDRESS);
  const resolveTLSA = sinon.stub(hdns, 'resolveTLSA').resolves([{}]);
  const verifyTLSA = sinon.stub(hdns, 'verifyTLSA').returns(true);
  const resolveRaw = sinon.stub(hdns, 'resolveRaw');

  const address = await getAddress('@HNSBroker.HNS.BIO.', 'main');

  t.equal(address, MAIN_ADDRESS);
  t.equal(
    request.requestedURL,
    'https://hnsbroker.hns.bio/.well-known/wallets/HNS',
  );
  t.deepEqual(resolveTLSA.firstCall.args.slice(0, 3), [
    'hnsbroker.hns.bio',
    'tcp',
    443,
  ]);
  t.equal(resolveRaw.callCount, 0, 'successful HIP-2 remains first choice');

  resolveRaw.restore();
  verifyTLSA.restore();
  resolveTLSA.restore();
  request.restore();
  t.end();
});

test('invalid HIP-2 body can resolve through independent authenticated TXT', async t => {
  const request = stubHTTPSResponse('not-an-hns-address');
  const resolveTLSA = sinon.stub(hdns, 'resolveTLSA').resolves([{}]);
  const verifyTLSA = sinon.stub(hdns, 'verifyTLSA').returns(true);
  const resolveRaw = sinon.stub(hdns, 'resolveRaw').resolves({
    code: codes.NOERROR,
    ad: true,
    collect: () => [{data: {txt: [Buffer.from(`hns=${MAIN_ADDRESS}`)]}}],
  });

  t.equal(await getAddress('@hnsbroker.hns.bio', 'main'), MAIN_ADDRESS);
  t.equal(resolveRaw.callCount, 1, 'authenticated TXT was queried');

  resolveRaw.restore();
  verifyTLSA.restore();
  resolveTLSA.restore();
  request.restore();
  t.end();
});

test('authenticated TLSA absence falls back to authenticated TXT', async t => {
  const request = stubHTTPSResponse(MAIN_ADDRESS);
  const missingTLSA = new Error('no TLSA');
  missingTLSA.code = 'ENODATA';
  const resolveTLSA = sinon.stub(hdns, 'resolveTLSA').rejects(missingTLSA);
  const resolveRaw = sinon.stub(hdns, 'resolveRaw').resolves({
    code: codes.NOERROR,
    ad: true,
    collect: () => [{data: {txt: [Buffer.from(`hns=${MAIN_ADDRESS}`)]}}],
  });

  t.equal(await getAddress('@hnsbroker.hns.bio', 'main'), MAIN_ADDRESS);
  t.equal(resolveRaw.callCount, 1, 'TXT fallback was queried');

  resolveRaw.restore();
  resolveTLSA.restore();
  request.restore();
  t.end();
});

test('TLSA mismatch can resolve through independent authenticated TXT', async t => {
  const request = stubHTTPSResponse(MAIN_ADDRESS);
  const resolveTLSA = sinon.stub(hdns, 'resolveTLSA').resolves([{}]);
  const verifyTLSA = sinon.stub(hdns, 'verifyTLSA').returns(false);
  const resolveRaw = sinon.stub(hdns, 'resolveRaw').resolves({
    code: codes.NOERROR,
    ad: true,
    collect: () => [{data: {txt: [Buffer.from(`hns:${MAIN_ADDRESS}`)]}}],
  });

  t.equal(await getAddress('@hnsbroker.hns.bio', 'main'), MAIN_ADDRESS);
  t.equal(resolveRaw.callCount, 1, 'authenticated TXT was queried');

  resolveRaw.restore();
  verifyTLSA.restore();
  resolveTLSA.restore();
  request.restore();
  t.end();
});

test('TLSA mismatch remains visible when TXT is absent', async t => {
  const request = stubHTTPSResponse(MAIN_ADDRESS);
  const resolveTLSA = sinon.stub(hdns, 'resolveTLSA').resolves([{}]);
  const verifyTLSA = sinon.stub(hdns, 'verifyTLSA').returns(false);
  const resolveRaw = sinon.stub(hdns, 'resolveRaw').resolves({
    code: codes.NOERROR,
    ad: true,
    collect: () => [],
  });

  try {
    await getAddress('@hnsbroker.hns.bio', 'main');
    t.fail('the alias should fail without a secure result');
  } catch (error) {
    t.equal(error.code, 'ETLSAMISMATCH');
  }

  t.equal(resolveRaw.callCount, 1, 'TXT was still checked independently');

  resolveRaw.restore();
  verifyTLSA.restore();
  resolveTLSA.restore();
  request.restore();
  t.end();
});
