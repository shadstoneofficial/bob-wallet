const assert = require('node:assert/strict');
const {SystemDnsReadOnlyService, developmentEnabled} = require('../service');

function readyNode(overrides = {}) {
  return {
    connectionType: 'P2P',
    networkName: 'main',
    hsd: {chain: {synced: true, getProgress: () => 1}, pool: {}},
    client: {},
    height: 10,
    getSpvMode: async () => true,
    getNoDns: async () => false,
    getRsPort: () => 10892,
    ...overrides,
  };
}

(async () => {
  const disabled = new SystemDnsReadOnlyService({enabled: () => false});
  assert.equal((await disabled.getStatus()).available, false);
  await assert.rejects(disabled.test(), error => error.code === 'EFEATUREDISABLED');

  const service = new SystemDnsReadOnlyService({
    enabled: () => true,
    node: readyNode(),
    health: async endpoint => ({endpoint, hns: true, icann: true, dnssec: true, tcp: true}),
  });
  const status = await service.getStatus();
  assert.equal(status.available, true);
  assert.equal(Object.hasOwn(status, 'recursivePort'), false);
  assert.equal(Object.hasOwn(status, 'activeInterfaces'), false);
  assert.equal((await service.test()).endpoint.port, 10892);

  const custom = new SystemDnsReadOnlyService({enabled: () => true, node: readyNode({connectionType: 'Custom'})});
  assert.equal((await custom.getStatus()).reason, 'ECUSTOMRPC');
  await assert.rejects(custom.test(), error => error.code === 'ECUSTOMRPC');

  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.BOB_SYSTEM_DNS_DEV;
  process.env.NODE_ENV = 'production';
  process.env.BOB_SYSTEM_DNS_DEV = 'true';
  assert.equal(developmentEnabled(), false, 'production cannot opt into the development gate');
  process.env.NODE_ENV = previousNodeEnv;
  process.env.BOB_SYSTEM_DNS_DEV = previousGate;
  console.log('System DNS read-only service checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
