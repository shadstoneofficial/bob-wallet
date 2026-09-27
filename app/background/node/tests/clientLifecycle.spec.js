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
