import EventEmitter from 'events';
import test from 'tape';

import {ConnectionTypes} from '../../connections/service';
import {NodeService} from '../service';

const EXISTING_P2P_SPV_PROFILE = Object.freeze({
  connection: {type: ConnectionTypes.P2P, apiKey: 'fixture-node-api-key'},
  networkName: 'main',
  spv: true,
  noDns: true,
});

class FixtureNodeClient extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.opened = false;
    this.closed = false;
    FixtureNodeClient.instances.push(this);
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.closed = true;
  }

  bind(event, listener) {
    this.on(event, listener);
  }
}

function resetFixtureClients() {
  FixtureNodeClient.instances = [];
}

function configureFixtureProfile(service, profile = EXISTING_P2P_SPV_PROFILE) {
  service.setNetworkAndNodeOptions = async networkName => {
    service.networkName = networkName;
    service.network = {rpcPort: 12037, walletPort: 12039};
    service.apiKey = profile.connection.apiKey;
    service.noDns = profile.noDns;
    service.spv = profile.spv;
  };
  service.refreshNodeInfo = async () => {};
}

test('existing-profile local P2P/SPV startup does not require a transaction client', async t => {
  resetFixtureClients();
  let localStarts = 0;
  const service = new NodeService({
    connectionProvider: async () => EXISTING_P2P_SPV_PROFILE.connection,
    nodeClientClass: FixtureNodeClient,
  });
  configureFixtureProfile(service);
  service.startNode = async () => {
    localStarts++;
  };

  await service.start(EXISTING_P2P_SPV_PROFILE.networkName);

  t.equal(localStarts, 1, 'starts the existing local SPV profile');
  t.equal(service.connectionType, ConnectionTypes.P2P);
  t.equal(service.transactionClient, null, 'local mode has no custom transaction client');
  t.ok(service.client.opened, 'opens the local node client');
  t.equal(
    service.getBroadcastClient(120000),
    service.client,
    'long local broadcasts use the local client',
  );
  t.equal(FixtureNodeClient.instances.length, 1, 'creates only the local client');
  await service.stop();
  t.end();
});

test('local client startup succeeds when transactionClient is absent', async t => {
  resetFixtureClients();
  const service = new NodeService({nodeClientClass: FixtureNodeClient});
  configureFixtureProfile(service);
  await service.setNetworkAndNodeOptions('main');

  await service.setHSDLocalClient();

  t.ok(service.client.opened);
  t.equal(service.transactionClient, null);
  t.equal(service.client.listenerCount('error'), 1, 'the local client owns its error handler');
  await service.stop();
  t.end();
});

test('Custom RPC startup creates a dedicated 120-second transaction client', async t => {
  resetFixtureClients();
  const customRPC = {
    type: ConnectionTypes.Custom,
    protocol: 'https',
    host: 'rpc.fixture.invalid',
    port: '443',
    pathname: '/hsd',
    apiKey: 'fixture-custom-api-key',
  };
  const service = new NodeService({
    connectionProvider: async () => customRPC,
    customRPCProvider: async () => customRPC,
    nodeClientClass: FixtureNodeClient,
  });
  configureFixtureProfile(service, {
    ...EXISTING_P2P_SPV_PROFILE,
    connection: customRPC,
  });

  await service.start('main');

  t.equal(FixtureNodeClient.instances.length, 2);
  t.equal(service.client.options.timeout, 30000, 'normal RPC client keeps the short timeout');
  t.equal(service.transactionClient.options.timeout, 120000, 'transaction RPC gets 120 seconds');
  t.equal(service.client.listenerCount('error'), 1);
  t.equal(service.transactionClient.listenerCount('error'), 1);
  t.ok(service.client.opened && service.transactionClient.opened);
  t.equal(
    service.getBroadcastClient(120000),
    service.transactionClient,
    'long Custom RPC broadcasts use the transaction client',
  );
  t.equal(
    service.getBroadcastClient(30000),
    service.client,
    'ordinary Custom RPC calls use the normal client',
  );
  await service.stop();
  t.end();
});

test('shutdown closes local and Custom RPC resources without fixture data', async t => {
  resetFixtureClients();
  const local = new NodeService({nodeClientClass: FixtureNodeClient});
  configureFixtureProfile(local);
  await local.setNetworkAndNodeOptions('main');
  let hsdClosed = false;
  local.hsd = {close: async () => { hsdClosed = true; }};
  await local.setHSDLocalClient();
  const localClient = local.client;

  await local.stop();

  t.ok(localClient.closed, 'closes the local RPC client');
  t.ok(hsdClosed, 'closes the local SPV node');
  t.equal(local.client, null);
  t.equal(local.transactionClient, null);
  t.equal(local.hsd, null);

  resetFixtureClients();
  const customRPC = {
    protocol: 'http',
    host: '127.0.0.1',
    port: '12037',
    pathname: '/',
    apiKey: 'fixture-custom-api-key',
  };
  const custom = new NodeService({
    customRPCProvider: async () => customRPC,
    nodeClientClass: FixtureNodeClient,
  });
  custom.refreshNodeInfo = async () => {};
  await custom.setCustomRPCClient();
  const normalClient = custom.client;
  const transactionClient = custom.transactionClient;

  await custom.stop();

  t.ok(normalClient.closed, 'closes the normal Custom RPC client');
  t.ok(transactionClient.closed, 'closes the transaction Custom RPC client');
  t.equal(custom.client, null);
  t.equal(custom.transactionClient, null);
  t.end();
});

