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
const {
  BASKET_NAMES,
  SCENARIO_DEFINITIONS,
  buildControlledScenarioPlan,
  createGeneratedRestoreHistory,
  executeControlledSourceFixture,
} = require('../../app/background/packagedAcceptance/scenarios');

function acceptanceManifest(root) {
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(userData);
  const manifest = {
    version: 1,
    purpose: 'bob-packaged-acceptance',
    scenario: 'multiwallet',
    nodeMode: 'spv',
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

test('acceptance manifest rejects networked transaction fixtures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-acceptance-reject-'));
  const {manifest, manifestPath} = acceptanceManifest(root);
  manifest.scenario = 'basket-ambiguous';
  manifest.transactionMode = 'enabled';
  manifest.externalTransactionNetwork = true;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadAcceptanceConfig({
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
    BOB_ACCEPTANCE_USER_DATA: manifest.userData,
    BOB_ACCEPTANCE_MANIFEST: manifestPath,
    BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
  }, {appDataPath: root}), /requires regtest with transaction fixtures disabled/);
});

test('acceptance manifest rejects unknown scenarios and mismatched node modes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-acceptance-scenario-'));
  const {manifest, manifestPath} = acceptanceManifest(root);
  manifest.scenario = 'caller-controlled-scenario';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const environment = {
    BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
    BOB_ACCEPTANCE_USER_DATA: manifest.userData,
    BOB_ACCEPTANCE_MANIFEST: manifestPath,
    BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
  };
  assert.throws(() => loadAcceptanceConfig(environment, {appDataPath: root}), /Unsupported packaged acceptance scenario/);

  manifest.scenario = 'restore-full';
  manifest.nodeMode = 'spv';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadAcceptanceConfig(environment, {appDataPath: root}), /requires full node mode/);
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
  await wrapped.put('network', 'regtest');
  await wrapped.put('connection_type', 'P2P');
  await wrapped.put('nodeSpvMode', '1');
  await wrapped.put('nodeNoDns1', '1');
  await assert.rejects(wrapped.put('network', 'main'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.put('hsdPrefixDir', '/real-wallet'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.put('nodeSpvMode', '0'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  await assert.rejects(wrapped.del('connection_type'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.deepEqual(writes, [
    ['locale', 'zh'],
    ['network', 'regtest'],
    ['connection_type', 'P2P'],
    ['nodeSpvMode', '1'],
    ['nodeNoDns1', '1'],
  ]);
  assert.deepEqual(deletes, []);
});

test('full-node acceptance policy permits only the fixed full-node value', async () => {
  const writes = [];
  const wrapped = wrapAcceptanceDbMethods({
    put: async (key, value) => writes.push([key, value]),
    del: async () => {},
  }, true, {expectedNodeMode: 'full'});
  await wrapped.put('nodeSpvMode', '0');
  await assert.rejects(wrapped.put('nodeSpvMode', '1'), {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'});
  assert.deepEqual(writes, [['nodeSpvMode', '0']]);
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

test('renderer startup reaches fake node and wallet IPC only with approved regtest settings', async () => {
  require('@babel/register')({extensions: ['.js']});
  const Module = require('module');
  const {SIGIL} = require('../../app/background/ipc/ipc');
  const originalLoad = Module._load;
  const listeners = new Map();
  let nextListener = 0;
  const starts = [];
  const stored = new Map([
    ['network', 'regtest'],
    ['watchlist:regtest', []],
  ]);
  const db = wrapAcceptanceDbMethods({
    async get(key) { return stored.has(key) ? stored.get(key) : null; },
    async put(key, value) { stored.set(key, value); },
    async del(key) { stored.delete(key); },
  }, true);
  const methods = {
    'DB.get': key => db.get(key),
    'DB.put': (key, value) => db.put(key, value),
    'Node.start': async network => { starts.push(network); },
    'Node.getInfo': async () => ({network: 'regtest', chain: {height: 0}}),
    'Node.getFees': async () => ({rate: 0}),
    'Node.getSpvMode': async () => true,
    'Wallet.isReady': async () => 'regtest',
  };
  const ipcRenderer = {
    send(channel, request) {
      if (channel !== SIGIL) throw new Error(`Unexpected IPC channel: ${channel}`);
      Promise.resolve()
        .then(() => {
          const method = methods[request.method];
          if (!method) throw new Error(`Unexpected IPC method: ${request.method}`);
          return method(...request.params);
        })
        .then(result => ({jsonrpc: '2.0', result, id: request.id}))
        .catch(error => ({
          jsonrpc: '2.0',
          error: {code: error.code || -1, message: error.message},
          id: request.id,
        }))
        .then(response => {
          for (const listener of listeners.values()) listener(null, JSON.stringify(response));
        });
    },
    on(channel, listener) {
      if (channel !== SIGIL) throw new Error(`Unexpected IPC channel: ${channel}`);
      const id = ++nextListener;
      listeners.set(id, listener);
      return ipcRenderer;
    },
    off(channel, listener) {
      if (channel !== SIGIL) throw new Error(`Unexpected IPC channel: ${channel}`);
      for (const [id, candidate] of listeners) {
        if (candidate === listener) listeners.delete(id);
      }
      return ipcRenderer;
    },
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return {ipcRenderer, app: {isPackaged: true}};
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const {startApp} = require('../../app/ducks/node');
    const actions = [];
    const dispatch = action => {
      if (typeof action === 'function') return action(dispatch);
      actions.push(action);
      return action;
    };
    await startApp()(dispatch);
    await startApp('regtest')(dispatch);
    assert.deepEqual(starts, ['regtest', 'regtest']);

    await assert.rejects(
      startApp('main')(dispatch),
      {code: 'ERR_PACKAGED_ACCEPTANCE_POLICY'},
    );
    assert.deepEqual(starts, ['regtest', 'regtest']);
  } finally {
    Module._load = originalLoad;
  }
});

test('controlled scenarios are fixed, regtest-only, and contain no signing or broadcast capability', () => {
  assert.deepEqual(Object.keys(SCENARIO_DEFINITIONS).sort(), [
    'auction-retry',
    'basket-20-delayed',
    'basket-ambiguous',
    'multiwallet',
    'restore-full',
    'restore-spv',
  ]);
  for (const scenario of Object.keys(SCENARIO_DEFINITIONS)) {
    const plan = buildControlledScenarioPlan(scenario);
    assert.equal(plan.network, 'regtest');
    assert.equal(plan.externalTransactionNetwork, false);
    assert.equal(plan.signingAllowed, false);
    assert.equal(plan.broadcastAllowed, false);
  }
  assert.equal(BASKET_NAMES.length, 20);
  assert.equal(new Set(BASKET_NAMES).size, 20);
});

test('generated restore history is deterministic and contains no recovery material', () => {
  const first = createGeneratedRestoreHistory('restore-spv');
  const second = createGeneratedRestoreHistory('restore-spv');
  assert.deepEqual(first, second);
  assert.equal(first.entries.length, 12);
  assert.equal(first.containsRecoveryMaterial, false);
  assert.equal(JSON.stringify(first).includes('seed'), false);
  assert.equal(JSON.stringify(first).includes('mnemonic'), false);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
});

test('restore source fixture orchestrates sequential, overlap, failure, and retry without a real wallet', async () => {
  const calls = [];
  const plan = buildControlledScenarioPlan('restore-full');
  const result = await executeControlledSourceFixture(plan, {
    async restoreReplay(request) {
      calls.push({walletId: request.walletId, mode: request.mode, attempt: request.attempt || null});
      assert.equal(request.history.digest, plan.generatedHistory.digest);
      if (request.mode === 'inject-first-failure' && request.attempt === 1) {
        throw new Error('injected source-fixture failure');
      }
      return {ok: true};
    },
  });
  assert.equal(calls.length, 9);
  assert.equal(result.status, 'SOURCE FIXTURE READY');
  assert.equal(result.sequentialResults, 2);
  assert.equal(result.overlappingResults, 5);
  assert.equal(result.firstFailureObserved, true);
  assert.equal(result.retrySucceeded, true);
  assert.equal(result.packagedBackendStatus, 'NOT TESTED');
});

test('restore plan stays pending without the reviewed PR 18 replay capability', async () => {
  const result = await executeControlledSourceFixture(buildControlledScenarioPlan('restore-spv'));
  assert.deepEqual(result, {
    status: 'PENDING',
    reason: 'reviewed-wallet-replay-target-unavailable',
    generatedHistoryDigest: buildControlledScenarioPlan('restore-spv').generatedHistory.digest,
  });
});

test('auction and basket source fixtures are inert and retain fail-closed evidence', async () => {
  const retry = await executeControlledSourceFixture(buildControlledScenarioPlan('auction-retry'));
  assert.equal(retry.retainedError.code, 'ERR_ACCEPTANCE_PRE_SIGN');
  assert.equal(retry.reviewAttempts, 2);
  assert.equal(retry.retryAvailable, true);
  assert.equal(retry.signingCalls, 0);
  assert.equal(retry.broadcastCalls, 0);

  const delayed = await executeControlledSourceFixture(buildControlledScenarioPlan('basket-20-delayed'));
  assert.equal(delayed.namesPreserved, 20);
  assert.equal(delayed.constructionCalls, 1);
  assert.equal(delayed.cancellationStopsContinuation, true);
  assert.equal(delayed.signingCalls, 0);
  assert.equal(delayed.broadcastCalls, 0);

  const ambiguous = await executeControlledSourceFixture(buildControlledScenarioPlan('basket-ambiguous'));
  assert.equal(ambiguous.boundaryCalls, 1);
  assert.equal(ambiguous.outcome, 'unknown');
  assert.equal(ambiguous.retryLocked, true);
  assert.equal(ambiguous.signingCalls, 0);
  assert.equal(ambiguous.liveBroadcastCalls, 0);
});
