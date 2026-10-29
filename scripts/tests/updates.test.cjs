const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('@babel/register')({configFile: false, babelrc: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}]]});
const {UpdateGate, walletIsBusy} = require('../../app/background/updates/gate');
const {UpdateController, deadline} = require('../../app/background/updates/controller');
const {validateRelease, validateUpdateInfo, RELEASES_URL} = require('../../app/background/updates/releases');
const {writeManifest} = require('../write-mac-update-manifest.cjs');
const sha512 = Buffer.alloc(64, 1).toString('base64');
const raw = () => ({tag_name: 'v2.3.20', html_url: `${RELEASES_URL}/tag/v2.3.20`, assets:
  ['Bob.LearnHNS-2.3.20-arm64.zip', 'latest-arm64-mac.yml'].map(name => ({name, state: 'uploaded', size: 42,
    browser_download_url: `${RELEASES_URL}/download/v2.3.20/${name}`}))});
const info = () => ({version: '2.3.20', files: [{url: 'Bob.LearnHNS-2.3.20-arm64.zip', size: 42, sha512}]});
function fixture(overrides = {}) {
  const calls = [];
  const gate = new UpdateGate();
  const controller = new UpdateController({version: '2.3.19', arch: 'arm64', enabled: true, installable: true,
    fetchRelease: async () => raw(), gate, isBusy: () => false,
    shutdown: async () => {calls.push('shutdown'); assert.throws(() => gate.enter('Wallet.send'), /closing/);},
    makeUpdater: () => ({check: async () => info(), download: async () => calls.push('download'),
      stage: async () => calls.push('verify'), install: () => calls.push('install'), cancel: () => calls.push('cancel')}),
    ...overrides});
  return {controller, calls, gate};
}

test('manual check/download never stage or restart; install closes wallet before native verification', async () => {
  const {controller: c, calls} = fixture();
  assert.deepEqual(calls, []);
  assert.equal((await c.check()).stage, 'available');
  assert.deepEqual(calls, []);
  await c.download();
  assert.deepEqual(calls, ['download']);
  await c.install();
  assert.deepEqual(calls, ['download', 'shutdown', 'verify', 'install']);
  await assert.rejects(c.install(), /Download/);
});
test('idle gate rejects pending RPCs, mutations, recovery and ambiguous bids', async () => {
  const {controller: c, calls, gate} = fixture();
  await c.check(); await c.download();
  const release = gate.enter('Wallet.send');
  assert.equal((await c.install()).stage, 'downloaded');
  assert.deepEqual(calls, ['download']);
  release(); release();
  assert.equal(gate.active, 0);
  await c.install();
  assert.throws(() => gate.enter('Wallet.importSeed'), /closing/);
  assert.doesNotThrow(() => gate.enter('Updates.getState')());
  const wallet = {recoveryAdmission: {isBusy: () => false}, heightBeforeRescan: null,
    walletMutationCoordinator: {pending: 0}, preparedBidManyAttempts: new Map()};
  assert.equal(walletIsBusy(wallet), false);
  for (const change of [{heightBeforeRescan: 0}, {walletMutationCoordinator: {pending: 1}},
    {registerAllJournal: {active: true}}, {registerAllJournal: {checking: true}},
    {recoveryAdmission: {isBusy: () => true}},
    {preparedBidManyAttempts: new Map([['attempt', {status: 'uncertain'}]])}]) {
    assert.equal(walletIsBusy({...wallet, ...change}), true);
  }
  assert.equal(walletIsBusy(null), true);
});
test('failed shutdown holds fence and never stages or installs', async () => {
  const {controller: c, calls, gate} = fixture({shutdown: async () => {throw new Error('close failed');}});
  await c.check(); await c.download(); await c.install();
  assert.equal(c.state.stage, 'installFailed');
  assert.equal(c.state.error, 'close failed');
  assert.equal(gate.closing, true);
  assert.deepEqual(calls, ['download']);
});
test('test profiles cannot check; manual platforms cannot install; stable downgrades unavailable', async () => {
  await assert.rejects(fixture({enabled: false}).controller.check(), /disabled/);
  const c = fixture({installable: false}).controller;
  await c.check(); await assert.rejects(c.download(), /No installable/);
  assert.equal(validateRelease(raw(), '2.3.21', 'arm64').available, false);
  assert.equal(validateRelease(raw(), '2.3.19', 'x64').installable, false);
});
test('reject prereleases, foreign URLs, duplicate/missing payloads and mismatched manifests', () => {
  for (const change of [{draft: true}, {prerelease: true}, {tag_name: 'v2.4.0-beta.1'}, {html_url: 'https://evil.invalid'}])
    assert.throws(() => validateRelease({...raw(), ...change}, '2.3.19', 'arm64'));
  const release = validateRelease(raw(), '2.3.19', 'arm64');
  validateUpdateInfo(info(), release);
  for (const file of [{url: 'https://evil.invalid/update.zip'}, {url: '../update.zip'}, {size: 43}, {sha512: 'bad'}])
    assert.throws(() => validateUpdateInfo({...info(), files: [{...info().files[0], ...file}]}, release));
  assert.throws(() => validateUpdateInfo({...info(), version: '2.3.21'}, release));
  const duplicate = raw(); duplicate.assets.push(duplicate.assets[0]);
  assert.equal(validateRelease(duplicate, '2.3.19', 'arm64').installable, false);
});
test('download failure cancels and cannot be installed or blindly restarted', async () => {
  const c = fixture({makeUpdater: () => ({check: async () => ({version: 'wrong'}), cancel() {}})}).controller;
  await c.check(); await c.download();
  assert.equal(c.state.stage, 'downloadFailed');
  await assert.rejects(c.install()); await assert.rejects(c.download());
});
test('bounded wait rejects without executing any late install continuation', async () => {
  await assert.rejects(deadline(new Promise(() => {}), 5, 'fixture'), /timed out/);
});

