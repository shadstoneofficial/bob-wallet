import { Address } from 'hsd/lib/primitives';
import nodeClient from '../utils/nodeClient';
import walletClient from '../utils/walletClient';
import * as namesDb from '../db/names';
import {
  fetchPendingTransactions,
  getPassphrase,
  startWalletSync,
  stopWalletSync,
  waitForWalletSync,
} from './walletActions';
import { SET_NAME } from './namesReducer';
import {NAME_STATES} from "../constants/names";
import {
  fetchWalletStats,
  invalidateRedeemableStats,
} from './walletStats';

export const RECORD_TYPE = {
  DS: 'DS',
  NS: 'NS',
  GLUE4: 'GLUE4',
  GLUE6: 'GLUE6',
  SYNTH4: 'SYNTH4',
  SYNTH6: 'SYNTH6',
  TXT: 'TXT',
};

export const DROPDOWN_TYPES = [
  {label: RECORD_TYPE.DS},
  {label: RECORD_TYPE.NS},
  {label: RECORD_TYPE.GLUE4},
  {label: RECORD_TYPE.GLUE6},
  {label: RECORD_TYPE.SYNTH4},
  {label: RECORD_TYPE.SYNTH6},
  {label: RECORD_TYPE.TXT},
];

export const fetchName = (name, force) => async (dispatch, getState) => {
  const {names} = getState();
  const existing = names[name];

  if (!force && existing && existing.info) {
    return;
  }

  const result = await nodeClient.getNameInfo(name);
  const {start, info} = result;

  let bids = [];
  let reveals = [];
  let winner = null;
  let isOwner = false;
  let walletHasName = false;
  let nameState = info && info.state;

  if (nameState === NAME_STATES.CLOSED) {
    isOwner = !!await walletClient.getCoin(info.owner.hash, info.owner.index);
  }

  dispatch({
    type: SET_NAME,
    payload: {
      name,
      start,
      info,
      bids,
      reveals,
      winner,
      isOwner,
      walletHasName,
    },
  });
};

export const getNameInfo = name => async (dispatch) => {
  const result = await nodeClient.getNameInfo(name);
  const {start, info} = result;

  let bids = [];
  let reveals = [];
  let winner = null;
  let lastTx = null;
  let isOwner = false;
  let walletHasName = false;

  if (!info) {
    dispatch({
      type: SET_NAME,
      payload: {
        name,
        start,
        info,
        bids,
        reveals,
        winner,
        lastTx,
        isOwner,
        walletHasName,
      },
    });
    return;
  }

  try {
    const auctionInfo = await walletClient.getAuctionInfo(name);
    walletHasName = true;
    bids = await inflateBids(auctionInfo.bids, info.height);
    reveals = await inflateReveals(auctionInfo.reveals, info.height);
  } catch (e) {
    if (!e.message.match(/auction not found/i)) {
      throw e;
    }
  }

  if (info.state === NAME_STATES.CLOSED) {
    const res = await walletClient.getTX(info.owner.hash);
    if (res) {
      const {tx: buyTx} = res;
      const buyOutput = buyTx.outputs[info.owner.index];
      const coin = await walletClient.getCoin(info.owner.hash, info.owner.index);
      isOwner = !!coin;

      if (coin) {
        lastTx = {
          height: coin.height,
          covenant: coin.covenant,
        }

        if (coin.covenant.action === 'TRANSFER') {
          const {network} = await nodeClient.getInfo();
          info.transferTo = Address.fromHash(
            Buffer.from(coin.covenant.items[3], 'hex'),
            Number(coin.covenant.items[2])
          ).toString(network);
        }
      }

      winner = {
        address: buyOutput.address,
      };
    }
  }

  dispatch({
    type: SET_NAME,
    payload: {name, start, info, bids, reveals, winner, lastTx, isOwner, walletHasName},
  });
};

async function inflateBids(bids, nameHeight) {
  if (!bids.length) {
    return [];
  }

  const ret = [];
  for (const bid of bids) {
    // Must use node client to get non-own bids
    const res = await nodeClient.getTx(bid.prevout.hash);

    if (!res) continue;

    // Ignore bids from previous auctions
    if (res.height < nameHeight) continue;

    const tx = res;
    const out = tx.outputs[bid.prevout.index];

    ret.push({
      bid,
      from: out.address,
      date: tx.mtime * 1000,
      value: out.value,
      height: tx.height,
    });
  }

  return ret;
}

async function inflateReveals(reveals, nameHeight) {
  if (!reveals.length) {
    return [];
  }

  const ret = [];
  for (const reveal of reveals) {
    // Must use node client to get non-own reveals
    const res = await nodeClient.getTx(reveal.prevout.hash);

    if (!res) continue;

    // Ignore reveals from previous auctions
    if (res.height < nameHeight) continue;

    const tx = res;
    const out = tx.outputs[reveal.prevout.index];
    const coin = await walletClient.getCoin(reveal.prevout.hash, reveal.prevout.index);

    ret.push({
      bid: reveal, // yes, it really is reveal
      from: out.address,
      date: tx.mtime * 1000,
      value: out.value,
      height: tx.height,
      redeemable: !!coin,
    });
  }

  return ret;
}

