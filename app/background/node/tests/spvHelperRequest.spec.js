const test = require('tape');
const {createSpvHelperClient, retryAfterMs} = require('../spvHelperRequest');

function response(status, body, headers = {}) {
  return {
    status,
    headers: {get: name => headers[name] || null},
    json: async () => {
      if (typeof body === 'string') return JSON.parse(body);
      return body;
    },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function fixture(responses, random = 0.5) {
  let time = Date.parse('2026-09-16T00:00:00Z');
  const calls = [];
  const waits = [];
  const client = createSpvHelperClient({
    now: () => time,
    random: () => random,
    trace: () => {},
    sleep: async ms => { waits.push(ms); time += ms; },
    fetchImpl: async (url, options) => {
      calls.push({url, ...options, signal: options.signal ? 'attached' : null});
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('Unexpected retry');
      return next;
    },
  });
  return {client, calls, waits};
}

async function errorFrom(fn) {
  try { await fn(); } catch (error) { return error; }
  throw new Error('Expected rejection');
}

const throttle = () => response(429, {error: {message: 'Rate limit exceeded.', code: 123,
  type: 'RateLimitError'}}, {'retry-after': '60'});

test('SPV helper retries GET after Retry-After without parsing a throttle body', async t => {
  const first = response(429, '<html>slow down</html>', {'retry-after': '60'});
  first.json = async () => { throw new Error('Must not parse discarded body'); };
  const f = fixture([first, response(200, {hash: 'found'})]);
  t.deepEqual(await f.client.get('https://custom.example/hsd', '/tx/hash'), {hash: 'found'});
  t.deepEqual(f.waits, [60126], 'server delay plus positive jitter');
  t.equal(f.calls.length, 2);
  t.deepEqual(f.calls[0], f.calls[1], 'replays the same URL and GET options');
  t.equal(f.calls[0].url, 'https://custom.example/hsd/tx/hash');
  t.end();
});

test('SPV helper bounds repeated throttles and preserves the final API error', async t => {
  const f = fixture([throttle(), throttle(), throttle()]);
  const error = await errorFrom(() => f.client.get('https://example/hsd', '/tx/hash'));
  t.equal(f.calls.length, 3, 'initial attempt plus two retries');
  t.equal(f.waits.length, 2);
  t.equal(error.message, 'Rate limit exceeded.');
  t.equal(error.code, 123);
  t.equal(error.type, 'RateLimitError');
  t.equal(error.status, 429);
  t.end();
});

test('SPV Retry-After handles seconds, HTTP dates and server clock skew', t => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const delay = headers => retryAfterMs(response(429, {}, headers).headers, now);
  t.equal(delay({'retry-after': ' 60 '}), 60000);
  t.equal(delay({'retry-after': 'Wed, 16 Sep 2026 00:01:00 GMT'}), 60000);
  t.equal(delay({'retry-after': 'Wed, 16 Sep 2026 00:01:00 GMT',
    date: 'Wed, 16 Sep 2026 00:00:30 GMT'}), 30000, 'server date avoids local clock skew');
  t.equal(delay({'retry-after': 'Tue, 15 Sep 2026 23:59:00 GMT'}), 0);
  for (const value of ['', '-1', '0.5', 'garbage'])
    t.equal(delay({'retry-after': value}), null, `invalid value ${value} uses fallback`);
  t.end();
});

test('SPV helper uses exponential fallback and jitter for missing/invalid headers', async t => {
  const f = fixture([response(429, {}), response(429, {}, {'retry-after': 'nope'}),
    response(200, {ok: true})], 0);
  await f.client.get('https://example/hsd');
  t.deepEqual(f.waits, [1001, 2001]);
  const zero = fixture([response(429, {}, {'retry-after': '0'}), response(200, {})], 0.99);
  await zero.client.get('https://example/hsd');
  t.deepEqual(zero.waits, [248], 'zero still gets positive jitter');
  t.end();
});

test('SPV helper honors Retry-After for a retryable 503 without overlapping attempts', async t => {
  let active = 0;
  let maxActive = 0;
  const f = fixture([
    response(503, {error: {message: 'Temporarily unavailable'}}, {'retry-after': '2'}),
    response(200, {result: {info: null, start: null}, error: null}),
  ], 0);
  const original = f.client.post;
  f.client.post = async (...args) => {
    active++;
    maxActive = Math.max(maxActive, active);
    try { return await original(...args); } finally { active--; }
  };
  await f.client.post('https://example/hsd', '', {method: 'getnameinfo', params: ['fixture']});
  t.equal(f.calls.length, 2);
  t.deepEqual(f.waits, [2001]);
  t.equal(maxActive, 1, 'only one retry chain is active');
  t.end();
});

test('SPV helper aborts a request that exceeds its per-attempt timeout', async t => {
  const client = createSpvHelperClient({
    requestTimeoutMs: 1,
    trace: () => {},
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  const error = await errorFrom(() => client.get('https://example/hsd'));
  t.equal(error.code, 'ETIMEDOUT');
  t.equal(error.status, 408);
  t.end();
});

test('SPV helper never truncates a long Retry-After or exceeds the retry budget', async t => {
  for (const header of ['126', '99999999999999999999999999999999999999999',
    'Wed, 16 Sep 2026 01:00:00 GMT']) {
    const f = fixture([response(429, {error: {message: 'Wait longer'}}, {'retry-after': header})]);
    const error = await errorFrom(() => f.client.get('https://example/hsd'));
    t.equal(error.message, 'Wait longer');
    t.equal(f.calls.length, 1);
    t.deepEqual(f.waits, [], 'no early retry');
  }
  const f = fixture([response(429, {}, {'retry-after': '100'}),
    response(429, {error: {message: 'Still throttled'}}, {'retry-after': '30'})]);
  t.equal((await errorFrom(() => f.client.get('https://example/hsd'))).message, 'Still throttled');
  t.equal(f.calls.length, 2);
  t.equal(f.waits.length, 1, 'second wait would exceed total budget');
  t.end();
});

test('SPV helper retries address history and allowlisted RPC with identical bodies', async t => {
  for (const [path, body] of [
    ['/tx/address', {addresses: ['hs1test'], startBlock: 0, endBlock: 100}],
    ['', {method: 'getnameinfo', params: ['handshake']}],
  ]) {
    const f = fixture([throttle(), response(200, {result: 'ok', error: null})]);
    t.deepEqual(await f.client.post('https://example/hsd', path, body), {result: 'ok', error: null});
    t.equal(f.calls.length, 2);
    t.deepEqual(f.calls[0], f.calls[1]);
    t.equal(f.calls[0].body, JSON.stringify(body));
    t.equal(f.calls[0].method, 'POST');
  }
  for (const [path, body] of [['', {method: 'sendrawtransaction', params: ['signed']}],
    ['', {method: 'newUnknownMethod'}], ['/other', {}]]) {
    const f = fixture([throttle()]);
    await errorFrom(() => f.client.post('https://example/hsd', path, body));
    t.equal(f.calls.length, 1, 'unknown or state-changing POST is never replayed');
    t.equal(f.waits.length, 0);
  }
  t.end();
});

test('SPV helper preserves HTTP, RPC and network errors without retrying them', async t => {
  for (const status of [400, 403, 404, 500, 502, 504]) {
    const f = fixture([response(status, {error: {message: 'Provider error', code: -8, type: 'APIError'}})]);
    const error = await errorFrom(() => f.client.get('https://example/hsd'));
    t.equal(error.message, 'Provider error');
    t.equal(error.code, -8);
    t.equal(error.status, status);
    t.equal(f.calls.length, 1);
  }
  const rpc = fixture([response(200, {error: {message: 'Invalid RPC parameters', code: -8}})]);
  t.equal((await errorFrom(() => rpc.client.post('https://example/hsd', '',
    {method: 'getnameinfo'}))).message, 'Invalid RPC parameters');
  t.equal(rpc.calls.length, 1);
  const networkError = new Error('Network unavailable');
  const network = fixture([networkError]);
  t.equal(await errorFrom(() => network.client.get('https://example/hsd')), networkError);
  t.equal(network.calls.length, 1);
  const invalid = fixture([response(200, 'not json')]);
  t.ok(await errorFrom(() => invalid.client.get('https://example/hsd')) instanceof SyntaxError);
  const empty = fixture([response(200, null)]);
  t.equal((await errorFrom(() => empty.client.post('https://example/hsd', '', {}))).message,
    'No body for JSON-RPC response.');
  const generic = fixture([response(404, {})]);
  t.equal((await errorFrom(() => generic.client.get('https://example/hsd'))).message, 'Status code: 404.');
  t.end();
});
