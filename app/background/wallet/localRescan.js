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
  let active = false;
  let failed = false;
  let target = null;
  let generation = 0;
  let startupSyncDeferred = false;
  const unjournaled = new Set();
  const unacknowledged = new Set();
  const completedOwners = new Set();
  let lastPublished = 0;
  function publish(status) {
    const state = {status, height: wdb.height, target, generation};
    const previous = wdb.bobRescanState;
    wdb.bobRescanState = state;
    if (previous?.status === status && previous.target === target
        && Date.now() - lastPublished < 500) return;
    lastPublished = Date.now();
    wdb.emit('bob rescan', state);
  }
  function advance() {
    if (failed) return;
    if (generation === 0 && unjournaled.size === 0 && unacknowledged.size === 0) return;
    if (unjournaled.size === 0 && unacknowledged.size === 0 && !active && generation > 0) {
      publish('complete');
    } else {
      publish(active ? 'scanning' : 'waiting');
    }
  }
  wdb.bobRescanState = {status: 'idle', height: wdb.height, target: null, generation: 0};
  wdb.on('block connect', advance);
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
    let result;
    if (node.spv) {
      result = await chain._reset(start, false);
    } else {
      result = await chain.db.scan(start, this.filter, (entry, txs) =>
        this.emitAsync('block rescan', entry, txs));
    }

    // A final height event is only display progress. Mark recovery ready after
    // the actual backend scan succeeds and its journal acknowledgement is durable.
    if (owner.requestIds?.length) {
      await acknowledge(owner.requestIds);
      for (const id of owner.requestIds) unacknowledged.delete(id);
      owner.backendComplete = true;
      if (!wdb.txLock.busy) releaseCompletedOwner(owner);
      else completedOwners.add(owner);
    }
    return result;
  };

  const originalTxUnlocker = wdb.txLock.unlocker;
  wdb.txLock.unlocker = function(...args) {
    const result = originalTxUnlocker(...args);
    for (const owner of [...completedOwners]) releaseCompletedOwner(owner, true);
    return result;
  };

  function releaseCompletedOwner(owner, fromUnlock = false) {
    if (!owner.backendComplete || (!fromUnlock && wdb.txLock.busy)) return;
    completedOwners.delete(owner);
    owner.txLockReleased = true;
    owner.releaseChainLock?.();
  }

  async function withChainLock(owner, operation) {
    const unlock = await chain.locker.lock();
    let released = false;
    owner.active = true;
    owner.releaseChainLock = () => {
      if (released) return;
      released = true;
      owner.active = false;
      unlock();
      active = false;
      advance();
    };
    try {
      return await ownership.run(owner, operation);
    } finally {
      // Descendant callbacks must not bypass the mutex after ownership ends.
      owner.releaseChainLock();
    }
  }

  wdb.rescan = async function(height) {
    if (closing) throw new Error('Wallet is stopping; recovery was not started.');
    if (height == null) height = this.state.startHeight;
    if ((height >>> 0) !== height) throw new Error('WDB: Must pass in a height.');
    const ticket = {};
    if (unjournaled.size === 0 && unacknowledged.size === 0) {
      generation++;
      target = Math.max(chain.height || 0, wdb.height || 0);
      failed = false;
    }
    unjournaled.add(ticket);
    // Persist before waiting for either backend mutex. A crash or failed scan
    // must not silently discard a later wallet's earlier recovery requirement.
    publish(active ? 'scanning' : 'waiting');
    let id = null;
    try {
      id = await journal(value => {
        const id = ++value.next;
        value.requests.push({id, height});
        return id;
      });
      unjournaled.delete(ticket);
      unacknowledged.add(id);
      return await withChainLock({requestIds: [id]}, async () => {
        if (closing) throw new Error('Wallet is stopping; recovery remains pending for restart.');
        active = true;
        publish('scanning');
        try {
          const result = await originalRescan.call(this, height);
          return result;
        } finally {active = false;}
      });
    } catch (error) {
      failed = true;
      publish('failed');
      throw error;
    } finally {
      if (id == null) unjournaled.delete(ticket);
      advance();
    }
  };

  const originalSync = wdb.syncNode;
  wdb.syncNode = async function() {
    if (closing) return;
    if (node.pool && typeof node.pool.connected === 'boolean' && !node.pool.connected) {
      startupSyncDeferred = true;
      return;
    }
    try {
      return await withChainLock({requestIds: []}, async () => {
        if (closing) return;
        await originalSync.call(this);
        const requests = await journal(value => value.requests.slice());
        for (const request of requests) unacknowledged.add(request.id);
        if (!requests.length) {
          failed = false;
          publish('idle');
          return;
        }
        const height = requests.reduce((min, r) => Math.min(min, r.height), 0xffffffff);
        target = Math.max(chain.height || 0, wdb.height || 0);
        if (generation === 0) generation = 1;
        active = true;
        failed = false;
        const owner = ownership.getStore();
        owner.requestIds = requests.map(r => r.id);
        publish('scanning');
        await originalRescan.call(this, height);
      });
    } catch (error) {
      failed = true;
      publish('failed');
      throw error;
    } finally {advance();}
  };
  wdb.resumeLocalSync = async function() {
    if (!startupSyncDeferred || closing) return;
    startupSyncDeferred = false;
    return wdb.syncNode();
  };
  const originalClose = wdb.close;
  wdb.close = async function() {
    closing = true;
    return withChainLock({requestIds: []}, async () => {
      const releaseWallet = await wdb.txLock.lock();
      try {
        const release = await journalLock.lock();
        try {return await originalClose.call(this);}
        finally {release();}
      } finally {releaseWallet();}
    });
  };
}
