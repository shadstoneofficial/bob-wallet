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
  installAcceptanceBackendPolicy,
  wrapBlockedMethods,
  wrapAcceptanceWalletMethods,
};
