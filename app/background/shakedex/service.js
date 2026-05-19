import { Context } from 'shakedex/src/context.js';
import { SwapProof } from 'shakedex/src/swapProof.js';
const secp256k1 = require('bcrypto/lib/secp256k1.js');
const { NodeClient, WalletClient } = require('hsd/lib/client');
import { service as nodeService } from '../node/service';
import { service as walletService } from '../wallet/service';
import {
  fillSwap as sdFulfillSwap,
  finalizeSwap as sdFinalizeSwap,
  transferNameLock,
  finalizeNameLock,
  transferNameLockCancel,
  finalizeNameLockCancel,
} from 'shakedex/src/swapService.js';
import { createFinalize as sdCreateFinalize } from 'shakedex/src/utils.js';
import { SwapFill } from 'shakedex/src/swapFill.js';
import { SwapFinalize } from 'shakedex/src/swapFinalize.js';
import { Auction, AuctionFactory, linearReductionStrategy } from 'shakedex/src/auction.js';
const Coin = require('hsd/lib/primitives/coin.js');
const jsonSchemaValidate = require('jsonschema').validate;
import { NameLockFinalize } from 'shakedex/src/nameLock.js';
import stream from 'stream';
import {encrypt, decrypt} from "../../utils/encrypt";
import path from "path";
import {app} from "electron";
import bdb from "bdb";
import {
  auctionSchema,
  fulfillmentSchema,
  getFinalizeFromTransferTx,
  nameLockSchema,
  paramSchema
} from "../../utils/shakedex";
import {Client} from "bcurl";
import {
  ACTIVE_SHAKEDEX_CHANNEL,
  DEFAULT_SHAKEDEX_CHANNEL_HOST,
  getShakedexChannelBaseUrl,
} from '../../constants/shakedexChannels.js';

let db;

const SHAKEDEX_CHANNEL_SETTINGS_KEY = 'exchange/settings/shakedexChannelHost';
const SHAKEDEX_BROADCAST_REJECTION_CHECK_DELAYS = [500, 1500, 3000];

function normalizeShakedexChannelHost(value) {
  const raw = `${value || ''}`.trim();
  if (!raw) {
    return DEFAULT_SHAKEDEX_CHANNEL_HOST;
  }

  const url = raw.includes('://')
    ? new URL(raw)
    : new URL(`https://${raw}`);
  return url.host.toLowerCase();
}

async function getMarketApiHost() {
  const stored = await get(SHAKEDEX_CHANNEL_SETTINGS_KEY);
  return normalizeShakedexChannelHost(stored || ACTIVE_SHAKEDEX_CHANNEL.host);
}

async function getMarketApiBaseUrl() {
  return getShakedexChannelBaseUrl({ host: await getMarketApiHost() });
}

async function getMarketClient() {
  return new Client({
    host: await getMarketApiHost(),
    ssl: true,
  });
}