test('real RPC admission releases sync, callback, rejected and resolved calls; blocks late mutations', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../app/background/ipc/ipc.js'), 'utf8');
  const compiled = require('@babel/core').transformSync(source, {configFile: false, babelrc: false,
    presets: [['@babel/preset-env', {targets: {node: 'current'}}]]}).code;
  const exports = {};
  new Function('require', 'exports', 'process', compiled)(name => {
    if (name === 'electron') return {app: {isPackaged: true}};
    if (name === '@sentry/browser') return {captureException() {}};
    throw new Error(name);
  }, exports, process);
  let handler;
  const gate = new UpdateGate();
  const server = exports.makeServer({on: (_, fn) => {handler = fn;}}, () => true, () => {});
  server.setAdmissionGate(gate);
  let callback;
  server.withService('Wallet', {sync: () => 42, callback: cb => {callback = cb;},
    reject: async () => {throw new Error('fixture');}, resolve: async () => 3});
  server.start();
  const results = [];
  const event = {sender: {send: (_, result) => results.push(JSON.parse(result))}};
  const call = name => handler(event, {id: results.length + 1, method: `Wallet.${name}`, params: []});
  call('sync'); assert.equal(gate.active, 0); assert.equal(results[0].result, 42);
  call('callback'); assert.equal(gate.active, 1);
  assert.throws(() => gate.acquire(() => false));
  callback(null, 2); callback(null, 2); assert.equal(gate.active, 0);
  call('reject'); await new Promise(resolve => setImmediate(resolve)); assert.equal(gate.active, 0);
  call('resolve'); await new Promise(resolve => setImmediate(resolve)); assert.equal(gate.active, 0);
  gate.acquire(() => false); call('sync'); assert.match(results.at(-1).error.message, /closing/);
});
test('per-architecture manifests describe exact ZIP bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-update-fixture-'));
  try {
    for (const arch of ['arm64', 'x64']) {
      fs.writeFileSync(path.join(dir, `Bob.LearnHNS-2.3.20-${arch}.zip`), 'inert zip fixture');
      await writeManifest(dir, '2.3.20', arch);
      const yaml = require('js-yaml').load(fs.readFileSync(path.join(dir, `latest-${arch}-mac.yml`), 'utf8'));
      assert.equal(yaml.files[0].size, 17);
      assert.equal(yaml.files[0].sha512, require('crypto').createHash('sha512').update('inert zip fixture').digest('base64'));
    }
  } finally {fs.rmSync(dir, {recursive: true});}
});

