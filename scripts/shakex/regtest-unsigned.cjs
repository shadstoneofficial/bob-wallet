// Unsigned regtest construction checks only: no node, ports, wallet files, keys or signing.
process.env.NODE_BACKEND = 'js';
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const assert = require('assert/strict');
const Wallet = require('hsd/lib/wallet/wallet');
const NameState = require('hsd/lib/covenants/namestate');
const Coin = require('hsd/lib/primitives/coin');
const Address = require('hsd/lib/primitives/address');
const Network = require('hsd/lib/protocol/network');
const rules = require('hsd/lib/covenants/rules');
const {Resource} = require('hsd/lib/dns/resource');
const {buildSaleReview} = require('../../app/addons/shakex/records');
const {assertCanonicalStillCurrent} = require('../../app/utils/activateProposal');
(async () => {
  const network = Network.get('regtest');
  const name = 'shakexfixture';
  const ns = new NameState();
  ns.name = Buffer.from(name); ns.nameHash = rules.hashName(ns.name);
  ns.height = 1; ns.renewal = 1000; ns.registered = true;
  const coin = new Coin();
  coin.hash = Buffer.alloc(32, 1); coin.index = 0; coin.height = 900; coin.value = 1000000;
  coin.address = Address.fromHash(Buffer.alloc(20, 2));
  coin.covenant.type = rules.types.UPDATE;
  coin.covenant.pushHash(ns.nameHash); coin.covenant.pushU32(ns.height); coin.covenant.push(Buffer.from('00', 'hex'));
  ns.owner.hash = coin.hash; ns.owner.index = coin.index;
  const context = {network, wdb: {height: 1000}, getNameState: async () => ns, getCoin: async () => coin};
  const original = {records: [{type: 'NS', ns: 'ns1.example.'}, {type: 'TXT', txt: ['x:alice']}]};
  let raw = Resource.fromJSON(original).encode().toString('hex');
  for (const options of [{price: '5000', contact: 'X @alice'}, {price: '6000', contact: 'X @alice'}, {remove: true}]) {
    const review = buildSaleReview(raw, options);
    assertCanonicalStillCurrent(review, raw);
    const tx = await Wallet.prototype.makeUpdate.call(context, name, Resource.fromJSON(review.afterResource));
    tx.view.addCoin(coin);
    assert.equal(tx.inputs[0].witness.items.length, 0);
    assert.equal(rules.verifyCovenants(tx, tx.view, 1001, network), 0);
    const result = Resource.decode(tx.outputs[0].covenant.get(2)).toJSON();
    assert.deepEqual(result.records.slice(0, 2), original.records);
    raw = Resource.fromJSON(result).encode().toString('hex');
  }
  assert.deepEqual(Resource.decode(Buffer.from(raw, 'hex')).toJSON(), original);
  const stale = buildSaleReview(raw, {contact: 'X @alice'});
  assert.throws(() => assertCanonicalStillCurrent(stale, '00'), /changed/);
  context.getCoin = async () => null;
  await assert.rejects(Wallet.prototype.makeUpdate.call(context, name, Resource.fromJSON(original)), /does not own/);
  console.log('PASS: unsigned regtest UPDATE construction/covenants for list, edit, delist; preserved DNS/profile, stale resource and missing ownership. No signing/broadcast.');
})().catch(error => {console.error(error); process.exitCode = 1;});
