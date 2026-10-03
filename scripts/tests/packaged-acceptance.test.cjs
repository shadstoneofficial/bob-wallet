const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  createBackendErrorMonitor,
  loadAcceptanceConfig,
  resolvePhysicalPath,
  validatePackagedTestModes,
} = require('../../app/background/packagedAcceptance/runtime');
const {
  runChild,
  validateSmokeResult,
} = require('../lib/packaged-smoke-runner.cjs');
const {
  assertAcceptanceHsdDirectory,
  constrainHsdOptions,
  installAcceptanceBackendPolicy,
  sanitizeAcceptanceEnvironment,
  wrapAcceptanceDbMethods,
  wrapBlockedMethods,
  wrapAcceptanceWalletMethods,
} = require('../../app/background/packagedAcceptance/policy');
const {
  initializeAcceptanceAfterWindow,
} = require('../../app/background/packagedAcceptance/startup');

function acceptanceManifest(root) {
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(userData);
  const manifest = {
    version: 1,
    purpose: 'bob-packaged-acceptance',
    scenario: 'multiwallet',
    profileRoot: root,
    userData,
    network: 'regtest',
    transactionMode: 'disabled',
    externalTransactionNetwork: false,
    activationToken: 'a'.repeat(64),
    fixturePassphrase: 'disposable-only-test',
    statusPath: path.join(root, 'runtime-status.json'),
    eventLogPath: path.join(root, 'backend-events.jsonl'),
  };
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return {manifest, manifestPath};
}

test('acceptance manifest selects only an isolated regtest profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-acceptance-config-'));
  const {manifest, manifestPath} = acceptanceManifest(root);
  const config = loadAcceptanceConfig({
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
    BOB_ACCEPTANCE_USER_DATA: manifest.userData,
    BOB_ACCEPTANCE_MANIFEST: manifestPath,
    BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
  }, {appDataPath: path.join(root, 'unrelated-app-data')});
  assert.equal(config.network, 'regtest');
  assert.equal(config.transactionMode, 'disabled');
  assert.equal(config.userData, resolvePhysicalPath(manifest.userData));
});

test('runtime rejects simultaneous packaged smoke and acceptance modes', () => {
  assert.throws(() => validatePackagedTestModes({
    BOB_PACKAGED_SMOKE_TEST: 'true',
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
  }), /cannot run together/);
});

test('acceptance manifest rejects unsupported and networked transaction fixtures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-acceptance-reject-'));
  const {manifest, manifestPath} = acceptanceManifest(root);
  manifest.scenario = 'basket-ambiguous-broadcast';
  manifest.transactionMode = 'enabled';
  manifest.externalTransactionNetwork = true;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadAcceptanceConfig({
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
    BOB_ACCEPTANCE_USER_DATA: manifest.userData,
    BOB_ACCEPTANCE_MANIFEST: manifestPath,
    BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
  }, {appDataPath: root}), /Unsupported packaged acceptance scenario/);
});

test('acceptance manifest refuses the production Bob profile', () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-app-data-'));
  const root = path.join(appDataPath, 'Bob LearnHNS');
  fs.mkdirSync(root);
  const {manifest, manifestPath} = acceptanceManifest(root);
  assert.throws(() => loadAcceptanceConfig({
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
    BOB_ACCEPTANCE_USER_DATA: manifest.userData,
    BOB_ACCEPTANCE_MANIFEST: manifestPath,
    BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
  }, {appDataPath}), /refuses the production Bob profile/);
});

test('acceptance manifest refuses a symlink into the production Bob profile', {skip: process.platform === 'win32'}, () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-app-data-link-'));
  const production = path.join(appDataPath, 'Bob LearnHNS');
  fs.mkdirSync(production);
  const aliasParent = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-profile-alias-'));
  const alias = path.join(aliasParent, 'acceptance');
  fs.symlinkSync(production, alias, 'dir');
  const {manifest, manifestPath} = acceptanceManifest(alias);
  assert.throws(() => loadAcceptanceConfig({
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
    BOB_ACCEPTANCE_USER_DATA: manifest.userData,
    BOB_ACCEPTANCE_MANIFEST: manifestPath,
    BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
  }, {appDataPath}), /refuses the production Bob profile/);
});

test('acceptance manifest refuses symlinked children inside an otherwise isolated profile', {skip: process.platform === 'win32'}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-acceptance-child-link-'));
  const {manifest, manifestPath} = acceptanceManifest(root);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-elsewhere-'));
  fs.symlinkSync(elsewhere, path.join(manifest.userData, 'db'), 'dir');
  assert.throws(() => loadAcceptanceConfig({
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
    BOB_ACCEPTANCE_USER_DATA: manifest.userData,
    BOB_ACCEPTANCE_MANIFEST: manifestPath,
    BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
  }, {appDataPath: path.join(root, 'unrelated-app-data')}), /cannot contain symbolic links/);
});

test('backend monitor records assertions without hiding console output', () => {
  const lines = [];
  const monitor = createBackendErrorMonitor({writeEvent: line => lines.push(line)});
  monitor.setPhase('shutdown');
  monitor.observeConsoleError(['hsd error', Object.assign(new Error('Pool is not connected!'), {name: 'AssertionError'})]);
  assert.equal(monitor.snapshot().length, 1);
  assert.equal(monitor.snapshot()[0].phase, 'shutdown');
  assert.match(lines[0], /BOB_PACKAGED_TEST_EVENT/);
});

