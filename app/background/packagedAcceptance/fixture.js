const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {resolvePhysicalPath} = require('./runtime');
const {
  buildControlledScenarioPlan,
  executeControlledSourceFixture,
} = require('./scenarios');

async function configureLocalRegtest(services, profileName, {profileRoot, nodeMode = 'spv'} = {}) {
  const hsdDir = path.join(services.db.getUserDir ? await services.db.getUserDir() : '', profileName);
  if (fs.existsSync(hsdDir) && fs.lstatSync(hsdDir).isSymbolicLink()) {
    throw new Error('Packaged fixture hsd directory cannot be a symbolic link.');
  }
  fs.mkdirSync(hsdDir, {recursive: true});
  if (profileRoot) {
    const physicalRoot = resolvePhysicalPath(profileRoot);
    const physicalHsd = resolvePhysicalPath(hsdDir);
    const relative = path.relative(physicalRoot, physicalHsd);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Packaged fixture hsd directory escaped its isolated profile.');
    }
  }

  await services.db.put('connection_type', 'P2P');
  await services.db.put('network', 'regtest');
  await services.db.put('nodeSpvMode', nodeMode === 'spv' ? '1' : '0');
  await services.db.put('nodeNoDns1', '1');
  await services.db.put('nodeApiKey', crypto.randomBytes(32).toString('hex'));
  await services.db.put('walletApiKey', crypto.randomBytes(32).toString('hex'));
  await services.db.put('hsdPrefixDir', hsdDir);
  if (nodeMode === 'spv') await services.db.put('regtest-hsd-4.0.0-migrate-spv', true);
  return hsdDir;
}

async function waitForWalletService(walletService, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (walletService.node && walletService.node.wdb && walletService.node.wdb.db.loaded) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Disposable wallet fixture did not become ready.');
}

async function seedDisposableMultiwallet(services, config) {
  const walletService = services.wallet.service;
  await waitForWalletService(walletService);
  const wanted = ['acceptance-primary', 'acceptance-secondary'];
  const existing = new Set((await walletService.listWallets()).map(wallet => wallet.wid));
  const created = [];

  for (const walletId of wanted) {
    if (existing.has(walletId)) continue;
    await walletService.createNewWallet(walletId, config.fixturePassphrase, false, null, 1, 1);
    created.push(walletId);
  }
  walletService.setWallet(wanted[0]);
  const scenarioPlan = buildControlledScenarioPlan(config.scenario);
  const sourceFixture = await executeControlledSourceFixture(scenarioPlan);
  return {
    scenario: config.scenario,
    walletIds: wanted,
    walletsCreated: created,
    generatedDisposableKeysOnly: true,
    network: 'regtest',
    transactionFixturesEnabled: false,
    nodeMode: config.nodeMode,
    scenarioPlan,
    sourceFixture,
  };
}

module.exports = {
  configureLocalRegtest,
  seedDisposableMultiwallet,
  waitForWalletService,
};
