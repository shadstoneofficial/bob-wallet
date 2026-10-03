const {publicStatus, createInitialStatus, validateResolverContext, resolverError} = require('./contract');
const {runHealthChecks} = require('./health');

const SERVICE_NAME = 'SystemDns';
const developmentEnabled = () => process.env.NODE_ENV !== 'production'
  && process.env.BOB_SYSTEM_DNS_DEV === 'true';
const defaultNodeService = () => require('../node/service').service;

function chainSnapshot(node, info) {
  if (info && info.chain) return {...info.chain};
  const chain = node.hsd && node.hsd.chain;
  const tip = chain && chain.tip;
  return {
    height: Number.isFinite(node.height) ? node.height : tip && tip.height,
    bestPeerHeight: node.hsd && node.hsd.pool && node.hsd.pool.peers
      ? node.hsd.pool.peers.headerChain && node.hsd.pool.peers.headerChain.height
      : undefined,
    progress: chain && typeof chain.getProgress === 'function' ? chain.getProgress() : undefined,
    synced: Boolean(chain && chain.synced),
  };
}

async function getResolverContext(node) {
  const info = node.client && typeof node.getInfo === 'function' ? await node.getInfo() : null;
  const connectionType = node.connectionType === 'P2P'
    ? 'p2p'
    : node.connectionType === 'Custom' ? 'custom' : null;
  return {
    connectionType,
    nodeMode: await node.getSpvMode() ? 'spv' : 'full',
    network: node.networkName,
    running: Boolean(node.hsd && node.client),
    noDns: await node.getNoDns(),
    resolverHost: '127.0.0.1',
    resolverPort: node.getRsPort(),
    chain: chainSnapshot(node, info),
  };
}

class SystemDnsReadOnlyService {
  constructor({node = null, health = runHealthChecks, enabled = developmentEnabled} = {}) {
    this.node = node;
    this.health = health;
    this.enabled = enabled;
  }

  async getStatus() {
    if (!this.enabled()) return {...publicStatus(createInitialStatus()), available: false, reason: 'development-disabled'};
    try {
      const context = validateResolverContext(await getResolverContext(this.node || defaultNodeService()));
      return {...publicStatus({...createInitialStatus(), nodeMode: context.nodeMode, network: context.network, resolverState: 'ready'}), available: true};
    } catch (error) {
      return {...publicStatus({...createInitialStatus(), lastError: error}), available: false, reason: error.code || 'unavailable'};
    }
  }

  async test() {
    if (!this.enabled()) throw resolverError('EFEATUREDISABLED', 'System DNS development checks are disabled.');
    const context = validateResolverContext(await getResolverContext(this.node || defaultNodeService()));
    return this.health({host: context.resolverHost, port: context.resolverPort});
  }
}

const service = new SystemDnsReadOnlyService();
const methods = {getStatus: () => service.getStatus(), test: () => service.test()};
async function start(server) { server.withService(SERVICE_NAME, methods); }

module.exports = {SERVICE_NAME, SystemDnsReadOnlyService, developmentEnabled, getResolverContext, service, start};
