const fs = require('fs');
const path = require('path');

const BLOCKED_WALLET_METHODS = new Set([
  'setAPIKey',
  'createNewWallet',
  'importSeed',
  'generateReceivingAddress',
  'setAddressMetadata',
  'setPassphrase',
  'revealSeed',
  'removeWalletById',
  'updateAccountDepth',
  'findNonce',
  'findNonceCancel',
  'encryptWallet',
  'backup',
  'rescan',
  'deepClean',
  'sendOpen',
  'sendOpenMany',
  'sendBid',
  'sendRegister',
  'sendUpdate',
  'sendReveal',
  'sendRedeem',
  'sendRevealAll',
  'sendRevealMany',
  'sendBidMany',
  'prepareBidMany',
  'cancelBidManyAttempt',
  'broadcastPreparedBidMany',
  'sendRedeemAll',
  'sendRegisterAll',
  'sendRenewal',
  'transferMany',
  'finalizeAll',
  'finalizeMany',
  'renewAll',
  'renewMany',
  'sendTransfer',
  'cancelTransfer',
  'finalizeTransfer',
  'finalizeWithPayment',
  'claimPaidTransfer',
  'signMessageWithName',
  'revokeName',
  'send',
  'createLiquidityHnsSwapKey',
  'createLiquidityHnsLock',
  'createLiquidityHnsClaim',
  'createLiquidityHnsRefund',
  'addSharedKey',
  'removeSharedKey',
  'getNonce',
  'importNonce',
  'zap',
  'importName',
  'importNames',
  'loadTransaction',
  'createClaim',
  'sendClaim',
]);

const PROTECTED_DB_KEYS = new Set([
  'connection_type',
  'network',
  'hsdPrefixDir',
  'nodeSpvMode',
  'nodeNoDns1',
  'nodeApiKey',
  'walletApiKey',
  'nodeSpvHelperApiBaseUrl',
]);

function blocked(operation) {
  const error = new Error(`Packaged acceptance policy blocked ${operation}.`);
  error.code = 'ERR_PACKAGED_ACCEPTANCE_POLICY';
  throw error;
}

function wrapAcceptanceWalletMethods(methods, active) {
  if (!active) return methods;
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [
    name,
    BLOCKED_WALLET_METHODS.has(name) ? async () => blocked(`Wallet.${name}`) : method,
  ]));
}

function wrapBlockedMethods(methods, blockedNames, serviceName, active) {
  if (!active) return methods;
  const denied = new Set(blockedNames);
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [
    name,
    denied.has(name) ? async () => blocked(`${serviceName}.${name}`) : method,
  ]));
}

function isApprovedAcceptanceDbWrite(key, value, {expectedHsdPrefix} = {}) {
  switch (key) {
    case 'connection_type':
      return value === 'P2P';
    case 'network':
      return value === 'regtest';
    case 'nodeSpvMode':
    case 'nodeNoDns1':
      return value === '1';
    case 'hsdPrefixDir':
      return Boolean(expectedHsdPrefix)
        && typeof value === 'string'
        && path.resolve(value) === path.resolve(expectedHsdPrefix);
    default:
      return false;
  }
}

function wrapAcceptanceDbMethods(methods, active, options = {}) {
  if (!active) return methods;
  return {
    ...methods,
    async put(key, value) {
      if (PROTECTED_DB_KEYS.has(key)
          && !isApprovedAcceptanceDbWrite(key, value, options)) {
        blocked(`DB.put(${key})`);
      }
      return methods.put(key, value);
    },
    async del(key) {
      if (PROTECTED_DB_KEYS.has(key)) blocked(`DB.del(${key})`);
      return methods.del(key);
    },
  };
}

function sanitizeAcceptanceEnvironment(environment) {
  const sanitized = {...environment};
  for (const name of Object.keys(sanitized)) {
    if (name.startsWith('HSD_')) delete sanitized[name];
  }
  return sanitized;
}

function constrainHsdOptions(options, active, prefix) {
  if (!active) return options;
  return {
    ...options,
    config: false,
    argv: false,
    env: false,
    network: 'regtest',
    prefix,
    noDns: true,
    listen: true,
  };
}

function assertAcceptanceHsdDirectory(userData, hsdDirectory) {
  const expected = path.join(userData, 'acceptance-hsd-profile');
  if (path.resolve(hsdDirectory) !== path.resolve(expected)) {
    blocked(`Node prefix ${hsdDirectory}`);
  }
  for (const candidate of [userData, hsdDirectory]) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      blocked(`symbolic-link node path ${candidate}`);
    }
  }
  if (fs.existsSync(userData) && fs.existsSync(hsdDirectory)) {
    const physicalUserData = fs.realpathSync(userData);
    const physicalDirectory = fs.realpathSync(hsdDirectory);
    const relative = path.relative(physicalUserData, physicalDirectory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      blocked(`Node prefix outside disposable profile ${physicalDirectory}`);
    }
  }
  return expected;
}

function installAcceptanceBackendPolicy(services, config) {
  if (!config) return;
  const node = services.node.service;
  const originalStart = node.start.bind(node);
  node.start = async networkName => {
    if (networkName !== 'regtest') blocked(`Node.start(${networkName})`);
    const connection = await node.connectionProvider();
    if (connection.type !== 'P2P') blocked(`Node connection ${connection.type}`);
    return originalStart(networkName);
  };

  for (const method of [
    'broadcastRawTx',
    'sendRawAirdrop',
    'sendRawClaim',
    'testCustomRPCClient',
    'setNodeDir',
    'setAPIKey',
    'setNoDns',
    'setSpvMode',
    'setSpvHelperApiBaseUrl',
    'resetSpvHelperApiBaseUrl',
    'validateSpvHelperApiBaseUrl',
  ]) {
    node[method] = async () => blocked(`Node.${method}`);
  }
}

module.exports = {
  BLOCKED_WALLET_METHODS,
  PROTECTED_DB_KEYS,
  assertAcceptanceHsdDirectory,
  constrainHsdOptions,
  installAcceptanceBackendPolicy,
  isApprovedAcceptanceDbWrite,
  sanitizeAcceptanceEnvironment,
  wrapAcceptanceDbMethods,
  wrapBlockedMethods,
  wrapAcceptanceWalletMethods,
};
