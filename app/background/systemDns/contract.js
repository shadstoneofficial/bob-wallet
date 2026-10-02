const SYNC_COMPLETE_THRESHOLD = 0.99995;

const PHASES = Object.freeze({
  OFF: 'off',
  PREFLIGHT: 'preflight',
  STARTING_BRIDGE: 'starting-bridge',
  CAPTURING_DNS: 'capturing-dns',
  APPLYING_DNS: 'applying-dns',
  VERIFYING: 'verifying',
  ON: 'on',
  RESTORING_DNS: 'restoring-dns',
  STOPPING_BRIDGE: 'stopping-bridge',
  RECONCILING: 'reconciling',
  NEEDS_REPAIR: 'needs-repair',
});

function resolverError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1';
}

function isValidPort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function isChainReady(chain = {}) {
  const {progress, height, bestPeerHeight, synced} = chain;

  if (Number.isFinite(height)
      && Number.isFinite(bestPeerHeight)
      && height < bestPeerHeight) {
    return false;
  }

  if (synced === true) return true;

  return Number.isFinite(progress) && progress >= SYNC_COMPLETE_THRESHOLD;
}

function validateResolverContext(context = {}) {
  if (context.connectionType === 'custom') {
    throw resolverError(
      'ECUSTOMRPC',
      'System DNS is unavailable in Custom RPC mode because Bob does not own a local resolver.',
    );
  }

  if (context.connectionType !== 'p2p') {
    throw resolverError('ENODEMODE', 'Bob must use its local P2P node.');
  }

  if (!['spv', 'full'].includes(context.nodeMode)) {
    throw resolverError('ENODEMODE', 'Bob must use a local SPV or full node.');
  }

  if (context.network !== 'main') {
    throw resolverError('ENETWORK', 'System DNS is supported on Handshake mainnet only.');
  }

  if (context.running !== true) {
    throw resolverError('ENODENOTRUNNING', 'Bob\'s local node is not running.');
  }

  if (context.noDns === true) {
    throw resolverError('EDNSDISABLED', 'Enable Bob\'s internal DNS server first.');
  }

  if (!isLoopbackHost(context.resolverHost)) {
    throw resolverError('EUPSTREAMHOST', 'The Bob resolver must be bound to loopback.');
  }

  if (!isValidPort(context.resolverPort)) {
    throw resolverError('EUPSTREAMPORT', 'Bob did not publish a valid recursive resolver port.');
  }

  if (!isChainReady(context.chain)) {
    throw resolverError('ENOTSYNCED', 'Bob must finish synchronizing before it can own system DNS.');
  }

  return Object.freeze({
    connectionType: context.connectionType,
    nodeMode: context.nodeMode,
    network: context.network,
    resolverHost: context.resolverHost,
    resolverPort: context.resolverPort,
    chain: Object.freeze({...context.chain}),
  });
}

function createInitialStatus() {
  return {
    desiredEnabled: false,
    phase: PHASES.OFF,
    nodeMode: null,
    network: null,
    resolverState: 'stopped',
    recursivePort: null,
    bridgeState: 'stopped',
    bridgePort: null,
    systemState: 'unchanged',
    activeInterfaces: [],
    restoreAvailable: false,
    lastCheckedAt: null,
    lastError: null,
  };
}

function publicStatus(status) {
  return {
    desiredEnabled: status.desiredEnabled,
    phase: status.phase,
    nodeMode: status.nodeMode,
    network: status.network,
    resolverState: status.resolverState,
    bridgeState: status.bridgeState,
    systemState: status.systemState,
    restoreAvailable: status.restoreAvailable,
    lastCheckedAt: status.lastCheckedAt,
    lastError: status.lastError && {
      code: status.lastError.code,
    },
  };
}

module.exports = {
  PHASES,
  SYNC_COMPLETE_THRESHOLD,
  createInitialStatus,
  isChainReady,
  isLoopbackHost,
  isValidPort,
  publicStatus,
  resolverError,
  validateResolverContext,
};

