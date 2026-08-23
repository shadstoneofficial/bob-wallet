import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { service as walletService } from '../wallet/service';
import * as shakedexService from '../shakedex/service';
import {balanceSnapshot} from './balanceSnapshot';

const BRIDGE_MANIFEST = 'hns-investments-bridge.json';
const TOKEN_BYTES = 32;

let server = null;
let token = null;
let manifestPath = null;

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function unauthorized(res) {
  writeJson(res, 401, { error: 'Unauthorized' });
}

function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  return token && auth === `Bearer ${token}`;
}

function normalizeHash(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString('hex');
  }
  return String(value);
}

function normalizeName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString('utf8');
  }
  return String(value);
}

function normalizeNameState(domain, wallet) {
  const owner = domain.owner || {};
  return {
    name: normalizeName(domain.name),
    status: domain.transfer ? 'transfer-pending-or-history' : 'owned',
    walletId: wallet.wid,
    walletDisplayName: wallet.displayName || wallet.wid,
    walletEncrypted: !!wallet.encrypted,
    walletWatchOnly: !!wallet.watchOnly,
    height: domain.height || 0,
    renewalHeight: domain.renewal || 0,
    transferHeight: domain.transfer || 0,
    registered: !!domain.registered,
    expired: !!domain.expired,
    revoked: domain.revoked || 0,
    hnsPaid: typeof domain.highest === 'number' ? domain.highest / 1e6 : null,
    owner: {
      hash: normalizeHash(owner.hash),
      index: typeof owner.index === 'number' ? owner.index : null,
    },
  };
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizePrice(value) {
  if (typeof value === 'number') return value / 1e6;
  if (typeof value === 'string' && value !== '') return Number(value) / 1e6;
  return null;
}

function dollarydooToHns(value) {
  return typeof value === 'number' ? value / 1e6 : 0;
}

function normalizeListingStage(listing) {
  if (listing.cancelFinalize) return 'cancel-finalized';
  if (listing.nameLockCancel) return 'cancel-started';
  if (listing.auction) return listing.pendingListingError ? 'proof-ready-submit-failed' : 'proof-ready';
  if (listing.finalizeLock) return 'lock-finalized';
  if (listing.nameLock) return 'lock-transfer-started';
  return 'unknown';
}

function normalizeShakedexListing(listing, wallet) {
  const nameLock = listing.nameLock || {};
  const auction = listing.auction || {};
  const params = listing.params || {};
  const finalizeLock = listing.finalizeLock || {};
  const cancel = listing.nameLockCancel || {};
  const cancelFinalize = listing.cancelFinalize || {};

  return {
    name: normalizeName(firstValue(nameLock.name, auction.name, listing.name)),
    walletId: wallet.wid,
    walletDisplayName: wallet.displayName || wallet.wid,
    stage: normalizeListingStage(listing),
    mode: params.mode || null,
    priceHns: normalizePrice(firstValue(params.price, auction.price)),
    startPriceHns: normalizePrice(firstValue(params.startPrice, auction.startPrice)),
    endPriceHns: normalizePrice(firstValue(params.endPrice, auction.endPrice)),
    durationDays: params.durationDays || null,
    feeRate: params.feeRate || null,
    feeAddress: params.feeAddr || null,
    transferTxHash: nameLock.transferTxHash || null,
    finalizeTxHash: finalizeLock.finalizeTxHash || finalizeLock.txHash || null,
    cancelTxHash: cancel.transferTxHash || null,
    cancelFinalizeTxHash: cancelFinalize.finalizeTxHash || cancelFinalize.txHash || null,
    proofGenerated: !!listing.auction,
    submittedPendingListing: !!listing.pendingListing,
    pendingListingError: listing.pendingListingError || null,
  };
}

function normalizeShakedexFulfillment(fill, wallet) {
  const fulfillment = fill.fulfillment || {};
  const finalize = fill.finalize || {};

  return {
    name: normalizeName(fulfillment.name || fill.name),
    walletId: wallet.wid,
    walletDisplayName: wallet.displayName || wallet.wid,
    fulfillmentTxHash: fulfillment.fulfillmentTxHash || null,
    finalizeTxHash: finalize.hash || finalize.txHash || null,
    finalized: !!fill.finalize,
  };
}

async function getPortfolio() {
  if (!walletService.node || !walletService.node.wdb) {
    return {
      ok: false,
      reason: 'wallet-service-not-ready',
      wallets: [],
      names: [],
    };
  }

  const wallets = await walletService.listWallets();
  const names = [];

  for (const walletInfo of wallets) {
    const wallet = await walletService.node.wdb.get(walletInfo.wid);
    const walletNames = await wallet.getNames();

    for (const domain of walletNames) {
      const owner = domain.owner || {};
      const ownerHash = normalizeHash(owner.hash);
      const coin = ownerHash
        ? await wallet.getCoin(Buffer.from(ownerHash, 'hex'), owner.index)
        : null;

      if (!coin) continue;
      names.push(normalizeNameState(domain, walletInfo));
    }
  }

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    network: walletService.networkName || null,
    height: walletService.node.wdb.height || 0,
    wallets: wallets.map((wallet) => ({
      wid: wallet.wid,
      displayName: wallet.displayName || wallet.wid,
      encrypted: !!wallet.encrypted,
      watchOnly: !!wallet.watchOnly,
      type: wallet.type,
    })),
    names,
  };
}

