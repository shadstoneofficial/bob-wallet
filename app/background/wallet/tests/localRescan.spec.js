import test from 'tape';
import EventEmitter from 'events';
import walletReducer, {SET_WALLET, SET_RESCAN_STATE} from '../../../ducks/walletReducer';
import {Lock} from 'bmutex';
import {installLocalRescan} from '../localRescan';

function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
const tick = () => new Promise(r => setImmediate(r));
function fixture({store = new Map(), spv = false} = {}) {
  const calls = [];
  let rescanPostlude = async result => result;
  let rescanCalls = 0;
  const chain = {locker: new Lock(), db: {scan: async height => calls.push(height)}};
  chain._reset = async height => calls.push(height);
  const node = {chain, spv};
  const client = {
    node, filter: {}, emitAsync: async () => {},
    async rescan(height) {
      const unlock = await chain.locker.lock();
      try {return await (spv ? chain._reset(height) : chain.db.scan(height));}
      finally {unlock();}
    },
  };
  const wdb = Object.assign(new EventEmitter(), {
    height: 0,
    client, txLock: new Lock(), state: {startHeight: 0},
    db: {
      get: async key => store.get(key.toString('hex')) || null,
      put: async (key, value) => store.set(key.toString('hex'), Buffer.from(value)),
    },
    async rescan(height) {
      const unlock = await this.txLock.lock();
      let result;
      try {result = await client.rescan(height);}
      finally {unlock();}
      return rescanPostlude(result, ++rescanCalls);
    },
    async close() {},
    async syncNode() {
      const unlock = await this.txLock.lock();
      try {return await client.rescan(99);}
      finally {unlock();}
    },
  });
  installLocalRescan(wdb, node);
  return {wdb, chain, store, calls, setRescanPostlude(fn) {rescanPostlude = fn;}};
}
function record(store) {return JSON.parse([...store.values()][0].toString());}

test('local rescans preserve native serialization and every requested height', async t => {
  const f = fixture();
  const entered = deferred(); const gate = deferred();
  f.chain.db.scan = async height => {f.calls.push(height); if (height === 10) {entered.resolve(); await gate.promise;}};
  const first = f.wdb.rescan(10); await entered.promise;
  const more = [0, 4, 2, 1].map(h => f.wdb.rescan(h));
  await tick();
  t.deepEqual(f.calls, [10], 'later requests wait on real backend mutex');
  t.deepEqual(record(f.store).requests.map(r => r.height), [10, 0, 4, 2, 1], 'all requirements durable before waiting');
  gate.resolve(); await Promise.all([first, ...more]);
  t.deepEqual(f.calls, [10, 0, 4, 2, 1]);
  t.deepEqual(record(f.store).requests, []);
  t.notOk(f.chain.locker.busy); t.notOk(f.wdb.txLock.busy);
  t.end();
});

test('crash reconstruction recovers earliest queued coverage without wallet identifiers', async t => {
  const f = fixture(); const gate = deferred(); const entered = deferred();
  f.chain.db.scan = async () => {entered.resolve(); await gate.promise;};
  const first = f.wdb.rescan(10); await entered.promise;
  const second = f.wdb.rescan(2); await tick();
  const saved = new Map([...f.store].map(([k,v]) => [k, Buffer.from(v)]));
  const restarted = fixture({store: saved});
  await restarted.wdb.syncNode();
  t.deepEqual(restarted.calls, [99, 2], 'ordinary synchronization followed by earliest unfulfilled scan');
  t.deepEqual(record(saved).requests, []);
  t.deepEqual(Object.keys(record(saved)).sort(), ['next', 'requests']);
  gate.resolve(); await Promise.all([first, second]);
  t.end();
});

test('failure retains recovery record, releases both mutexes, and retries only on reconnect', async t => {
  const f = fixture();
  f.chain.db.scan = async () => {throw new Error('fixture scan failure');};
  try {await f.wdb.rescan(3); t.fail('must reject');} catch (e) {t.equal(e.message, 'fixture scan failure');}
  t.deepEqual(record(f.store).requests.map(r => r.height), [3]);
  t.notOk(f.chain.locker.busy); t.notOk(f.wdb.txLock.busy);
  f.chain.db.scan = async height => f.calls.push(height);
  await tick(); t.deepEqual(f.calls, [], 'no automatic retry loop');
  await f.wdb.syncNode(); t.deepEqual(f.calls, [99, 3]);
  t.deepEqual(record(f.store).requests, []);
  t.end();
});

test('SPV acknowledgements follow reset completion; future client calls use public locking', async t => {
  const f = fixture({spv: true});
  const gate = deferred(); const entered = deferred();
  let later;
  f.chain._reset = async height => {
    f.calls.push(height);
    if (height === 7) {
      entered.resolve(); await gate.promise;
      later = () => f.wdb.client.rescan(8);
    }
  };
  const scan = f.wdb.rescan(7); await entered.promise;
  t.equal(record(f.store).requests.length, 1);
  gate.resolve(); await scan;
  t.deepEqual(record(f.store).requests, []);
  const unlock = await f.chain.locker.lock();
  const next = later(); await tick(); t.deepEqual(f.calls, [7], 'direct client call still waits for chain');
  unlock(); await next; t.deepEqual(f.calls, [7, 8]);
  t.end();
});

test('bad heights and journal write failures do not start a scan', async t => {
  const f = fixture();
  for (const height of [-1, 1.5, NaN, 0x100000000]) {
    try {await f.wdb.rescan(height); t.fail('must reject');} catch (e) {t.match(e.message, /height/);}
  }
  f.wdb.db.put = async () => {throw new Error('fixture disk full');};
  try {await f.wdb.rescan(0); t.fail('must reject');} catch(e) {t.equal(e.message, 'fixture disk full');}
  t.deepEqual(f.calls, []); t.notOk(f.chain.locker.busy);
  t.end();
});