test('successful report still fails on a structured shutdown assertion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-smoke-regression-'));
  const reportPath = path.join(root, 'report.json');
  const fixture = path.join(__dirname, 'fixtures', 'smoke-shutdown-assertion.cjs');
  const result = await runChild({
    executable: process.execPath,
    args: [fixture],
    env: {...process.env, BOB_SMOKE_REPORT: reportPath},
    timeoutMs: 5000,
  });
  assert.throws(() => validateSmokeResult({
    ...result,
    reportPath,
    smokeProfile: 'existing-p2p-spv',
  }), /structuredBackendErrors=1/);
});

test('acceptance wallet policy blocks direct IPC bypass of signing, broadcast, and seed import', async () => {
  const called = [];
  const wrapped = wrapAcceptanceWalletMethods({
    getWalletInfo: async () => 'safe-read',
    importSeed: async () => called.push('importSeed'),
    sendBid: async () => called.push('sendBid'),
    broadcastPreparedBidMany: async () => called.push('broadcast'),
  }, true);
  assert.equal(await wrapped.getWalletInfo(), 'safe-read');
  await assert.rejects(wrapped.importSeed(), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.sendBid(), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.broadcastPreparedBidMany(), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.deepEqual(called, []);
});

test('acceptance node policy pins regtest P2P and blocks broadcast below the UI', async () => {
  const starts = [];
  const node = {
    connectionProvider: async () => ({type: 'P2P'}),
    start: async network => starts.push(network),
    broadcastRawTx: async () => 'sent',
  };
  installAcceptanceBackendPolicy({node: {service: node}}, {scenario: 'multiwallet'});
  await node.start('regtest');
  await assert.rejects(node.start('main'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(node.broadcastRawTx('00'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.deepEqual(starts, ['regtest']);
});

test('acceptance policy blocks direct Shakedex transaction methods', async () => {
  let fulfilled = false;
  const wrapped = wrapBlockedMethods({
    getListings: async () => ['safe-read'],
    fulfillSwap: async () => { fulfilled = true; },
    launchAuction: async () => { fulfilled = true; },
  }, ['fulfillSwap', 'launchAuction'], 'Shakedex', true);
  assert.deepEqual(await wrapped.getListings(), ['safe-read']);
  await assert.rejects(wrapped.fulfillSwap(), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.launchAuction(), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.equal(fulfilled, false);
});

test('acceptance startup opens the renderer before waiting for wallet fixture readiness', async () => {
  let windowShown = false;
  let fixturePublished = false;
  let releaseWallet;
  const walletReady = new Promise(resolve => { releaseWallet = resolve; });
  const startup = initializeAcceptanceAfterWindow({
    showMainWindow() {
      windowShown = true;
      return {id: 'acceptance-window'};
    },
    async seedFixture() {
      assert.equal(windowShown, true);
      await walletReady;
      return {walletIds: ['acceptance-primary', 'acceptance-secondary']};
    },
    async publishReady(fixture) {
      fixturePublished = true;
      assert.equal(fixture.walletIds.length, 2);
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(windowShown, true);
  assert.equal(fixturePublished, false);
  releaseWallet();
  assert.deepEqual(await startup, {id: 'acceptance-window'});
  assert.equal(fixturePublished, true);
});

test('acceptance hsd options ignore inherited environment, argv, and config files', () => {
  const Config = require('bcfg');
  const isolatedPrefix = path.join(os.tmpdir(), 'bob-isolated-hsd');
  const options = constrainHsdOptions({
    config: path.join(os.tmpdir(), 'hostile-hsd.conf'),
    argv: ['node', 'test', '--network=main', '--prefix=/tmp/argv-profile'],
    env: {HSD_NETWORK: 'main', HSD_PREFIX: '/tmp/env-profile'},
    network: 'main',
    prefix: '/tmp/injected-profile',
  }, true, isolatedPrefix);
  const config = new Config('hsd', {
    suffix: 'network',
    fallback: 'main',
    alias: {n: 'network'},
  });
  config.inject(options);
  config.load(options);
  assert.equal(options.config, false);
  assert.equal(options.argv, false);
  assert.equal(options.env, false);
  assert.equal(config.getSuffix(), 'regtest');
  assert.equal(config.prefix, path.join(isolatedPrefix, 'regtest'));
  assert.equal(config.prefix.includes('argv-profile'), false);
  assert.equal(config.prefix.includes('env-profile'), false);
});

test('acceptance launcher strips inherited hsd settings', () => {
  assert.deepEqual(sanitizeAcceptanceEnvironment({
    PATH: '/bin',
    HSD_NETWORK: 'main',
    HSD_PREFIX: '/real-wallet',
    HSD_API_KEY: 'not-for-acceptance',
  }), {PATH: '/bin'});
});

test('acceptance DB IPC cannot mutate critical node or profile settings', async () => {
  const writes = [];
  const deletes = [];
  const wrapped = wrapAcceptanceDbMethods({
    put: async (key, value) => writes.push([key, value]),
    del: async key => deletes.push(key),
    get: async () => null,
  }, true);
  await wrapped.put('locale', 'zh');
  await assert.rejects(wrapped.put('network', 'main'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.put('hsdPrefixDir', '/real-wallet'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.put('nodeSpvMode', '0'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.del('connection_type'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.deepEqual(writes, [['locale', 'zh']]);
  assert.deepEqual(deletes, []);
});

test('acceptance node directory rejects symlink replacement', {skip: process.platform === 'win32'}, () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-acceptance-user-data-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-real-profile-'));
  const hsdDirectory = path.join(userData, 'acceptance-hsd-profile');
  fs.symlinkSync(elsewhere, hsdDirectory, 'dir');
  assert.throws(
    () => assertAcceptanceHsdDirectory(userData, hsdDirectory),
    {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'},
  );
});