async function getShakedexInventory() {
  if (!walletService.node || !walletService.node.wdb) {
    return {
      ok: false,
      reason: 'wallet-service-not-ready',
      wallets: [],
      listings: [],
      fulfillments: [],
    };
  }

  const wallets = await walletService.listWallets();
  const listings = [];
  const fulfillments = [];

  for (const walletInfo of wallets) {
    const walletListings = await shakedexService.getListings(walletInfo.wid);
    const walletFulfillments = await shakedexService.getFulfillments(walletInfo.wid);

    for (const listing of walletListings) {
      listings.push(normalizeShakedexListing(listing, walletInfo));
    }

    for (const fulfillment of walletFulfillments) {
      fulfillments.push(normalizeShakedexFulfillment(fulfillment, walletInfo));
    }
  }

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    network: walletService.networkName || null,
    height: walletService.node.wdb.height || 0,
    wallets: wallets.map((wallet) => ({
      wid: wallet.wid,
      displayName: wallet.displayName || wallet.wid,
    })),
    listings,
    fulfillments,
  };
}

async function getCoinBalances() {
  if (!walletService.node || !walletService.node.wdb) {
    return {
      ok: false,
      reason: 'wallet-service-not-ready',
      wallets: [],
    };
  }

  const wallets = await walletService.listWallets();
  const balances = [];

  for (const walletInfo of wallets) {
    const wallet = await walletService.node.wdb.get(walletInfo.wid);
    const account = await wallet.getAccount('default');
    const balance = await wallet.getBalance(account.accountIndex);
    const snapshot = balanceSnapshot(balance);

    balances.push({
      walletId: walletInfo.wid,
      walletDisplayName: walletInfo.displayName || walletInfo.wid,
      walletEncrypted: !!walletInfo.encrypted,
      walletWatchOnly: !!walletInfo.watchOnly,
      accountName: account.name || 'default',
      confirmedHns: dollarydooToHns(snapshot.confirmed),
      unconfirmedHns: dollarydooToHns(snapshot.unconfirmed),
      lockedConfirmedHns: dollarydooToHns(snapshot.lockedConfirmed),
      lockedUnconfirmedHns: dollarydooToHns(snapshot.lockedUnconfirmed),
      spendableHns: dollarydooToHns(snapshot.spendable),
    });
  }

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    network: walletService.networkName || null,
    height: walletService.node.wdb.height || 0,
    wallets: balances,
  };
}

function requestHandler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method !== 'GET') {
    writeJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/health') {
    if (!isAuthorized(req)) return unauthorized(res);
    writeJson(res, 200, {
      ok: true,
      app: 'Bob LearnHNS',
      bridge: 'hns-investments',
    });
    return;
  }

  if (url.pathname === '/portfolio') {
    if (!isAuthorized(req)) return unauthorized(res);
    getPortfolio()
      .then((portfolio) => writeJson(res, portfolio.ok ? 200 : 503, portfolio))
      .catch((error) => writeJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (url.pathname === '/shakedex') {
    if (!isAuthorized(req)) return unauthorized(res);
    getShakedexInventory()
      .then((inventory) => writeJson(res, inventory.ok ? 200 : 503, inventory))
      .catch((error) => writeJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  if (url.pathname === '/coins') {
    if (!isAuthorized(req)) return unauthorized(res);
    getCoinBalances()
      .then((balances) => writeJson(res, balances.ok ? 200 : 503, balances))
      .catch((error) => writeJson(res, 500, { ok: false, error: error.message }));
    return;
  }

  writeJson(res, 404, { error: 'Not found' });
}

function writeManifest(port) {
  manifestPath = path.join(app.getPath('userData'), BRIDGE_MANIFEST);
  const manifest = {
    version: 1,
    app: 'Bob LearnHNS',
    bridge: 'hns-investments',
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
}

function removeManifest() {
  if (!manifestPath) return;

  try {
    fs.unlinkSync(manifestPath);
  } catch (_error) {
    // Best effort cleanup only.
  }
}

export async function start() {
  if (server) return;

  token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  server = http.createServer(requestHandler);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      writeManifest(server.address().port);
      resolve();
    });
  });

  app.once('before-quit', stop);
}

export function stop() {
  removeManifest();

  if (server) {
    server.close();
    server = null;
  }

  token = null;
}
