const GUARDED_SERVER = Symbol('bob.websocket-upgrade-policy');

const UNSUPPORTED_VERSION_RESPONSE = [
  'HTTP/1.1 426 Upgrade Required',
  'Connection: close',
  'Sec-WebSocket-Version: 13',
  'Content-Length: 0',
  '',
  '',
].join('\r\n');

function isUnsupportedWebSocketUpgrade(request) {
  const headers = request && request.headers;
  if (!headers || `${headers.upgrade || ''}`.toLowerCase() !== 'websocket') {
    return false;
  }

  return headers['sec-websocket-version'] !== '13';
}

function rejectUpgrade(socket) {
  if (!socket || socket.destroyed) return;

  try {
    if (typeof socket.end === 'function') {
      socket.end(UNSUPPORTED_VERSION_RESPONSE);
    } else if (typeof socket.destroy === 'function') {
      socket.destroy();
    }
  } catch (error) {
    socket.destroy?.();
  }
}

function installWebSocketUpgradePolicy(server) {
  if (!server || typeof server.emit !== 'function') {
    throw new TypeError('An HTTP server is required for the WebSocket policy.');
  }
  if (server[GUARDED_SERVER]) return false;

  const emit = server.emit;
  server.emit = function emitWithWebSocketPolicy(event, ...args) {
    if (event === 'upgrade' && isUnsupportedWebSocketUpgrade(args[0])) {
      rejectUpgrade(args[1]);
      return false;
    }

    return emit.call(this, event, ...args);
  };

  Object.defineProperty(server, GUARDED_SERVER, {value: true});
  return true;
}

function installHsdWebSocketUpgradePolicies(node) {
  const walletPlugin = node && typeof node.get === 'function'
    ? node.get('walletdb')
    : null;
  const servers = [
    node && node.http && node.http.http,
    walletPlugin && walletPlugin.http && walletPlugin.http.http,
  ];

  if (servers.some(server => !server || typeof server.emit !== 'function')) {
    throw new Error('Could not install WebSocket policy on both HSD HTTP servers.');
  }

  return servers.map(installWebSocketUpgradePolicy);
}

module.exports = {
  installHsdWebSocketUpgradePolicies,
  installWebSocketUpgradePolicy,
  isUnsupportedWebSocketUpgrade,
};