// Use the real NodeService stop implementation with inert resources only.
test('partial node shutdown retains failed handles and retries only unfinished closures', async t => {
  const service = new NodeService({nodeClientClass: FixtureNodeClient});
  const calls = {rpc: 0, transaction: 0, hsd: 0};
  const rpc = {close: async () => {if (++calls.rpc === 1) throw new Error('RPC close failed');}};
  const transaction = {close: async () => {calls.transaction++;}};
  const hsd = {close: async () => {if (++calls.hsd === 1) throw new Error('HSD close failed');}};
  service.client = rpc;
  service.transactionClient = transaction;
  service.hsd = hsd;
  service.connectionType = ConnectionTypes.P2P;
  let stopped = 0;
  service.on('stopped', () => {stopped++;});
  try {await service.stop(); t.fail('must reject partial closure');}
  catch (error) {t.equal(error.message, 'RPC close failed');}
  t.equal(service.client, rpc, 'failed RPC handle survives');
  t.equal(service.hsd, hsd, 'failed HSD handle survives');
  t.equal(service.transactionClient, null, 'successful handle is cleared');
  t.equal(stopped, 0, 'no stopped notification on failure');
  await service.stop();
  t.deepEqual(calls, {rpc: 2, transaction: 1, hsd: 2});
  t.equal(service.client, null);
  t.equal(service.hsd, null);
  t.equal(stopped, 1);
  await service.stop();
  t.deepEqual(calls, {rpc: 2, transaction: 1, hsd: 2}, 'completed handles are not closed again');
  t.end();
});

test('persistent node close failure keeps updater shutdown fenced and prevents staging', async t => {
  const {createShutdownSequence} = require('../../updates/shutdown');
  const {UpdateController} = require('../../updates/controller');
  const {UpdateGate} = require('../../updates/gate');
  const service = new NodeService({nodeClientClass: FixtureNodeClient});
  let mayClose = false;
  let closes = 0;
  service.hsd = {close: async () => {closes++; if (!mayClose) throw new Error('Still open');}};
  let appClosed = 0;
  let staged = 0;
  let quit = 0;
  const shutdown = createShutdownSequence([() => service.stop(), () => {appClosed++;}]);
  const gate = new UpdateGate();
  const c = new UpdateController({gate, isBusy: () => false, shutdown, quit: () => {quit++;}});
  c.state = {stage: 'downloaded'};
  c.updater = {stage: async () => {staged++;}, install: () => t.fail('unexpected install')};
  await c.install();
  await c.close();
  t.equal(closes, 2, 'recovery retries the same still-open resource');
  t.equal(c.state.stage, 'installFailed');
  t.equal(appClosed, 0);
  t.equal(staged, 0);
  t.equal(quit, 0);
  t.ok(gate.closing);
  mayClose = true;
  await c.close();
  t.equal(closes, 3);
  t.equal(service.hsd, null);
  t.equal(appClosed, 1);
  t.equal(quit, 1);
  t.equal(staged, 0, 'Finish closing does not stage the update');
  t.ok(gate.closing);
  t.end();
});


test('node stop awaits wallet closure and shares concurrent shutdown attempts', async t => {
  const service = new NodeService({nodeClientClass: FixtureNodeClient});
  let release;
  let walletCloses = 0;
  let stopped = 0;
  service.on('stopped', () => {stopped++;});
  service.stopWallet = async () => {
    walletCloses++;
    if (walletCloses === 1) throw new Error('Wallet remains open');
    await new Promise(resolve => {release = resolve;});
  };
  try {await service.stop(); t.fail('wallet failure must reject stop');}
  catch (error) {t.equal(error.message, 'Wallet remains open');}
  t.equal(stopped, 0);
  const attempt = service.stop();
  t.equal(service.stop(), attempt, 'concurrent stop shares one closure');
  await new Promise(resolve => setTimeout(resolve, 0));
  t.equal(walletCloses, 2);
  t.equal(stopped, 0, 'stop has not finished while wallet closure is pending');
  release();
  await attempt;
  t.equal(stopped, 1);
  t.end();
});


test('a node that clears opened before failing stays retained and blocks shutdown', async t => {
  const service = new NodeService({nodeClientClass: FixtureNodeClient});
  const hsd = {opened: true, close: async () => {
    if (!hsd.opened) throw new Error('Node is not open');
    hsd.opened = false;
    throw new Error('Database close failed');
  }};
  service.hsd = hsd;
  for (const message of ['Database close failed', 'Node is not open']) {
    try {await service.stop(); t.fail('must not infer closed from opened=false');}
    catch (error) {t.equal(error.message, message);}
    t.equal(service.hsd, hsd);
  }
  t.end();
});
