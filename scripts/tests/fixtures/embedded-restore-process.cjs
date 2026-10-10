const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const net = require('node:net');
const dgram = require('node:dgram');
const {EventEmitter} = require('node:events');
process.env.NODE_BACKEND = 'js';
process.env.BABEL_DISABLE_CACHE = '1';
process.env.BOB_PACKAGED_ACCEPTANCE_TEST = 'true';
process.env.NODE_ENV = 'production';
const root = fs.realpathSync(process.argv[2]);
assert(path.basename(root).startsWith('bob-embedded-source-'));
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
process.env.BOB_ACCEPTANCE_NODE_MODE = manifest.nodeMode;
process.env.BOB_ACCEPTANCE_USER_DATA = manifest.userData;
process.env.BOB_ACCEPTANCE_MANIFEST = manifestPath;
process.env.BOB_ACCEPTANCE_TOKEN = manifest.activationToken;
const {loadAcceptanceConfig, createBackendErrorMonitor} = require('../../../app/background/packagedAcceptance/runtime');
const config = loadAcceptanceConfig(process.env, {appDataPath: root});
const actions = [];
const monitor = createBackendErrorMonitor({writeEvent() {}});
const originalError = console.error;
console.error = (...args) => {monitor.observeConsoleError(args); originalError(...args);};
const ipcMain = new EventEmitter();
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return {app: {isPackaged: true,
    getPath(name) {assert.equal(name, 'userData'); return config.userData;}}, ipcMain};
  if (/mainWindow$/.test(request)) return {dispatchToMainWindow(action) {
    if (String(action.type).toLowerCase().includes('rescan')) actions.push(structuredClone(action));
  }, getMainWindow: () => null, isTrustedRendererEvent: () => true};
  if (request === 'hsd-ledger') return {HID: {Device: class {}}, LedgerHSD: class {}};
  return originalLoad.call(this, request, parent, isMain);
};
require('@babel/register')({configFile: false, babelrc: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
  plugins: ['@babel/plugin-proposal-class-properties']});
const loopback = host => ['127.0.0.1', 'localhost', '::1'].includes(host);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' ? values[0] : {};
  const host = options.host || (typeof values[1] === 'string' ? values[1] : 'localhost');
  assert(loopback(host), 'Source fixture forbids external connections.');
  return originalConnect.apply(this, args);
};
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  const host = typeof args[0] === 'object' ? args[0].host : args[1];
  assert(loopback(host), 'Source fixture servers must explicitly bind loopback.');
  return originalListen.apply(this, args);
};
dgram.createSocket = () => assert.fail('No UDP in embedded source fixture.');
const services = {db: require('../../../app/background/db/service'),
  node: require('../../../app/background/node/service'),
  wallet: require('../../../app/background/wallet/service')};
const {installProductRuntime} = require('../../../app/background/packagedAcceptance/productRuntime');
const {installAcceptanceBackendPolicy} = require('../../../app/background/packagedAcceptance/policy');
const {configureLocalRegtest, seedDisposableMultiwallet} = require('../../../app/background/packagedAcceptance/fixture');
const registered = new Map();
const server = {withService(name, methods) {
  for (const [key, method] of Object.entries(methods)) registered.set(`${name}.${key}`, method);
}};
// Ephemeral loopback ports avoid colliding with another running Bob instance.
async function unusedPort() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
const watchdog = setTimeout(() => {process.stderr.write('Embedded source fixture timed out.\n'); process.exit(2);}, 45000);
(async () => {
  try {
    await services.db.start(server);
    await configureLocalRegtest(services, 'acceptance-hsd-profile', config);
    installProductRuntime(config, services.db, server);
    installAcceptanceBackendPolicy(services, config);
    await services.node.start(server);
    await services.wallet.start(server);
    const rpcPort = await unusedPort();
    const walletPort = await unusedPort();
    services.node.service.getRpcPort = () => rpcPort;
    services.node.service.getWalletPort = () => walletPort;
    for (const method of ['Wallet.revealSeed', 'Wallet.getMasterHDKey', 'Wallet.sendBid', 'Wallet.broadcastPreparedBidMany',
      'Node.broadcastRawTx', 'Node.generateToAddress', 'Node.testCustomRPCClient']) {
      assert(registered.has(method), `Missing protected method ${method}`);
      await assert.rejects(registered.get(method)(), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    }
    await assert.rejects(services.node.service.start('main'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    await assert.rejects(registered.get('DB.put')('acceptance-embedded-restore-v1', {}),
      {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
    await services.node.service.start('regtest');
    let delayedAcknowledgements = 0;
    if (process.argv[3] === 'delay-final-ack') {
      const wdb = services.wallet.service.node.wdb;
      const journalKey = Buffer.from('ff626f622d72657363616e2d7631', 'hex');
      const originalPut = wdb.db.put;
      wdb.db.put = async function(key, value) {
        if (Buffer.isBuffer(key) && key.equals(journalKey)
            && JSON.parse(value.toString('utf8')).requests.length === 0) {
          delayedAcknowledgements += 1;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        return originalPut.call(this, key, value);
      };
    }
    const result = await seedDisposableMultiwallet(services, config);
    for (const walletId of result.walletIds) {
      services.wallet.service.setWallet(walletId);
      assert.equal(services.wallet.service.name, walletId);
      assert(await services.wallet.service.node.wdb.get(walletId));
    }
    const evidence = result.sourceFixture;
    let selectionSnapshots = null;
    if (evidence.status === 'EMBEDDED REPLAY COMPLETE') {
      selectionSnapshots = [];
      for (const walletId of ['acceptance-primary', 'acceptance-secondary', 'acceptance-primary']) {
        services.wallet.service.setWallet(walletId);
        const account = await services.wallet.service.getAccountInfo();
        assert.equal(account.wid, walletId);
        selectionSnapshots.push({walletId, balanceContext: account.balanceContext,
          confirmed: account.balance.confirmed, unconfirmed: account.balance.unconfirmed,
          lockedUnconfirmed: account.balance.lockedUnconfirmed});
      }
    }
    const rescanActions = actions.filter(action => action.payload?.activeRequestIds);
    if (evidence.backendState.status === 'failed') {
      assert(rescanActions.some(action => action.payload.status === 'failed'
        && action.payload.activeRequestIds.includes(evidence.requestId)));
    }
    assert.equal(monitor.snapshot().length, 0, JSON.stringify(monitor.snapshot()));
    process.stdout.write(`EMBEDDED_RESTORE_RESULT ${JSON.stringify({evidence, rescanActions,
      wallets: result.walletIds, selectionSnapshots, delayedAcknowledgements,
      failures: monitor.snapshot(), realProfileAccessed: false})}\n`);
  } finally {
    await services.node.service.stop();
    await services.db.close();
    clearTimeout(watchdog);
  }
})().catch(error => {process.stderr.write(`${error.stack}\n`); process.exitCode = 1;});
