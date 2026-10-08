// Real SPV chain reset and WalletDB replay with generated coinbase history.
process.env.NODE_BACKEND = 'js';
const watchdog = setTimeout(() => {console.error('Fixture exceeded 20 seconds'); process.exit(1);}, 20000);
process.env.BABEL_DISABLE_CACHE = '1';
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const assert = require('assert/strict');
const crypto = require('crypto');
const net = require('net');
const dgram = require('dgram');
net.Socket.prototype.connect = net.Server.prototype.listen = () => {throw new Error('Sockets forbidden');};
dgram.createSocket = () => {throw new Error('Sockets forbidden');};
const EventEmitter = require('events');
const BlockStore = require('hsd/lib/blockstore/level');
const Chain = require('hsd/lib/blockchain/chain');
const Miner = require('hsd/lib/mining/miner');
const WalletDB = require('hsd/lib/wallet/walletdb');
const NodeClient = require('hsd/lib/wallet/nodeclient');
const WorkerPool = require('hsd/lib/workers/workerpool');
const {installLocalRescan} = require('../../app/background/wallet/localRescan');
const {createRecoveryAdmission} = require('../../app/background/wallet/recoveryAdmission');
const tick = () => new Promise(r => setImmediate(r));
async function recordJournal(wdb) {
 const raw=await wdb.db.get(Buffer.from('ff626f622d72657363616e2d7631','hex'));
 return raw ? JSON.parse(raw.toString('utf8')).requests : [];
}
const walletCount = Number(process.argv[process.argv.indexOf('--count') + 1]) || 2;
(async () => {
 const workers = new WorkerPool({enabled:false});
 const blocks = new BlockStore({memory:true, network:'regtest'});
 const full = new Chain({memory:true, network:'regtest', blocks, workers});
 const spv = new Chain({memory:true, network:'regtest', spv:true, workers});
 const miner = new Miner({chain:full, workers});
 const source = new WalletDB({memory:true, network:'regtest', workers});
 const node = new EventEmitter();
 Object.assign(node, {chain:spv, spv:true, network:spv.network, pool:{setFilter(){}, queueFilterLoad(){}}});
 spv.on('reset', tip => node.emit('reset', tip));
 let reachConnect; let releaseConnect;
 const reached = new Promise(r => {reachConnect = r;});
 const released = new Promise(r => {releaseConnect = r;});
 const gateConnect = async entry => {if (entry.height === 21) {reachConnect(); await released;}};
 spv.on('connect', gateConnect);
 const client = new NodeClient(node);
 let wdb = new WalletDB({memory:true, network:'regtest', spv:true, workers, client});
 if (!process.argv.includes('--baseline')) installLocalRescan(wdb,node);
 const errors = []; wdb.on('error', e => errors.push(e.message));
 try {
  await blocks.open(); await full.open(); await spv.open(); await miner.open(); await source.open(); await tick();
  const keys = []; const addresses = []; const history = [];
  for(let i=0;i<walletCount;i++) {const w=await source.create(); keys.push(w.master.key.toBase58('regtest')); addresses.push(await w.receiveAddress());}
  for (let i=0;i<20;i++) {
   miner.addresses.length=0; miner.addresses.push(addresses[i%walletCount]);
   const job=await miner.cpu.createJob(); job.refresh(); const block=await job.mineAsync();
   await full.add(block); await spv.add(block); history.push(block);
  }
  await wdb.open(); await tick(); await wdb.syncNode();
  assert.equal(wdb.height,20);
  await wdb.create({id:'restore-0',master:keys[0]});
  const requestId=crypto.randomBytes(16).toString('hex');
  const adapterEnabled=!process.argv.includes('--baseline');
  const admission=createRecoveryAdmission(()=>wdb.bobRescanState);
  await wdb.rescan(0,{requestId});
  assert.equal(spv.height,0); assert.equal(wdb.height,0);
  if(adapterEnabled) {
   assert.equal(wdb.bobRescanState.status,'scanning');
   assert.equal(wdb.bobRescanState.target,20);
   assert.equal(wdb.bobRescanState.ready,false);
   assert(wdb.bobRescanState.activeRequestIds.includes(requestId));
   assert.throws(()=>admission.beginImport(),{code:'WALLET_RECOVERY_BUSY'});
   await assert.rejects(wdb.rescan(0),/not ready/,'a second restore cannot start during SPV replay');
  }
  for (const block of history.slice(0,5)) await spv.add(block);
  assert.equal(wdb.height,5);
  if(adapterEnabled) {
   assert.equal(wdb.bobRescanState.status,'scanning','partial replay remains pending');
   assert(!wdb.bobRescanState.completedRequestIds.includes(requestId));
   assert.throws(()=>admission.beginImport(),{code:'WALLET_RECOVERY_BUSY'});
  }
  // Exercise a process-equivalent WalletDB reconstruction at partial replay.
  const persistedDB=wdb.db;
  await tick();
  const drain = await wdb.txLock.lock(); drain();
  await wdb.close();
  spv.removeAllListeners('connect'); spv.removeAllListeners('disconnect'); node.removeAllListeners('reset');
  spv.on('connect', gateConnect);
  const restartClient=new NodeClient(node);
  wdb=new WalletDB({memory:true,network:'regtest',spv:true,workers,client:restartClient});
  wdb.db=persistedDB;
  wdb.on('error',e=>errors.push(e.message)); if (!process.argv.includes('--baseline')) installLocalRescan(wdb,node);
  await wdb.open(); await tick(); await wdb.syncNode();
  assert.equal(wdb.height,5);
  if(adapterEnabled) {
   assert.equal(wdb.bobRescanState.target,20,'restart preserves the original replay target');
   assert.equal(wdb.bobRescanState.ready,false);
  }
  const restartedAdmission=createRecoveryAdmission(()=>wdb.bobRescanState);
  if(adapterEnabled) assert.throws(()=>restartedAdmission.beginImport(),{code:'WALLET_RECOVERY_BUSY'});
  for (const block of history.slice(5)) await spv.add(block);
  assert.equal(wdb.height,20); assert.equal(spv.height,20);
  if(adapterEnabled) {
   for(let i=0;i<100 && wdb.bobRescanState.status!=='complete';i++) await tick();
   assert.equal(wdb.bobRescanState.status,'complete','replay target publishes completion');
   assert(wdb.bobRescanState.completedRequestIds.includes(requestId));
   assert.equal(wdb.bobRescanState.ready,true);
   assert(!restartedAdmission.isBusy(),'another import is admitted only after full replay');
  }
  assert((await (await wdb.get('restore-0')).getBalance()).confirmed>0,
   'the first generated wallet recovered its own mined history');
  for(let i=1;i<walletCount;i++) {
   const id=`restore-${i}`;
   await wdb.create({id,master:keys[i]});
   const nextRequestId=crypto.randomBytes(16).toString('hex');
   await wdb.rescan(0,{requestId:nextRequestId});
   if(adapterEnabled) {
    assert.equal(wdb.bobRescanState.status,'scanning');
    assert.equal(wdb.bobRescanState.target,20);
    assert.equal(wdb.bobRescanState.ready,false);
    assert.throws(()=>createRecoveryAdmission(()=>wdb.bobRescanState).beginImport(),{code:'WALLET_RECOVERY_BUSY'});
   }
   for(const replay of history) await spv.add(replay);
   if(adapterEnabled) {
    for(let n=0;n<100 && wdb.bobRescanState.status!=='complete';n++) await tick();
    assert(wdb.bobRescanState.completedRequestIds.includes(nextRequestId));
    assert.equal(wdb.bobRescanState.ready,true);
   }
   assert((await (await wdb.get(id)).getBalance()).confirmed>0,
    `${id} recovered its own generated address history`);
  }

  // Existing profiles from before the journal can also need ordinary SPV
  // catch-up. Capture target 20 before native syncNode rewinds chain to wallet 5.
  await wdb.rollback(5);
  assert.equal((await recordJournal(wdb)).length,0,'ordinary catch-up starts with no Bob recovery journal');
  await wdb.syncNode();
  if(adapterEnabled) {
   assert.equal(wdb.bobRescanState.status,'scanning');
   assert.equal(wdb.bobRescanState.target,20);
   assert.equal(wdb.bobRescanState.ready,false);
   assert.throws(()=>createRecoveryAdmission(()=>wdb.bobRescanState).beginImport(),{code:'WALLET_RECOVERY_BUSY'});
  }
  for(const replay of history.slice(5,10)) await spv.add(replay);
  assert.equal(wdb.height,10,'ordinary profile catch-up is partially replayed');
  if(adapterEnabled) assert.equal(wdb.bobRescanState.status,'scanning');
  const catchupDB=wdb.db;
  const catchupDrain=await wdb.txLock.lock(); catchupDrain();
  await wdb.close();
  spv.removeAllListeners('connect'); spv.removeAllListeners('disconnect'); node.removeAllListeners('reset');
  spv.on('connect',gateConnect);
  const catchupClient=new NodeClient(node);
  wdb=new WalletDB({memory:true,network:'regtest',spv:true,workers,client:catchupClient});
  wdb.db=catchupDB;
  wdb.on('error',e=>errors.push(e.message)); if(adapterEnabled) installLocalRescan(wdb,node);
  await wdb.open(); await tick(); await wdb.syncNode();
  assert.equal(wdb.height,10);
  if(adapterEnabled) {
   assert.equal(wdb.bobRescanState.target,20,'unjournaled profile target survives partial-replay restart');
   assert.equal(wdb.bobRescanState.ready,false);
   assert.throws(()=>createRecoveryAdmission(()=>wdb.bobRescanState).beginImport(),{code:'WALLET_RECOVERY_BUSY'});
  }
  for(const replay of history.slice(10)) await spv.add(replay);
  assert.equal(wdb.height,20); assert.equal(spv.height,20);
  if(adapterEnabled) {
   for(let n=0;n<100 && wdb.bobRescanState.status!=='complete';n++) await tick();
   assert.equal(wdb.bobRescanState.status,'complete','existing-profile catch-up opens admission at the original tip');
   assert.equal(wdb.bobRescanState.ready,true);
  }
  const job = await miner.cpu.createJob(); job.refresh(); const block = await job.mineAsync();
  await full.add(block); history.push(block);
  const adding = spv.add(block); await reached;
  let reachedLock;
  const queued = new Promise(r => {reachedLock = r;});
  const originalLock = spv.locker.lock;
  spv.locker.lock = function(...args) {
    const result = originalLock.apply(this,args);
    if (this.jobs.length) reachedLock();
    return result;
  };
  const scanning = wdb.rescan(0);
  await queued;
  spv.locker.lock = originalLock;
  assert.equal(spv.locker.jobs.length,1);
  releaseConnect();
  if(process.argv.includes('--baseline')) {
   for(let i=0;i<10;i++) await tick();
   assert.equal(spv.locker.busy,true); assert.equal(wdb.txLock.busy,true);
   assert.equal(spv.locker.jobs.length,1); assert.equal(wdb.txLock.jobs.length,1);
   console.log(JSON.stringify({mode:'SPV',confirmedLockCycle:true,chainHeight:spv.height,walletHeight:wdb.height}));
   process.exit(0);
  }
  await Promise.all([adding,scanning]);
  assert.equal(spv.height,0); assert.equal(wdb.height,0);
  for(const replay of history) await spv.add(replay);
  assert.equal(wdb.height,21);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({mode:'SPV',restores:walletCount,restartAt:5,unjournaledRestartAt:10,chainHeight:spv.height,walletHeight:wdb.height,replayTarget:20,completedAfterReplay:true,sockets:0}));
 } catch(error) {console.error("SPV fixture failure:",error); throw error;} finally {
  if(wdb.client.opened) await wdb.close(); if(source.client.opened) await source.close();
  await miner.close(); await spv.close(); await full.close(); await blocks.close(); await workers.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