async function assertAuctionTracked(name) {
  try {
    await walletClient.getAuctionInfo(name);
  } catch (e) {
    if (e.message.match(/auction not found/i)) {
      throw new Error(
        `This wallet does not have auction history for ${name}/ yet (common in SPV). ` +
        `Bob will try to import it automatically for basket bids. ` +
        `If this keeps happening, open ${name}/ and use Rescan Auction, wait until sync finishes, then retry.`
      );
    }
    throw e;
  }
}

async function ensureAuctionTracked(name, importHeight = null) {
  try {
    await walletClient.getAuctionInfo(name);
    return { imported: false };
  } catch (e) {
    if (!e.message.match(/auction not found/i)) {
      throw e;
    }
  }

  let height = importHeight;
  if (height == null) {
    const result = await nodeClient.getNameInfo(name);
    if (result?.info?.height == null) {
      throw new Error(
        `Cannot bid on ${name}/: no on-chain auction height found. The name may not be in bidding yet.`
      );
    }
    height = result.info.height - 1;
  }

  await walletClient.importName(name, height);
  return { imported: true, height };
}

export const sendOpen = name => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  const res = await walletClient.sendOpen(name);
  await namesDb.storeName(name);
  await dispatch(fetchPendingTransactions());
  return res;
};

/**
 * Open multiple name auctions in one batch transaction (Open Basket).
 * @param {string[]} names
 */
export const sendOpenMany = (names) => async (dispatch, getState) => {
  if (!names || !names.length) {
    return null;
  }

  const { wallet } = getState();
  if (wallet.watchOnly) {
    throw new Error('Open Basket is not available for watch-only wallets.');
  }
  if (wallet.type === 'ledger' || wallet.type === 'multisig') {
    throw new Error('Open Basket is currently limited to standard hot wallets.');
  }

  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  const unique = [...new Set(
    names.map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
  )];

  const res = await walletClient.sendOpenMany(unique);
  if (!res) {
    throw new Error('Open basket transaction was not fully signed or broadcast.');
  }

  for (const name of unique) {
    await namesDb.storeName(name);
  }
  await dispatch(fetchPendingTransactions());
  return res;
};

export const sendBid = (name, amount, lockup, height) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  if (height) {
    try {
      await dispatch(startWalletSync());
      await walletClient.importName(name, height, {transactionAttempted: true});
      await dispatch(waitForWalletSync());
    } catch (e) {
      throw e;
    } finally {
      await dispatch(stopWalletSync());
    }
  }

  await assertAuctionTracked(name);

  let res = await walletClient.sendBid(name, amount, lockup);
  if (!res) {
    throw new Error('Bid transaction was not fully signed or broadcast.');
  }
  await namesDb.storeName(name);
  return res;
};

/**
 * Place multiple bids in one batch transaction (Auction Basket).
 * @param {Array<{name: string, bid: number|string, lockup: number|string, height?: number}>} entries
 *   bid/lockup in base units.
 */
