import {AsyncLocalStorage} from 'async_hooks';
import {Lock} from 'bmutex';

// Outside hsd 6.1.1's single-byte ASCII layout. Contains heights/request
// numbers only, never wallet identifiers or keys. Older Bob ignores this key.
const JOURNAL_KEY = Buffer.from('ff626f622d72657363616e2d7631', 'hex');

// hsd v6.1.1 delivers embedded block connects while Chain holds its mutex.
// WalletDB.rescan/syncNode take txLock first, then call Chain.scan/reset: the
// opposite order deadlocks when a block arrives during rollback. Install before
// opening the plugin so startup/reconnect and all wallet HTTP/RPC callers share
// the same order. Custom RPC has no local Chain and retains its own client.
export function installLocalRescan(wdb, node) {
  const {chain} = node;
  const client = wdb.client;
  if (client.node !== node) throw new Error('Expected an embedded wallet client.');
  const ownership = new AsyncLocalStorage();
  const journalLock = new Lock();
  let closing = false;
  let pending = 0;
  let active = false;
  let activeObserved = false;
  let failed = false;
  let target = null;
  let lastPublished = 0;
  function publish(status) {
    const state = {status, height: wdb.height, target};
    const previous = wdb.bobRescanState;
    wdb.bobRescanState = state;
    if (previous?.status === status && previous.target === target
        && Date.now() - lastPublished < 500) return;
    lastPublished = Date.now();
    wdb.emit('bob rescan', state);
  }
  function advance() {
    if (target === null || failed) return;
    if (wdb.height >= target && pending <= (active ? 1 : 0) && (!active || activeObserved)) {
      publish('complete');
    } else {
      publish(active || pending === 0 ? 'scanning' : 'waiting');
    }
  }
  wdb.bobRescanState = {status: 'idle', height: wdb.height, target: null};
  wdb.on('block connect', () => {activeObserved = true; advance();});
  async function journal(update) {
    const release = await journalLock.lock();
    try {
      const raw = await wdb.db.get(JOURNAL_KEY);
      const value = raw ? JSON.parse(raw.toString('utf8')) : {next: 0, requests: []};
      if (!Number.isSafeInteger(value.next) || value.next < 0 || !Array.isArray(value.requests)
          || value.requests.some(r => !Number.isSafeInteger(r.id) || (r.height >>> 0) !== r.height)) {
        throw new Error('Invalid pending wallet recovery record.');
      }
      const result = update(value);
      await wdb.db.put(JOURNAL_KEY, Buffer.from(JSON.stringify(value)));
      return result;
    } finally {release();}
  }
  const acknowledge = ids => journal(value => {
    value.requests = value.requests.filter(r => !ids.includes(r.id));
  });
  const originalRescan = wdb.rescan;
  const originalClientRescan = client.rescan;

  client.rescan = async function(start) {
    const owner = ownership.getStore();
    if (!owner?.active) return originalClientRescan.call(this, start);
    // Already own the chain mutex. Use hsd 6.1.1's unlocked implementations;
    // otherwise its public scan/reset would acquire the same mutex twice.
    if (node.spv) return chain._reset(start, false);
    return chain.db.scan(start, this.filter, (entry, txs) =>
      this.emitAsync('block rescan', entry, txs));
  };

  async function withChainLock(operation) {
    const unlock = await chain.locker.lock();
    const owner = {active: true};
    try {
      return await ownership.run(owner, operation);
    } finally {
      // Descendant callbacks must not bypass the mutex after ownership ends.
      owner.active = false;
      unlock();
    }
  }

  wdb.rescan = async function(height) {
    if (closing) throw new Error('Wallet is stopping; recovery was not started.');
    if (height == null) height = this.state.startHeight;
    if ((height >>> 0) !== height) throw new Error('WDB: Must pass in a height.');
    // Persist before waiting for either backend mutex. A crash or failed scan
    // must not silently discard a later wallet's earlier recovery requirement.
    target = Math.max(target || 0, chain.height || 0, wdb.height || 0);
    pending++;
    if (!failed) publish(active ? 'scanning' : 'waiting');
    try {
      const id = await journal(value => {
        const id = ++value.next;
        value.requests.push({id, height});
        return id;
      });
      return await withChainLock(async () => {
        if (closing) throw new Error('Wallet is stopping; recovery remains pending for restart.');
        active = true;
        activeObserved = false;
        if (!failed) publish('scanning');
        try {
          const result = await originalRescan.call(this, height);
          // In SPV mode, durable rewind completion is enough: subsequent
          // download resumes from the persisted WalletDB state on restart.
          await acknowledge([id]);
          return result;
        } finally {active = false;}
      });
    } catch (error) {
      failed = true;
      publish('failed');
      throw error;
    } finally {
      pending--;
      advance();
    }
  };

  const originalSync = wdb.syncNode;
  wdb.syncNode = async function() {
    if (closing) return;
    return withChainLock(async () => {
      if (closing) return;
      await originalSync.call(this);
      const pending = await journal(value => value.requests.slice());
      if (!pending.length) return;
      const height = pending.reduce((min, r) => Math.min(min, r.height), 0xffffffff);
      target = Math.max(target || 0, chain.height || 0, wdb.height || 0);
      active = true;
      activeObserved = false;
      publish('scanning');
      try {
        await originalRescan.call(this, height);
        await acknowledge(pending.map(r => r.id));
        failed = false;
      } catch (error) {
        failed = true;
        publish('failed');
        throw error;
      } finally {
        active = false;
        advance();
      }
    });
  };
  const originalClose = wdb.close;
  wdb.close = async function() {
    closing = true;
    return withChainLock(async () => {
      const releaseWallet = await wdb.txLock.lock();
      try {
        const release = await journalLock.lock();
        try {return await originalClose.call(this);}
        finally {release();}
      } finally {releaseWallet();}
    });
  };
}