test('real updater adapter remains manual and uses native verification only after shutdown', async () => {
  const {EventEmitter} = require('events');
  const native = new EventEmitter();
  const calls = [];
  native.checkForUpdates = () => {calls.push('native-check'); queueMicrotask(() => native.emit('update-downloaded'));};
  native.quitAndInstall = () => calls.push('native-install');
  let instance;
  class FakeUpdater extends EventEmitter {
    constructor() {super(); instance = this;}
    setFeedURL(feed) {this.feed = feed;}
    async checkForUpdates() {return {updateInfo: info()};}
    async downloadUpdate() {calls.push('download'); this.emit('update-downloaded');}
    closeServerIfExists() {calls.push('close-proxy');}
  }
  const source = fs.readFileSync(path.join(__dirname, '../../app/background/updates/service.js'), 'utf8');
  const compiled = require('@babel/core').transformSync(source, {configFile: false, babelrc: false,
    presets: [['@babel/preset-env', {targets: {node: 'current'}}]]}).code;
  const exports = {};
  new Function('require', 'exports', 'process', compiled)(name => {
    if (name === './controller') return {UpdateController};
    if (name === './releases') return {fetchLatestRelease: async () => raw()};
    if (name === './gate') return {UpdateGate, walletIsBusy: () => false};
    if (name === 'electron-updater') return {MacUpdater: FakeUpdater};
    if (name === 'electron') return {autoUpdater: native};
    return require(name);
  }, exports, {arch: 'arm64', platform: 'darwin', resourcesPath: '/inert-fixture'});
  const c = exports.start({setAdmissionGate() {}, withService() {}}, {
    app: {getVersion: () => '2.3.19', isPackaged: true, isInApplicationsFolder: () => true},
    testMode: false, wallet: {}, shutdown: async () => calls.push('shutdown')});
  assert.deepEqual(calls, []);
  await c.check(); await c.download();
  assert.deepEqual(calls, ['download']);
  assert.equal(instance.autoDownload, false); assert.equal(instance.autoInstallOnAppQuit, false);
  assert.equal(instance.allowDowngrade, false); assert.equal(instance.allowPrerelease, false);
  assert.equal(instance.feed.channel, 'latest-arm64');
  assert.equal(instance.feed.url, `${RELEASES_URL}/download/v2.3.20/`);
  await c.install();
  assert.deepEqual(calls, ['download', 'shutdown', 'native-check', 'native-install']);
});

test('updater view renders all four locales and discards late responses after unmount', async () => {
  const React = require('react');
  const source = fs.readFileSync(path.join(__dirname, '../../app/pages/Settings/Updates.js'), 'utf8');
  const compiled = require('@babel/core').transformSync(source, {configFile: false, babelrc: false,
    presets: [['@babel/preset-env', {targets: {node: 'current'}}], '@babel/preset-react']}).code;
  let resolveStatus;
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    if (name === 'react') return React;
    if (name.endsWith('/ipc/ipc')) return {makeClient: () => ({getState: () => new Promise(resolve => {resolveStatus = resolve;})})};
    if (name.endsWith('/i18n')) return {I18nContext: React.createContext({})};
    if (name.endsWith('/Anchor')) return props => React.createElement('a', null, props.children);
    throw new Error(name);
  }, exports);
  const View = exports.default;
  const view = new View({});
  let updates = 0;
  view.setState = () => {updates++;};
  view.componentDidMount(); view.componentWillUnmount(); resolveStatus({stage: 'downloaded'});
  await new Promise(resolve => setImmediate(resolve)); assert.equal(updates, 0);
  for (const locale of ['en', 'zh-CN', 'ru-RU', 'th-TH']) {
    const strings = require(`../../locales/${locale}.json`);
    view.context = {t: (key, ...args) => {let i = 0; return strings[key].replace(/%s/g, () => args[i++]);}};
    view.state = {stage: 'downloaded', version: '2.3.19', target: '2.3.20'};
    const html = require('react-dom/server').renderToStaticMarkup(view.render());
    assert(html.includes(strings.updatesInstall)); assert(html.includes(strings.updatesInstallSafety));
    assert(!html.includes('undefined'));
    view.state = {stage: 'downloading', progress: 25};
    assert(!require('react-dom/server').renderToStaticMarkup(view.render()).includes('<button'));
  }
});
