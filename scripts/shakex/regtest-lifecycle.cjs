// Disposable in-memory regtest only. No sockets, existing wallets, config files or persisted keys.
process.env.NODE_BACKEND = 'js';
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const assert = require('assert/strict');
const BlockStore = require('hsd/lib/blockstore/level');
const Chain = require('hsd/lib/blockchain/chain');
const Miner = require('hsd/lib/mining/miner');
const WalletDB = require('hsd/lib/wallet/walletdb');
const WorkerPool = require('hsd/lib/workers/workerpool');
const Network = require('hsd/lib/protocol/network');
const rules = require('hsd/lib/covenants/rules');
const {Resource} = require('hsd/lib/dns/resource');
const {buildSaleReview} = require('../../app/addons/shakex/records');
const {assertCanonicalStillCurrent} = require('../../app/utils/activateProposal');
(async () => {
 const network = Network.get('regtest'); assert.equal(network.type, 'regtest');
 const workers = new WorkerPool({enabled: false});
 const blocks = new BlockStore({memory: true, network});
 const chain = new Chain({memory: true, blocks, network, workers});
 const miner = new Miner({chain, workers});
 const wdb = new WalletDB({memory: true, network, workers});
 try {
  await blocks.open(); await chain.open(); await miner.open(); await wdb.open();
  const wallet = await wdb.create(); // fresh entropy, never exported
  const address = (await wallet.createReceive()).getAddress();
  miner.addresses.push(address);
  async function mine(count = 1, mtx = null) {
   for (let i = 0; i < count; i++) {
    const job = await miner.cpu.createJob();
    if (i === 0 && mtx) {const [tx, view] = mtx.commit(); assert(job.addTX(tx, view));}
    job.refresh(); const block = await job.mineAsync();
    const entry = await chain.add(block); assert(entry); await wdb.addBlock(entry, block.txs);
   }
  }
  async function submit(mtx) {
   await wallet.sign(mtx); assert(mtx.verify());
   await wdb.addTX(mtx.toTX()); await mine(1, mtx);
   return mtx.txid();
  }
  await mine(20);
  const name = rules.grindName(10, chain.height + 1, network);
  await submit(await wallet.createOpen(name)); await mine(network.names.treeInterval + 1);
  await submit(await wallet.createBid(name, 1000000, 2000000)); await mine(network.names.biddingPeriod);
  await submit(await wallet.createReveal(name)); await mine(network.names.revealPeriod + 1);
  const original = {records: [{type: 'NS', ns: 'ns1.example.'}, {type: 'DS', keyTag: 1, algorithm: 13, digestType: 2, digest: 'ab'.repeat(32)}, {type: 'TXT', txt: ['x:alice']}]};
  await submit(await wallet.createUpdate(name, Resource.fromJSON(original)));
  await mine(network.names.treeInterval);
  const hash = rules.hashName(Buffer.from(name));
  const canonical = async () => (await chain.db.getNameState(hash)).data.toString('hex');
  const results = [];
  for (const [action, options] of [['list', {price:'5000',contact:'X @alice'}], ['edit',{price:'6000',contact:'X @alice'}], ['delist',{remove:true}]]) {
   const before = await canonical(); const review = buildSaleReview(before, options);
   assert.equal(await canonical(), before, 'preview does not mutate chain');
   assertCanonicalStillCurrent(review, await canonical());
   const txid = await submit(await wallet.createUpdate(name, Resource.fromJSON(review.afterResource)));
   await mine(network.names.treeInterval);
   const current = await canonical();
   assert.deepEqual(Resource.decode(Buffer.from(current, 'hex')).toJSON(), review.afterResource);
   assert.deepEqual(review.afterResource.records.slice(0,3), original.records);
   assert.throws(() => assertCanonicalStillCurrent(review, current), /changed/);
   const walletState = await wallet.getNameState(hash);
   assert.equal(walletState.data.toString('hex'), current, 'wallet and chain agree');
   results.push({action, txid, height: chain.height, bytes: current.length / 2});
  }
  assert.deepEqual(Resource.decode(Buffer.from(await canonical(), 'hex')).toJSON(), original);
  console.log(JSON.stringify({network: network.type, storage:'memory', sockets:0, results, passed:true}, null, 2));
 } finally {await wdb.close(); await miner.close(); await chain.close(); await blocks.close(); await workers.close();}
})().catch(e => {console.error(e); process.exitCode=1;});