export const sendBidMany = (entries) => async (dispatch, getState) => {
  if (!entries || !entries.length) {
    return null;
  }

  const { wallet } = getState();
  if (wallet.watchOnly) {
    throw new Error('Auction Basket bidding is not available for watch-only wallets.');
  }
  if (wallet.type === 'ledger' || wallet.type === 'multisig') {
    throw new Error('Auction Basket bidding is currently limited to standard hot wallets.');
  }

  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  // SPV wallets often lack auction history for names you have not bid on yet.
  // CRITICAL: import all missing names first, then run ONE rescan from the
  // earliest height. Calling importName() per name starts a separate rescan
  // each time and rewinds the wallet repeatedly (the "fell back 200 blocks" bug).
  const missing = [];
  for (const entry of entries) {
    try {
      await walletClient.getAuctionInfo(entry.name);
    } catch (e) {
      if (!e.message.match(/auction not found/i)) {
        throw e;
      }
      missing.push(entry);
    }
  }

  if (missing.length) {
    const toImport = [];
    for (const entry of missing) {
      let height = entry.height;
      if (height == null) {
        const result = await nodeClient.getNameInfo(entry.name);
        if (result?.info?.height == null) {
          throw new Error(
            `Cannot import ${entry.name}/ for bidding: no auction height from the node.`
          );
        }
        height = result.info.height - 1;
      }
      toImport.push({ name: entry.name, height });
    }

    try {
      await dispatch(startWalletSync());
      // One bloom filter update + ONE rescan from the earliest auction height.
      await walletClient.importNames(toImport, {transactionAttempted: true});
      // Basket rescans can take several minutes over flaky P2P peers.
      await dispatch(waitForWalletSync(600));
    } catch (e) {
      throw e;
    } finally {
      await dispatch(stopWalletSync());
    }
  }

  // Confirm every name is tracked after the single rescan.
  const stillMissing = [];
  for (const entry of entries) {
    try {
      await walletClient.getAuctionInfo(entry.name);
    } catch (e) {
      if (e.message.match(/auction not found/i)) {
        stillMissing.push(entry.name);
      } else {
        throw e;
      }
    }
  }

  if (stillMissing.length) {
    throw new Error(
      `Wallet still missing auction data for: ${stillMissing.map((n) => `${n}/`).join(', ')}. ` +
      `Bob is still catching up after importing those names (local SPV, not the helper). ` +
      `Leave Bob open until the top-right status is Synchronized and Current Height is near the network tip, ` +
      `then retry this basket once — do not submit again while it says Rescanning/Synchronizing.`
    );
  }

  const payload = entries.map((entry) => ({
    name: entry.name,
    bid: entry.bid,
    lockup: entry.lockup,
  }));

  const res = await walletClient.sendBidMany(payload);
  if (!res) {
    throw new Error('Basket bid transaction was not fully signed or broadcast.');
  }

  for (const entry of entries) {
    await namesDb.storeName(entry.name);
  }
  await dispatch(fetchPendingTransactions());
  return res;
};

export const sendReveal = (name) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  await namesDb.storeName(name);
  return await walletClient.sendReveal(name);
};

export const sendRegister = (name) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  return await walletClient.sendRegister(name);
};

export const sendRedeem = (name) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  await namesDb.storeName(name);
  return await walletClient.sendRedeem(name);
};

export const sendRedeemAll = () => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  // Hide the action immediately and invalidate any stats request that began
  // before the wallet marked the reveal outputs spent.
  dispatch(invalidateRedeemableStats());

  try {
    const result = await walletClient.sendRedeemAll();
    try {
      await dispatch(fetchWalletStats());
    } catch (statsError) {
      console.error('Could not refresh wallet stats after redeem:', statsError);
    }
    return result;
  } catch (error) {
    try {
      await dispatch(fetchWalletStats());
    } catch (statsError) {
      console.error('Could not refresh wallet stats after empty redeem:', statsError);
    }
    if (/nothing to do/i.test(error.message || '')) {
      throw new Error('No bids remain to redeem.');
    }
    throw error;
  }
};

export const sendRevealAll = () => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  return await walletClient.sendRevealAll();
};

export const sendRevealMany = (names) => async (dispatch) => {
  if (!names || !names.length) {
    return null;
  }

  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  for (const name of names) {
    if (name) {
      await namesDb.storeName(name);
    }
  }

  return await walletClient.sendRevealMany(names);
};

export const sendRegisterAll = () => async (dispatch) => {
  const passphrase = await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  return await walletClient.sendRegisterAll(passphrase);
};

export const sendRenewal = (name) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  await namesDb.storeName(name);
  return await walletClient.sendRenewal(name);
};

export const transferMany = (names, recipient) => async (dispatch) => {
  if (!names || !names.length) {
    return;
  }
  if (!recipient) {
    return;
  }

  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return await walletClient.transferMany(names, recipient);
};

export const finalizeAll = () => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  return await walletClient.finalizeAll();
};

export const finalizeMany = (names) => async (dispatch) => {
  if (!names || !names.length) {
    return;
  }

  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return await walletClient.finalizeMany(names);
};

export const renewAll = () => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });

  return await walletClient.renewAll();
};

export const renewMany = (names) => async (dispatch) => {
  if (!names || !names.length) {
    return;
  }

  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  await walletClient.renewMany(names);
};

export const sendTransfer = (name, recipient) => async (dispatch) => {
  if (!name) {
    return;
  }
  if (!recipient) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return await walletClient.sendTransfer(name, recipient);
};

export const cancelTransfer = (name) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return await walletClient.cancelTransfer(name);
};

export const finalizeTransfer = (name) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return await walletClient.finalizeTransfer(name);
};

export const finalizeWithPayment = (name, fundingAddr, recipient, price) => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return walletClient.finalizeWithPayment(name, fundingAddr, recipient, price);
};

export const claimPaidTransfer = (hex) => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return await walletClient.claimPaidTransfer(hex);
};

export const revokeName = (name) => async (dispatch) => {
  if (!name) {
    return;
  }
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  return await walletClient.revokeName(name);
};

export const sendUpdate = (name, json) => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  await namesDb.storeName(name);
  const res = await walletClient.sendUpdate(name, json);
  await dispatch(fetchPendingTransactions());
  return res;
};
