const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  createBackendErrorMonitor,
  loadAcceptanceConfig,
} = require('../../app/background/packagedAcceptance/runtime');
const {
  runChild,
  validateSmokeResult,
} = require('../lib/packaged-smoke-runner.cjs');

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
  assert.equal(config.userData, manifest.userData);
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
