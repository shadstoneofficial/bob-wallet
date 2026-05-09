import { Context } from 'shakedex/src/context.js';
import { SwapProof } from 'shakedex/src/swapProof.js';
const secp256k1 = require('bcrypto/lib/secp256k1.js');
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
import { SwapFill } from 'shakedex/src/swapFill.js';
import { Auction, AuctionFactory, linearReductionStrategy } from 'shakedex/src/auction.js';
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

let db;

const MARKET_API_HOST = process.env.LEARNHNS_MARKET_API_HOST || 'market.learnhns.com';
const MARKET_API_BASE_URL = `https://${MARKET_API_HOST}`;

const client = new Client({
  host: MARKET_API_HOST,
  ssl: true,
});

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
  const res = await client.get(`api/v2/auctions?page=${currentPage}&per_page=20`);
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
  const resp = await fetch(`${MARKET_API_BASE_URL}/api/v2/auctions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      auction,
    }),
  });
  return resp.json();
}

async function getMarketListingCoin(auction) {
  const resp = await fetch(
    `${MARKET_API_BASE_URL}/api/v2/listings/${encodeURIComponent(auction.name)}/coin`,
  );
  const data = await resp.json();

  if (!resp.ok) {
    const status = await getMarketHsdStatus();
    if (status && status.reachable && status.progress < 0.99) {
      const percent = Math.max(0, Math.min(100, status.progress * 100)).toFixed(2);
      throw new Error(
        `LearnHNS Market is still syncing its Handshake node (${percent}% complete, height ${status.height}). Please try again after sync completes.`,
      );
    }

    throw new Error(data.error || 'LearnHNS Market could not provide listing coin data.');
  }

  if (
    data.lockingTxHash !== auction.lockingTxHash
    || data.lockingOutputIdx !== auction.lockingOutputIdx
    || !data.coin
  ) {
    throw new Error('LearnHNS Market returned coin data for a different listing.');
  }

  return data.coin;
}

export async function getMarketHsdStatus() {
  try {
    const resp = await fetch(`${MARKET_API_BASE_URL}/api/v2/hsd/status`);
    return await resp.json();
  } catch (e) {
    return {
      reachable: false,
      error: e.message,
    };
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
  await put(
    `${fillsPrefix()}/${fulfillmentJSON.name}/${fulfillmentJSON.fulfillmentTxHash}`,
    {
      fulfillment: fulfillmentJSON,
    },
  );
  return fulfillmentJSON;
}

export async function finalizeSwap(fulfillmentJSON, passphrase) {
  const context = getContext(passphrase);
  const fulfillment = new SwapFill(fulfillmentJSON);
  const finalize = await sdFinalizeSwap(context, fulfillment);
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

export async function getFulfillments() {
  const swaps = [];
  await iteratePrefix(
    fillsPrefix(),
    (key, value) => swaps.push(
      JSON.parse(value.toString('utf-8')),
    ),
  );
  return swaps;
}

function fillsPrefix() {
  const walletName = walletService.name;
  return `exchange/fills/${walletName}`;
}

function listingPrefix() {
  const walletName = walletService.name;
  return `exchange/listings/${walletName}`;
}

const LISTING_MODES = {
  FIXED: 'fixed',
  REVERSE: 'reverse',
};

export async function transferLock(name, params, password) {
  const context = getContext(password);
  const nameLock = await transferNameLock(context, name);
  const {privateKey, ...nameLockJSON} = nameLock.toJSON();
  const out = {
    nameLock: {
      ...nameLockJSON,
      encryptedPrivateKey: encrypt(privateKey, password)
    },
    params,
  };
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
  } = await getFinalizeFromTransferTx(
    nameLock.transferTxHash,
    nameLock.name,
    nodeService,
  );

  const cancelNameLock = await transferNameLockCancel(context, {
    ...nameLock,
    finalizeTxHash: finalizeTx.hash,
    finalizeOutputIdx: finalizeCoin.index,
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
  const finalizeLock = await finalizeNameLock(context, {
    ...nameLock,
    privateKey: decrypt(nameLock.encryptedPrivateKey, password),
  });
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

export async function getListings() {
  const listings = [];
  await iteratePrefix(
    listingPrefix(),
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

  if (effectiveMode === LISTING_MODES.FIXED) {
    const {
      tx: finalizeTx,
      coin: finalizeCoin,
    } = await getFinalizeFromTransferTx(
      listing.nameLock.transferTxHash,
      listing.nameLock.name,
      nodeService,
    );

    if (!finalizeCoin) throw new Error('cannot find finalize coin');

    const mtp = await nodeService.getMTP();
    const fixedAuction = await createFixedPriceAuction({
      context,
      lockFinalize: new NameLockFinalize({
        ...listing.nameLock,
        finalizeTxHash: finalizeTx.hash,
        finalizeOutputIdx: finalizeCoin.index,
        privateKey: decrypt(listing.nameLock.encryptedPrivateKey, passphrase),
      }),
      price,
      lockTime: mtp >>> 0,
      feeRate: feeRate || 0,
      feeAddr,
    });
    const auctionJSON = fixedAuction.toJSON(context);
    if (persist) {
      listing.auction = auctionJSON;
      await put(
        key,
        listing,
      );
    }
    return auctionJSON;
  }

  let reductionTime;
  switch (durationDays) {
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
  } = await getFinalizeFromTransferTx(
    listing.nameLock.transferTxHash,
    listing.nameLock.name,
    nodeService,
  );

  if (!finalizeCoin) throw new Error('cannot find finalize coin');

  const mtp = await nodeService.getMTP();

  const auctionFactory = new AuctionFactory({
    name: listing.nameLock.name,
    startTime: mtp >>> 0,
    endTime: (mtp + durationDays * 24 * 60 * 60) >>> 0,
    startPrice: startPrice,
    endPrice: endPrice,
    reductionTime,
    reductionStrategy: linearReductionStrategy,
    feeRate: feeRate || 0,
    feeAddr,
  });

  const auction = await auctionFactory.createAuction(
    context,
    new NameLockFinalize({
      ...listing.nameLock,
      finalizeTxHash: finalizeTx.hash,
      finalizeOutputIdx: finalizeCoin.index,
      privateKey: decrypt(listing.nameLock.encryptedPrivateKey, passphrase)
    }),
  );
  const auctionJSON = auction.toJSON(context);
  if (persist) {
    listing.auction = auctionJSON;
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
  const resp = await fetch(`${MARKET_API_BASE_URL}/api/v2/fee_info`);
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

  return new Context(
    networkName,
    walletId,
    walletApiKey,
    () => Promise.resolve(passphrase),
    client.host,
    nodeApiKey,
  );
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