function buildProofUploadPayload(auction, proof) {
  const boundary = `----BobLearnHNS${Date.now().toString(16)}`;
  const filename = `${auction.name || 'shakedex-listing'}-proof.json`
    .replace(/["\r\n]/g, '_');
  const head = Buffer.from(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="proof"; filename="${filename}"\r\n`
    + 'Content-Type: application/json\r\n\r\n',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, Buffer.from(proof), tail]);

  return {
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': `${body.length}`,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertPurchaseNotRejected(context, txHash) {
  if (!txHash || !context.nodeClient || !context.nodeClient.checkMempoolRejectionFilter) {
    return;
  }

  for (const delay of SHAKEDEX_BROADCAST_REJECTION_CHECK_DELAYS) {
    await sleep(delay);

    let rejection;
    try {
      rejection = await context.nodeClient.checkMempoolRejectionFilter(txHash);
    } catch (e) {
      console.warn('Could not check Shakedex purchase rejection filter.', e);
      return;
    }

    if (rejection && rejection.invalid) {
      throw new Error(
        'Purchase transaction was rejected by your HSD node before it entered the mempool. '
        + 'No funds were spent. Refresh the Shakedex channel and try again with a fresh buyable listing.',
      );
    }
  }
}

export async function openDB() {
  if (db) {
    return;
  }

  const loc = path.join(app.getPath('userData'), 'exchange_db');
  let tdb = bdb.create(loc);
  await tdb.open();
  db = tdb;
}

export async function closeDB() {
  ensureDB();
  await db.close();
  db = null;
}

export async function put(key, value) {
  ensureDB();
  return db.put(Buffer.from(key, 'utf-8'), Buffer.from(JSON.stringify(value), 'utf-8'));
}

export async function get(key) {
  ensureDB();
  const data = await db.get(Buffer.from(key, 'utf-8'));
  if (data === null) {
    return null;
  }

  return JSON.parse(data.toString('utf-8'));
}

export async function del(key) {
  ensureDB();
  return db.del(Buffer.from(key, 'utf-8'));
}

export async function iteratePrefix(prefix, cb) {
  const gt = Buffer.from(prefix, 'utf-8');
  const iter = db.iterator({
    gt,
    lt: Buffer.concat([gt, Buffer.from([0xFF])]),
    values: true,
  });
  await iter.each(cb);
}

export async function getExchangeAuctions(currentPage = 1) {
  const marketClient = await getMarketClient();
  const res = await marketClient.get(`api/v2/auctions?page=${currentPage}&per_page=20`);
  const auctions = res.auctions.map(auction => {
    auction.bids.sort((a,b) => b.price - a.price);
    return auction;
  })
  return {
    total: +res.total,
    auctions
  }
}

export async function listAuction(auction) {
  const proof = JSON.stringify(auction);
  const {body, headers} = buildProofUploadPayload(auction, proof);

  const resp = await fetch(`${await getMarketApiBaseUrl()}/api/upload-proof`, {
    method: 'POST',
    headers,
    body,
  });

  let json;
  const text = await resp.text();
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = {
      error: {
        message: text || `Shakedex channel returned HTTP ${resp.status}`,
      },
    };
  }

  if (!resp.ok && !json.error) {
    json.error = {
      message: `Shakedex channel returned HTTP ${resp.status}`,
    };
  }

  if (resp.ok && !json.error) {
    await saveMarketSubmission(auction, json);
  }
  return json;
}

async function getMarketListingCoin(auction) {
  const resp = await fetch(
    `${await getMarketApiBaseUrl()}/api/v2/listings/${encodeURIComponent(auction.name)}/coin`,
  );
  const data = await resp.json();

  if (!resp.ok) {
    const status = await getMarketHsdStatus();
    if (status && status.reachable && status.progress < 0.99) {
      const percent = Math.max(0, Math.min(100, status.progress * 100)).toFixed(2);
      throw new Error(
        `This Shakedex channel is still syncing its Handshake node (${percent}% complete, height ${status.height}). Please try again after sync completes.`,
      );
    }

    throw new Error(data.error || 'The Shakedex channel could not provide listing coin data.');
  }

  if (
    data.lockingTxHash !== auction.lockingTxHash
    || data.lockingOutputIdx !== auction.lockingOutputIdx
    || !data.coin
  ) {
    throw new Error('The Shakedex channel returned coin data for a different listing.');
  }

  return data.coin;
}

async function getMarketCoin(txHash, outputIndex) {
  const resp = await fetch(
    `${await getMarketApiBaseUrl()}/api/v2/coin/${txHash}/${outputIndex}`,
  );
  const data = await resp.json();

  if (!resp.ok || !data.coin) {
    throw new Error(data.error || 'The Shakedex channel could not provide transfer coin data.');
  }

  if (data.txHash !== txHash || Number(data.outputIndex) !== Number(outputIndex)) {
    throw new Error('The Shakedex channel returned coin data for a different transfer.');
  }

  return data.coin;
}

async function getMarketNameInfo(name) {
  const resp = await fetch(
    `${await getMarketApiBaseUrl()}/api/v2/names/${encodeURIComponent(name)}/status`,
  );
  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || 'The Shakedex channel could not provide name data.');
  }

  if (!data.nameInfo || !data.nameInfo.info) {
    throw new Error('The Shakedex channel could not find the listing name on-chain.');
  }

  return data.nameInfo;
}

function isMissingNameInfo(result) {
  return !result || !result.info;
}

const SHAKEDEX_SPV_FALLBACK_FEE_RATE = 5000;

function isMissingFeeEstimate(result) {
  const fee = Number(result && result.fee);
  return !Number.isFinite(fee) || fee <= 0;
}

function getFallbackFeeEstimate() {
  return {
    fee: SHAKEDEX_SPV_FALLBACK_FEE_RATE,
    blocks: 10,
  };
}

export async function getMarketHsdStatus() {
  try {
    const resp = await fetch(`${await getMarketApiBaseUrl()}/api/v2/hsd/status`);
    return await resp.json();
  } catch (e) {
    return {
      reachable: false,
      error: e.message,
    };
  }
}

async function getExpiringNamesFeed(limit = 100, scope = '', options = {}) {
  const host = await getMarketApiHost();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const scopeQuery = scope ? `&scope=${encodeURIComponent(scope)}` : '';
  const statusQuery = options.status ? `&status=${encodeURIComponent(options.status)}` : '';

  try {
    const resp = await fetch(
      `${getShakedexChannelBaseUrl({host})}/api/v2/expiring-names?limit=${safeLimit}&refresh=1${scopeQuery}${statusQuery}`,
    );
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }

    return {
      ...data,
      host,
    };
  } catch (e) {
    return {
      host,
      names: [],
      scope: scope || 'channel-observed',
      error: e.message || 'This Shakedex channel does not have expiring-name data available yet.',
    };
  }
}

export async function getChannelExpiringNames(limit = 100) {
  return getExpiringNamesFeed(limit);
}

export async function getCommunityExpiringNames(limit = 100) {
  return getExpiringNamesFeed(limit, 'community');
}

export async function getGlobalExpiringNames(limit = 100) {
  return getExpiringNamesFeed(limit, 'global');
}

export async function getRecentlyExpiredNames(limit = 100) {
  return getExpiringNamesFeed(limit, 'global', {status: 'expired'});
}

export async function getShakedexChannelSettings() {
  const host = await getMarketApiHost();
  return {
    defaultHost: DEFAULT_SHAKEDEX_CHANNEL_HOST,
    host,
    apiBaseUrl: `${getShakedexChannelBaseUrl({ host })}/api/v2`,
    isDefault: host === DEFAULT_SHAKEDEX_CHANNEL_HOST,
  };
}

export async function validateShakedexChannelHost(host) {
  const normalizedHost = normalizeShakedexChannelHost(host);
  try {
    const resp = await fetch(`${getShakedexChannelBaseUrl({ host: normalizedHost })}/api/v2/hsd/status`);
    const data = await resp.json();
    return {
      ok: resp.ok,
      host: normalizedHost,
      status: data,
      error: resp.ok ? null : (data.error || `HTTP ${resp.status}`),
    };
  } catch (e) {
    return {
      ok: false,
      host: normalizedHost,
      status: null,
      error: e.message,
    };
  }
}

export async function setShakedexChannelHost(host) {
  const normalizedHost = normalizeShakedexChannelHost(host);
  await put(SHAKEDEX_CHANNEL_SETTINGS_KEY, normalizedHost);
  return getShakedexChannelSettings();
}

export async function resetShakedexChannelHost() {
  await del(SHAKEDEX_CHANNEL_SETTINGS_KEY);
  return getShakedexChannelSettings();
}

async function refreshMarketListingStatus(name, payload) {
  try {
    const resp = await fetch(
      `${await getMarketApiBaseUrl()}/api/v2/listings/${encodeURIComponent(name)}/refresh-status`,
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload),
      },
    );
    return await resp.json();
  } catch (e) {
    return {
      sold: false,
      error: e.message,
    };
  }
}

async function notifyMarketListingSold(name, saleTxHash) {
  return refreshMarketListingStatus(name, { saleTxHash });
}

async function notifyMarketListingCancelled(name, cancelTxHash) {
  return refreshMarketListingStatus(name, {
    outcome: 'cancelled',
    cancelTxHash,
  });
}

function getListingModeForMarket(params = {}) {
  return params.mode === LISTING_MODES.REVERSE ? 'reverse-auction' : 'fixed-price';
}

function getExpectedPriceForMarket(params = {}) {
  if (params.mode === LISTING_MODES.REVERSE) {
    return Number.isFinite(params.startPrice) ? params.startPrice : null;
  }

  return Number.isFinite(params.price) ? params.price : null;
}

function getAddressString(address, networkName) {
  if (!address) {
    return null;
  }

  if (typeof address === 'string') {
    return address;
  }

  if (typeof address.toString === 'function') {
    return address.toString(networkName);
  }

  return null;
}

async function findTransferOutputIdx(transferTxHash, name) {
  try {
    const [{ info: { nameHash } }, transferTx] = await Promise.all([
      nodeService.getNameInfo(name),
      nodeService.getTx(transferTxHash),
    ]);

    if (!transferTx || !Array.isArray(transferTx.outputs)) {
      return null;
    }

    const idx = transferTx.outputs.findIndex((output) => (
      (output.covenant.action === 'TRANSFER' || output.covenant.type === 9)
      && output.covenant.items
      && output.covenant.items[0] === nameHash
    ));

    return idx >= 0 ? idx : null;
  } catch (e) {
    return null;
  }
}

async function publishPendingListing(nameLock, params) {
  const payload = {
    name: nameLock.name,
    network: nodeService.networkName,
    transferTxHash: nameLock.transferTxHash,
    transferOutputIdx: Number.isInteger(nameLock.transferOutputIdx)
      ? nameLock.transferOutputIdx
      : await findTransferOutputIdx(nameLock.transferTxHash, nameLock.name),
    lockScriptAddr: getAddressString(nameLock.lockScriptAddr, nodeService.networkName),
    listingMode: getListingModeForMarket(params),
    expectedPrice: getExpectedPriceForMarket(params),
    sellerNote: 'Pending Shakedex listing. Final proof will be uploaded after the transfer lock matures.',
  };

  const resp = await fetch(`${await getMarketApiBaseUrl()}/api/v2/pending-listings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();

  if (!resp.ok) {
    throw new Error(json.error || 'The Shakedex channel could not publish the pending listing.');
  }

  return json;
}

async function saveMarketSubmission(auction, response) {
  const updates = [];
  await iteratePrefix(listingPrefix(), (key, value) => {
    const listing = JSON.parse(value.toString('utf-8'));
    const listingAuction = listing.auction || {};
    if (
      listingAuction.name === auction.name
      && listingAuction.lockingTxHash === auction.lockingTxHash
      && listingAuction.lockingOutputIdx === auction.lockingOutputIdx
    ) {
      updates.push({
        key: key.toString('utf-8'),
        listing: {
          ...listing,
          marketSubmission: {
            submittedAt: Date.now(),
            response,
          },
        },
      });
    }
  });

  for (const update of updates) {
    await put(update.key, update.listing);
  }
}

async function attachMarketCoinFallback(context, auction) {
  if (!await nodeService.getSpvMode()) {
    return;
  }

  const localGetCoin = context.nodeClient.getCoin.bind(context.nodeClient);
  context.nodeClient.getCoin = async (hash, index) => {
    const isListingCoin = hash === auction.lockingTxHash && index === auction.lockingOutputIdx;

    try {
      const coin = await localGetCoin(hash, index);
      if (coin || !isListingCoin) {
        return coin;
      }
    } catch (e) {
      if (!isListingCoin) {
        throw e;
      }
    }

    return getMarketListingCoin(auction);
  };

  const localExecNode = context.execNode.bind(context);
  context.execNode = async (method, ...args) => {
    const isListingNameInfo = method === 'getnameinfo' && args[0] === auction.name;
    const isFeeEstimate = method === 'estimatesmartfee';

    try {
      const result = await localExecNode(method, ...args);
      if (isListingNameInfo && isMissingNameInfo(result)) {
        return getMarketNameInfo(auction.name);
      }
      if (isFeeEstimate && isMissingFeeEstimate(result)) {
        return getFallbackFeeEstimate();
      }
      return result;
    } catch (e) {
      if (isListingNameInfo) {
        return getMarketNameInfo(auction.name);
      }
      if (isFeeEstimate) {
        return getFallbackFeeEstimate();
      }
      throw e;
    }
  };
}

async function finalizeSwapWithMarketFallback(context, fulfillment) {
  const transferOutputIdx = 0;
  const [transferCoinJSON, nameInfo] = await Promise.all([
    getMarketCoin(fulfillment.fulfillmentTxHash, transferOutputIdx),
    getMarketNameInfo(fulfillment.name),
  ]);
  const lockup = nameInfo.info && nameInfo.info.stats
    ? Number(nameInfo.info.stats.blocksUntilValidFinalize)
    : null;

  if (Number.isFinite(lockup) && lockup > 0) {
    throw new Error(`Transfer lockup is not complete. Try again in ${lockup} block(s).`);
  }

  const localExecNode = context.execNode.bind(context);
  context.execNode = async (method, ...args) => {
    const isNameInfo = method === 'getnameinfo' && args[0] === fulfillment.name;
    const isFeeEstimate = method === 'estimatesmartfee';

    try {
      const result = await localExecNode(method, ...args);
      if (isNameInfo && isMissingNameInfo(result)) {
        return nameInfo;
      }
      if (isFeeEstimate && isMissingFeeEstimate(result)) {
        return getFallbackFeeEstimate();
      }
      return result;
    } catch (e) {
      if (isNameInfo) {
        return nameInfo;
      }
      if (isFeeEstimate) {
        return getFallbackFeeEstimate();
      }
      throw e;
    }
  };

  const localGetBlock = context.nodeClient.getBlock.bind(context.nodeClient);
  context.nodeClient.getBlock = async (height) => {
    try {
      return await localGetBlock(height);
    } catch (e) {
      return nodeService.getBlock(height);
    }
  };

  await context.unlockWallet();
  const transferCoin = new Coin().fromJSON(transferCoinJSON);
  const mtx = await sdCreateFinalize(
    context,
    fulfillment.name,
    transferCoin,
    fulfillment.lockingPublicKey,
  );
  await context.execNode('sendrawtransaction', mtx.toHex());

  return new SwapFinalize({
    name: fulfillment.name,
    finalizeTxHash: mtx.toJSON().hash,
    broadcastAt: Date.now(),
  });
}

async function getTransferCoinForNameLock(nameLock) {
  const nameInfo = await getMarketNameInfo(nameLock.name);
  let transferOutputIdx = Number.isInteger(nameLock.transferOutputIdx)
    ? nameLock.transferOutputIdx
    : null;

  const owner = nameInfo.info && nameInfo.info.owner;
  if (
    transferOutputIdx === null
    && owner
    && owner.hash === nameLock.transferTxHash
    && Number.isInteger(owner.index)
  ) {
    transferOutputIdx = owner.index;
  }

  if (transferOutputIdx === null) {
    transferOutputIdx = await findTransferOutputIdx(nameLock.transferTxHash, nameLock.name);
  }

  if (transferOutputIdx === null) {
    throw new Error('Could not find the Shakedex lock transfer output. Wait for the channel to index the transfer, then try again.');
  }

  const lockup = nameInfo.info && nameInfo.info.stats
    ? Number(nameInfo.info.stats.blocksUntilValidFinalize)
    : null;

  if (Number.isFinite(lockup) && lockup > 0) {
    throw new Error(`Transfer lockup is not complete. Try again in ${lockup} block(s).`);
  }

  return {
    nameInfo,
    transferCoinJSON: await getMarketCoin(nameLock.transferTxHash, transferOutputIdx),
  };
}

function attachSellerFinalizeFallbacks(context, name, nameInfo) {
  const localExecNode = context.execNode.bind(context);
  context.execNode = async (method, ...args) => {
    const isNameInfo = method === 'getnameinfo' && args[0] === name;
    const isFeeEstimate = method === 'estimatesmartfee';

    try {
      const result = await localExecNode(method, ...args);
      if (isNameInfo && isMissingNameInfo(result)) {
        return nameInfo;
      }
      if (isFeeEstimate && isMissingFeeEstimate(result)) {
        return getFallbackFeeEstimate();
      }
      return result;
    } catch (e) {
      if (isNameInfo) {
        return nameInfo;
      }
      if (isFeeEstimate) {
        return getFallbackFeeEstimate();
      }
      throw e;
    }
  };

  const localGetBlock = context.nodeClient.getBlock.bind(context.nodeClient);
  context.nodeClient.getBlock = async (height) => {
    try {
      return await localGetBlock(height);
    } catch (e) {
      return nodeService.getBlock(height);
    }
  };
}

async function finalizeNameLockWithMarketFallback(context, nameLock, password) {
  const { nameInfo, transferCoinJSON } = await getTransferCoinForNameLock(nameLock);
  const privateKey = Buffer.from(decrypt(nameLock.encryptedPrivateKey, password), 'hex');
  const publicKey = secp256k1.publicKeyCreate(privateKey);
  attachSellerFinalizeFallbacks(context, nameLock.name, nameInfo);

  await context.unlockWallet();
  const transferCoin = new Coin().fromJSON(transferCoinJSON);
  const mtx = await sdCreateFinalize(
    context,
    nameLock.name,
    transferCoin,
    publicKey,
  );
  await context.execNode('sendrawtransaction', mtx.toHex());

  return new NameLockFinalize({
    name: nameLock.name,
    finalizeTxHash: mtx.toJSON().hash,
    finalizeOutputIdx: 0,
    privateKey,
    broadcastAt: Date.now(),
  });
}

function attachSellerLockCoinFallback(context, lockFinalize, coinJSON) {
  const lockHash = `${lockFinalize.finalizeTxHash}`;
  const lockIndex = Number(lockFinalize.finalizeOutputIdx);
  const localGetCoin = context.nodeClient.getCoin.bind(context.nodeClient);

  context.nodeClient.getCoin = async (hash, index) => {
    const isLockCoin = hash === lockHash && Number(index) === lockIndex;

    try {
      const coin = await localGetCoin(hash, index);
      if (coin || !isLockCoin) {
        return coin;
      }
    } catch (e) {
      if (!isLockCoin) {
        throw e;
      }
    }

    return coinJSON;
  };
}

export async function fulfillSwap(auction, bid, passphrase) {
  const context = getContext(passphrase);
  await attachMarketCoinFallback(context, auction);
  const proof = new SwapProof({
    lockingTxHash: auction.lockingTxHash,
    lockingOutputIdx: auction.lockingOutputIdx,
    name: auction.name,
    publicKey: auction.publicKey,
    paymentAddr: auction.paymentAddr,
    price: bid.price,
    fee: bid.fee,
    lockTime: bid.lockTime,
    signature: bid.signature,
  });

  const fulfillment = await sdFulfillSwap(context, proof);
  const fulfillmentJSON = fulfillment.toJSON();
  if (!fulfillmentJSON.fulfillmentTxHash) {
    throw new Error('Shakedex purchase did not return a transaction hash.');
  }
  await assertPurchaseNotRejected(context, fulfillmentJSON.fulfillmentTxHash);
  await put(
    `${fillsPrefix()}/${fulfillmentJSON.name}/${fulfillmentJSON.fulfillmentTxHash}`,
    {
      fulfillment: fulfillmentJSON,
    },
  );
  notifyMarketListingSold(fulfillmentJSON.name, fulfillmentJSON.fulfillmentTxHash).catch((e) => {
    console.warn('Failed to notify Shakedex channel of purchase transaction.', e);
  });
  return fulfillmentJSON;
}

export async function finalizeSwap(fulfillmentJSON, passphrase) {
  const context = getContext(passphrase);
  const fulfillment = new SwapFill(fulfillmentJSON);
  const finalize = await nodeService.getSpvMode()
    ? await finalizeSwapWithMarketFallback(context, fulfillment)
    : await sdFinalizeSwap(context, fulfillment);
  const out = {
    fulfillment: fulfillmentJSON,
    finalize: finalize.toJSON(),
  };
  await put(
    `${fillsPrefix()}/${fulfillmentJSON.name}/${fulfillmentJSON.fulfillmentTxHash}`,
    out,
  );
  return out;
}

export async function getFulfillments(walletName = null) {
  const swaps = [];
  await iteratePrefix(
    fillsPrefix(walletName),
    (key, value) => swaps.push(
      JSON.parse(value.toString('utf-8')),
    ),
  );
  return swaps;
}

function fillsPrefix(walletName = null) {
  return `exchange/fills/${getWalletScopeName(walletName)}`;
}

function listingPrefix(walletName = null) {
  return `exchange/listings/${getWalletScopeName(walletName)}`;
}

function getWalletScopeName(walletName = null) {
  return `${walletName || walletService.name || ''}`.toLowerCase();
}

const LISTING_MODES = {
  FIXED: 'fixed',
  REVERSE: 'reverse',
};

export async function transferLock(name, params, password) {
  const context = getContext(password);
  const nameLock = await transferNameLock(context, name);
  const {privateKey, ...nameLockJSON} = nameLock.toJSON();
  if (!Number.isInteger(nameLockJSON.transferOutputIdx)) {
    nameLockJSON.transferOutputIdx = await findTransferOutputIdx(
      nameLockJSON.transferTxHash,
      nameLockJSON.name,
    );
  }
  const out = {
    nameLock: {
      ...nameLockJSON,
      encryptedPrivateKey: encrypt(privateKey, password)
    },
    params,
  };
  try {
    out.pendingListing = await publishPendingListing(nameLockJSON, params);
  } catch (e) {
    out.pendingListingError = e.message;
    console.warn('Failed to publish pending Shakedex listing.', e);
  }
  await put(
    `${listingPrefix()}/${nameLockJSON.name}/${nameLockJSON.transferTxHash}`,
    out,
  );
  return out;
}

export async function transferCancel(nameLock, password) {
  const context = getContext(password);
  const existing = await get(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
  );
  const {
    tx: finalizeTx,
    coin: finalizeCoin,
    outputIdx: finalizeOutputIdx,
  } = await getFinalizeFromTransferTx(
    nameLock.transferTxHash,
    nameLock.name,
    nodeService,
  );

  const cancelNameLock = await transferNameLockCancel(context, {
    ...nameLock,
    finalizeTxHash: finalizeTx.hash,
    finalizeOutputIdx: finalizeCoin.index ?? finalizeOutputIdx,
    publicKey: Buffer.from(nameLock.publicKey, 'hex'),
    privateKey: Buffer.from(decrypt(nameLock.encryptedPrivateKey, password), 'hex'),
  });
  const {privateKey, ...cancelLockJSON} = cancelNameLock.toJSON(context);

  const out = {
    ...existing,
    nameLockCancel: {
      ...cancelLockJSON,
      encryptedPrivateKey: encrypt(privateKey, password)
    },
  };

  await put(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
    out,
  );

  notifyMarketListingCancelled(nameLock.name, cancelLockJSON.transferTxHash);

  return out;
}

export async function finalizeCancel(nameLock, password) {
  const context = getContext(password);
  const existing = await get(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
  );
  const {nameLockCancel} = existing;
  const decrypted = Buffer.from(decrypt(nameLockCancel.encryptedPrivateKey, password), 'hex');
  const finalizeCancelLock = await finalizeNameLockCancel(context, {
    ...nameLockCancel,
    publicKey: secp256k1.publicKeyCreate(decrypted),
    privateKey: decrypted,
  });
  const finalizeCancelLockJSON = finalizeCancelLock.toJSON(context);

  const out = {
    ...existing,
    cancelFinalize: finalizeCancelLockJSON,
  };

  await put(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
    out,
  );

  return out;
}

export async function restoreOneListing(listing) {
  const {valid: auctionValid} = jsonSchemaValidate(listing.auction, auctionSchema);
  const {valid: nameLockValid} = jsonSchemaValidate(listing.nameLock || {}, nameLockSchema);
  const {valid: paramsValid} = jsonSchemaValidate(listing.params, paramSchema);

  if (!auctionValid || !nameLockValid || !paramsValid) {
    throw new Error('Invalid backup file schema');
  }
  const {nameLock} = listing;
  const existing = await get(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
  );
  if (existing) {
    throw new Error(`Auction for ${nameLock.name} already exist.`);
  }

  await put(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
    listing,
  );
}

export async function restoreOneFill(fill) {
  const {valid} = jsonSchemaValidate(fill.fulfillment, fulfillmentSchema);

  if (!valid) {
    throw new Error('Invalid backup file schema');
  }
  const {fulfillment} = fill;
  const existing = await get(
    `${fillsPrefix()}/${fulfillment.name}/${fulfillment.fulfillmentTxHash}`,
  );

  if (existing) {
    throw new Error(`Auction for ${fulfillment.name} already exist.`);
  }

  await put(
    `${fillsPrefix()}/${fulfillment.name}/${fulfillment.fulfillmentTxHash}`,
    fill,
  );
}

export async function finalizeLock(nameLock, password) {
  const context = getContext(password);
  let finalizeLock;
  try {
    finalizeLock = await finalizeNameLock(context, {
      ...nameLock,
      privateKey: decrypt(nameLock.encryptedPrivateKey, password),
    });
  } catch (e) {
    if (!await nodeService.getSpvMode()) {
      throw e;
    }
    finalizeLock = await finalizeNameLockWithMarketFallback(context, nameLock, password);
  }
  const {privateKey, ...finalizeLockJSON} = finalizeLock.toJSON();
  const existing = await get(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
  );
  const out = {
    ...existing,
    finalizeLock: {
      ...finalizeLockJSON,
      encryptedPrivateKey: encrypt(privateKey, password),
    },
  };
  await put(
    `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`,
    out,
  );
  return out;
}

export async function getListings(walletName = null) {
  const listings = [];
  await iteratePrefix(
    listingPrefix(walletName),
    (key, value) => listings.push(
      JSON.parse(value.toString('utf-8')),
    ),
  );
  return listings;
}

export async function launchAuction(nameLock, passphrase, paramsOverride, persist=true) {
  const context = getContext();
  const key = `${listingPrefix()}/${nameLock.name}/${nameLock.transferTxHash}`;
  const listing = await get(key);

  const params = paramsOverride || listing.params;
  const {
    mode,
    price,
    startPrice,
    endPrice,
    durationDays,
    feeRate,
    feeAddr,
    lowestDeprecatedPrice,
  } = params;

  if (paramsOverride) {
    listing.params = paramsOverride;
  }

  const effectiveMode = mode || LISTING_MODES.REVERSE;
  const listingDurationDays = durationDays || 7;

  if (effectiveMode === LISTING_MODES.FIXED) {
    const {
      tx: finalizeTx,
      coin: finalizeCoin,
      outputIdx: finalizeOutputIdx,
    } = await getFinalizeFromTransferTx(
      listing.nameLock.transferTxHash,
      listing.nameLock.name,
      nodeService,
    );

    if (!finalizeCoin) throw new Error('cannot find finalize coin');

    const mtp = await nodeService.getMTP();
    const lockFinalize = new NameLockFinalize({
      ...listing.nameLock,
      finalizeTxHash: finalizeTx.hash,
      finalizeOutputIdx: finalizeCoin.index ?? finalizeOutputIdx,
      privateKey: decrypt(listing.nameLock.encryptedPrivateKey, passphrase),
    });
    attachSellerLockCoinFallback(context, lockFinalize, finalizeCoin);
    const fixedAuction = await createFixedPriceAuction({
      context,
      lockFinalize,
      price,
      lockTime: mtp >>> 0,
      feeRate: feeRate || 0,
      feeAddr,
    });
    const auctionJSON = fixedAuction.toJSON(context);
    auctionJSON.expiresAt = (mtp + listingDurationDays * 24 * 60 * 60) >>> 0;
    if (persist) {
      listing.auction = auctionJSON;
      delete listing.marketSubmission;
      await put(
        key,
        listing,
      );
    }
    return auctionJSON;
  }

  let reductionTime;
  switch (listingDurationDays) {
    case 1:
      reductionTime = 60 * 60;
      break;
    case 3:
      reductionTime = 3 * 60 * 60;
      break;
    case 5:
    case 7:
    case 14:
      reductionTime = 24 * 60 * 60;
      break;
  }

  const {
    tx: finalizeTx,
    coin: finalizeCoin,
    outputIdx: finalizeOutputIdx,
  } = await getFinalizeFromTransferTx(
    listing.nameLock.transferTxHash,
    listing.nameLock.name,
    nodeService,
  );

  if (!finalizeCoin) throw new Error('cannot find finalize coin');

  const mtp = await nodeService.getMTP();
  const lockFinalize = new NameLockFinalize({
    ...listing.nameLock,
    finalizeTxHash: finalizeTx.hash,
    finalizeOutputIdx: finalizeCoin.index ?? finalizeOutputIdx,
    privateKey: decrypt(listing.nameLock.encryptedPrivateKey, passphrase)
  });
  attachSellerLockCoinFallback(context, lockFinalize, finalizeCoin);

  const auctionFactory = new AuctionFactory({
    name: listing.nameLock.name,
    startTime: mtp >>> 0,
    endTime: (mtp + listingDurationDays * 24 * 60 * 60) >>> 0,
    startPrice: startPrice,
    endPrice: endPrice,
    reductionTime,
    reductionStrategy: linearReductionStrategy,
    feeRate: feeRate || 0,
    feeAddr,
  });

  const auction = await auctionFactory.createAuction(
    context,
    lockFinalize,
  );
  const auctionJSON = auction.toJSON(context);
  if (persist) {
    listing.auction = auctionJSON;
    delete listing.marketSubmission;
    if (lowestDeprecatedPrice) {
      listing.lowestDeprecatedPrice = lowestDeprecatedPrice;
    }
    await put(
      key,
      listing,
    );
  }
  return auctionJSON;
}

async function createFixedPriceAuction(options) {
  const {
    context,
    lockFinalize,
    price,
    lockTime,
    feeRate,
    feeAddr,
  } = options;

  if (feeRate > 0 && !feeAddr) {
    throw new Error('Must specify a fee address if feeRate > 0.');
  }

  const paymentAddr = (await context.wallet.createAddress('default')).address;
  const fee = Math.floor(((feeRate || 0) / 10000) * price);
  const swapProof = new SwapProof({
    lockingTxHash: lockFinalize.finalizeTxHash,
    lockingOutputIdx: lockFinalize.finalizeOutputIdx,
    name: lockFinalize.name,
    publicKey: lockFinalize.publicKey,
    paymentAddr,
    price,
    lockTime,
    feeAddr,
    fee,
  });
  await swapProof.sign(context, lockFinalize.privateKey);

  return new Auction({
    version: 2,
    name: lockFinalize.name,
    lockingTxHash: lockFinalize.finalizeTxHash,
    lockingOutputIdx: lockFinalize.finalizeOutputIdx,
    publicKey: lockFinalize.publicKey,
    paymentAddr,
    feeAddr,
    data: [
      {
        price,
        lockTime,
        fee,
        signature: swapProof.signature,
      },
    ],
  });
}

export async function getFeeInfo() {
  const resp = await fetch(`${await getMarketApiBaseUrl()}/api/v2/fee_info`);
  if (resp.status === 404) {
    return {
      rate: 0,
      address: null
    };
  }
  return resp.json();
}

export async function getBestBid(auction) {
  const context = getContext();
  return (new Auction({...auction, data: auction.bids})).bestBidAt(context);
}

async function downloadProofs(auctionJSON) {
  const context = getContext();
  const proofs = [];
  for (const bid of auctionJSON.bids) {
    proofs.push(new SwapProof({
      price: bid.price,
      lockTime: bid.lockTime,
      signature: bid.signature,
    }));
  }
  const auction = new Auction({
    ...auctionJSON,
    data: proofs,
  });
  const data = [];
  const writable = new stream.Writable({
    write: function (chunk, encoding, next) {
      data.push(chunk);
      next();
    },
  });
  await auction.writeToStream(context, writable);
  return {
    data: data.join(''),
  };
}

function getContext(passphrase = null) {
  const {
    name: walletId,
    walletApiKey,
  } = walletService;
  const {
    apiKey: nodeApiKey,
    networkName,
    client,
  } = nodeService;
  const host = client.host;

  const context = new Context(
    networkName,
    walletId,
    walletApiKey,
    () => Promise.resolve(passphrase),
    host,
    nodeApiKey,
  );

  // Bob LearnHNS fork builds run HSD on offset ports so they can coexist with
  // production Bob. Shakedex's Context defaults to network ports, so wire the
  // active Bob node/wallet ports explicitly before any Shakedex operation.
  context.nodeClient = new NodeClient({
    port: nodeService.getRpcPort(),
    host,
    apiKey: nodeApiKey,
  });
  context.walletClient = new WalletClient({
    port: nodeService.getWalletPort(),
    host,
    apiKey: walletApiKey,
  });
  context.wallet = context.walletClient.wallet(walletId);
  return context;
}

const sName = 'Shakedex';
const methods = {
  fulfillSwap,
  getFulfillments,
  finalizeSwap,
  transferLock,
  finalizeLock,
  finalizeCancel,
  transferCancel,
  getListings,
  launchAuction,
  downloadProofs,
  restoreOneListing,
  restoreOneFill,
  getExchangeAuctions,
  listAuction,
  getFeeInfo,
  getBestBid,
  getMarketHsdStatus,
  getChannelExpiringNames,
  getCommunityExpiringNames,
  getGlobalExpiringNames,
  getRecentlyExpiredNames,
  getShakedexChannelSettings,
  validateShakedexChannelHost,
  setShakedexChannelHost,
  resetShakedexChannelHost,
};

export async function start(server) {
  await openDB();
  server.withService(sName, methods);
}

function ensureDB() {
  if (!db) {
    throw new Error('db not open');
  }
}