test('shutdown preserves accepted waiting recovery and rejects new requests', async t => {
  const f = fixture(); const gate = deferred(); const entered = deferred();
  f.chain.db.scan = async height => {f.calls.push(height); entered.resolve(); await gate.promise;};
  const first = f.wdb.rescan(10); await entered.promise;
  const pending = f.wdb.rescan(0).catch(e => e); await tick();
  const closing = f.wdb.close();
  try {await f.wdb.rescan(2); t.fail('must reject');} catch(e) {t.match(e.message, /not started/);}
  gate.resolve(); await first;
  t.match((await pending).message, /pending for restart/); await closing;
  t.deepEqual(record(f.store).requests.map(r => r.height), [0]);
  const restarted = fixture({store: f.store}); await restarted.wdb.syncNode();
  t.deepEqual(restarted.calls, [99, 0]);
  t.deepEqual(record(f.store).requests, []);
  t.end();
});

test('completion requires durable scan acknowledgement and releases queues before a late RPC reply', async t => {
  const f = fixture(); f.chain.height = 100; f.wdb.height = 100;
  const gate = deferred(); const entered = deferred();
  f.chain.db.scan = async () => {
    f.wdb.height = 48; f.wdb.emit('block connect', {height: 48});
    entered.resolve(); await gate.promise;
    f.wdb.height = 100; f.wdb.emit('block connect', {height: 100});
  };
  const first = f.wdb.rescan(0); await entered.promise;
  const second = f.wdb.rescan(0); await tick();
  t.equal(f.wdb.bobRescanState.target, 100, 'second restore cannot replace target with partial height 48');
  f.wdb.height = 100; f.wdb.emit('block connect', {height: 100});
  t.equal(f.wdb.bobRescanState.status, 'scanning', 'pending restore prevents premature completion');
  gate.resolve(); await Promise.all([first, second]);
  t.equal(f.wdb.bobRescanState.status, 'complete');

  const reply = deferred();
  f.chain.db.scan = async height => {
    f.calls.push(height);
    f.wdb.height = 100; f.wdb.emit('block connect', {height: 100});
  };
  f.setRescanPostlude(async (result, call) => call === 1
    ? reply.promise.then(() => result)
    : result);
  let completedStatus = false;
  const third = f.wdb.rescan(0);
  for (let i = 0; i < 20 && f.wdb.bobRescanState.status !== 'complete'; i++) await tick();
  t.equal(f.wdb.bobRescanState.status, 'complete', 'scan success and durable journal acknowledgement mark completion');
  t.notOk(f.wdb.txLock.busy, 'the completed scan released WalletDB before its wrapper reply');
  const queued = f.wdb.rescan(0);
  for (let i = 0; i < 20 && f.calls.length < 2; i++) await tick();
  completedStatus = f.wdb.bobRescanState.status === 'complete';
  t.ok(completedStatus, 'the second request completes while the first RPC promise remains unresolved');
  await queued;
  t.deepEqual(f.calls, [0, 0], 'the next queued scan starts before the first RPC reply settles');
  reply.resolve(); await third;
  t.end();
});

test('scan failure or acknowledgement failure after the target never publishes completion', async t => {
  for (const failure of ['scan-after-target', 'ack-write']) {
    const f = fixture();
    f.chain.height = 100;
    let puts = 0;
    const put = f.wdb.db.put;
    if (failure === 'ack-write') {
      f.wdb.db.put = async (...args) => {
        puts++;
        if (puts === 2) throw new Error('fixture acknowledgement failure');
        return put(...args);
      };
    }
    f.chain.db.scan = async () => {
      f.wdb.height = 100;
      f.wdb.emit('block connect', {height: 100});
      if (failure === 'scan-after-target') throw new Error('fixture scan failed after target');
    };
    try {await f.wdb.rescan(0); t.fail('must reject');}
    catch (error) {t.match(error.message, /fixture (scan failed|acknowledgement failure)/);}
    t.equal(f.wdb.bobRescanState.status, 'failed', `${failure} remains visibly failed`);
    t.equal(record(f.store).requests.length, 1, `${failure} keeps recovery pending on restart`);
  }
  t.end();
});


test('wallet switching and renderer unmount leave shared recovery running', async t => {
  const f = fixture(); f.chain.height = 100;
  const entered = deferred(); const gate = deferred();
  f.chain.db.scan = async () => {entered.resolve(); await gate.promise; f.wdb.height = 100;};
  let state = walletReducer(undefined, {});
  const listener = payload => {state = walletReducer(state, {type: SET_RESCAN_STATE, payload});};
  f.wdb.on('bob rescan', listener);
  const scan = f.wdb.rescan(0); await entered.promise;
  const before = {height: state.rescanHeight, status: state.rescanStatus};
  for (const wid of ['a', 'b', 'a']) {
    state = walletReducer(state, {type: SET_WALLET, payload: {wid, balance: {}}});
    t.deepEqual({height: state.rescanHeight, status: state.rescanStatus}, before);
  }
  f.wdb.removeListener('bob rescan', listener);
  t.ok(f.chain.locker.busy, 'unmount does not abort or rewind the backend');
  gate.resolve(); await scan;
  t.equal(f.wdb.bobRescanState.status, 'complete');
  listener(f.wdb.bobRescanState);
  t.notOk(state.walletSync, 'reopened renderer receives latest backend state');
  t.end();
});
