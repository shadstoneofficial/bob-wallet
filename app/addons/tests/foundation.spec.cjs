// Run: node app/addons/tests/foundation.spec.cjs
require('@babel/register')({
  configFile: false,
  babelrc: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}]],
});

const assert = require('node:assert/strict');
const {
  AddonRegistry,
  createCatalogEntries,
  validateManifest,
} = require('../foundation');
const {
  BUILTIN_ADDON_MANIFESTS,
  builtInAddonRegistry,
  createBuiltInCatalog,
} = require('../manifests');
const {EXAMPLE_ADDON_MANIFESTS} = require('../examples');

function baseManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'test-addon',
    name: 'Test Add-On',
    publisher: {name: 'Test publisher'},
    version: '1.2.3',
    description: 'A deterministic test manifest.',
    entry: {kind: 'trusted-bundled-route', route: '/test-addon'},
    capabilities: [],
    origins: [],
    networks: ['main'],
    ...overrides,
  };
}

function expectCode(callback, code) {
  assert.throws(callback, error => error && error.code === code, code);
}

function testManifestValidation() {
  const manifest = validateManifest(baseManifest());
  assert.equal(manifest.id, 'test-addon');
  assert(Object.isFrozen(manifest));
  assert(Object.isFrozen(manifest.entry));
  assert(Object.isFrozen(manifest.capabilities));

  expectCode(() => validateManifest(baseManifest({schemaVersion: 2})), 'ESCHEMAVERSION');
  expectCode(() => validateManifest(baseManifest({id: '../unsafe'})), 'EINVALIDFIELD');
  expectCode(() => validateManifest({...baseManifest(), surprise: true}), 'EUNKNOWNFIELD');
  expectCode(() => validateManifest(baseManifest({version: 'latest'})), 'EINVALIDFIELD');
  expectCode(() => validateManifest(baseManifest({capabilities: ['wallet.seed']})), 'EUNKNOWNCAPABILITY');
  expectCode(() => validateManifest(baseManifest({capabilities: ['external.openUrl', 'external.openUrl']})), 'EDUPLICATECAPABILITY');
  expectCode(() => validateManifest(baseManifest({
    capabilities: ['resolver.requestSystemDnsControl'],
  })), 'ENATIVECAPABILITY');
  expectCode(() => validateManifest(baseManifest({
    entry: {kind: 'external-content', url: 'http://example.com/addon'},
    capabilities: ['external.openUrl'],
    origins: ['http://example.com'],
  })), 'EENTRY');
  expectCode(() => validateManifest(baseManifest({
    entry: {kind: 'external-content', url: 'https://example.com/addon'},
    capabilities: ['external.openUrl'],
    origins: ['https://other.example'],
  })), 'EENTRYORIGIN');
  expectCode(() => validateManifest(baseManifest({
    entry: {kind: 'external-content', url: 'https://example.com/addon'},
    capabilities: [],
    origins: ['https://example.com'],
  })), 'EENTRYCAPABILITY');
  expectCode(() => validateManifest(baseManifest({
    entry: {kind: 'native-service', service: 'system-dns'},
    capabilities: ['resolver.requestSystemDnsControl'],
    origins: ['https://example.com'],
  })), 'EORIGIN');
}

function testRegistry() {
  const first = baseManifest();
  const second = baseManifest({
    id: 'second-addon',
    name: 'Second Add-On',
    entry: {kind: 'trusted-bundled-route', route: '/second'},
  });
  const registry = new AddonRegistry([first, second]);
  assert.equal(registry.get('test-addon').entry.route, '/test-addon');
  assert.equal(registry.has('second-addon'), true);
  assert.deepEqual(registry.list().map(item => item.id), ['test-addon', 'second-addon']);
  expectCode(() => registry.get('missing'), 'EADDONNOTFOUND');
  expectCode(() => new AddonRegistry([first, first]), 'EDUPLICATEID');
}

function testCatalogCompatibility() {
  const catalog = createBuiltInCatalog([
    {manifestId: 'shakedex-marketplace', status: 'Available', action: 'Open'},
    {manifestId: 'send-name', status: 'Available', action: 'Open'},
    {manifestId: 'liquidity-spot', status: 'Public Preview', action: 'Open'},
    {id: 'planned', name: 'Planned', status: 'Planned'},
  ]);
  assert.deepEqual(catalog.slice(0, 3).map(item => ({
    id: item.id,
    href: item.href,
    internal: item.internal,
  })), [
    {id: 'shakedex-marketplace', href: '/exchange', internal: true},
    {id: 'send-name', href: '/send?asset=name&mode=send', internal: true},
    {id: 'liquidity-spot', href: 'https://liquidity.spot/p2p', internal: false},
  ]);
  assert.equal(catalog[3].id, 'planned');
  expectCode(() => createCatalogEntries(builtInAddonRegistry, [{
    manifestId: 'send-name',
    href: '/changed',
  }]), 'ECATALOGOVERRIDE');
  expectCode(() => createCatalogEntries(builtInAddonRegistry, [
    {id: 'same-id', name: 'One'},
    {id: 'same-id', name: 'Two'},
  ]), 'EDUPLICATECATALOGID');
  expectCode(() => createCatalogEntries(builtInAddonRegistry, [
    {id: 'Unsafe ID', name: 'Unsafe'},
  ]), 'EINVALIDFIELD');
}

function testExamplesAreContractsOnly() {
  assert.equal(BUILTIN_ADDON_MANIFESTS.length, 3);
  assert.deepEqual(EXAMPLE_ADDON_MANIFESTS.map(item => item.id), [
    'shakex',
    'bob-name-quest',
    'bob-system-dns',
  ]);
  for (const example of EXAMPLE_ADDON_MANIFESTS) {
    assert.equal(builtInAddonRegistry.has(example.id), false, `${example.id} is not installed`);
  }

  const game = EXAMPLE_ADDON_MANIFESTS.find(item => item.id === 'bob-name-quest');
  assert.deepEqual(game.capabilities, ['external.openUrl']);
  assert.equal(game.capabilities.some(value => value.startsWith('wallet.')), false);

  const resolver = EXAMPLE_ADDON_MANIFESTS.find(item => item.id === 'bob-system-dns');
  assert.equal(resolver.entry.kind, 'native-service');
  assert(resolver.capabilities.includes('resolver.requestSystemDnsControl'));
  assert.deepEqual(resolver.origins, []);

  const shakex = EXAMPLE_ADDON_MANIFESTS.find(item => item.id === 'shakex');
  assert.equal(shakex.entry.route, '/addons/shakex');
  assert.deepEqual(shakex.origins, ['https://shakex.fun']);
}

testManifestValidation();
testRegistry();
testCatalogCompatibility();
testExamplesAreContractsOnly();
console.log('Add-On Foundation checks passed: strict manifests, stable registry IDs, capability/origin policy, catalog navigation compatibility, and non-installed examples.');
