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

export const BID_SUBMISSION_PHASES = Object.freeze({
  PREPARING: 'preparing',
  RESCANNING: 'rescanning',
  BROADCASTING: 'broadcasting',
  SUBMITTED: 'submitted',
  FAILED: 'failed',
});

const PREPARATION_TIMEOUT_MS = 12 * 60 * 1000;
const BROADCAST_TIMEOUT_MS = 90 * 1000;
const RECONCILE_TIMEOUT_MS = 15 * 1000;
const basketSubmissionLocks = new Map();

function basketSubmissionKey(walletId, entries) {
  const values = entries.map(entry => [entry.name, entry.bid, entry.lockup]);
  return `${walletId || 'unknown'}:${JSON.stringify(values)}`;
}

function createSubmissionError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  throw createSubmissionError('Stopped waiting for basket preparation.', {
    code: 'BASKET_SUBMISSION_CANCELLED',
    stage: BID_SUBMISSION_PHASES.PREPARING,
    retryAllowed: false,
  });
}

function waitForControlledPromise(promise, {signal, timeoutMs, timeoutError}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(
      reject,
      createSubmissionError('Stopped waiting for basket preparation.', {
        code: 'BASKET_SUBMISSION_CANCELLED',
        stage: BID_SUBMISSION_PHASES.PREPARING,
        retryAllowed: false,
      }),
    );

    if (signal) signal.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (timeoutMs) {
      timer = setTimeout(() => finish(reject, timeoutError), timeoutMs);
    }
    Promise.resolve(promise).then(
      value => finish(resolve, value),
      error => finish(reject, error),
    );
  });
}

function transactionIds(transactions) {
  return new Set((transactions || []).map(tx => tx?.txid).filter(Boolean));
}

async function findNewBasketTransactions(entries, baseline, findTransactions) {
  const current = await waitForControlledPromise(
    findTransactions(entries.map(entry => entry.name)),
    {
      timeoutMs: RECONCILE_TIMEOUT_MS,
      timeoutError: createSubmissionError(
        'Could not verify basket transaction history before the safety timeout.',
        {code: 'BASKET_RECONCILE_TIMEOUT'},
      ),
    },
  );
  return (current || []).filter(tx => tx?.txid && !baseline.has(tx.txid));
}

function isDefiniteBroadcastFailure(error) {
  return /rejected by the network|was not accepted by the network|fully signed/i.test(error?.message || '');
}

/**
 * Executes one basket submission with injected side effects so recovery and
 * duplicate-safety behavior can be tested without broadcasting HNS.
 */
export async function submitBidManyLifecycle(entries, deps, options = {}) {
  const signal = options.signal;
  const onPhase = options.onPhase || (() => {});
  const preparationTimeoutMs = options.preparationTimeoutMs || PREPARATION_TIMEOUT_MS;
  const broadcastTimeoutMs = options.broadcastTimeoutMs || BROADCAST_TIMEOUT_MS;
  let stage = BID_SUBMISSION_PHASES.PREPARING;
  let broadcastStarted = false;
  let baseline = null;
  const preparationStartedAt = Date.now();

  const setPhase = (phase, details = {}) => {
    stage = phase;
    onPhase(phase, details);
  };
  const prepare = promise => waitForControlledPromise(promise, {
    signal,
    timeoutMs: Math.max(1, preparationTimeoutMs - (Date.now() - preparationStartedAt)),
    timeoutError: createSubmissionError(
      'Basket preparation timed out. No transaction was sent.',
      {code: 'BASKET_PREPARATION_TIMEOUT', stage},
    ),
  });

  try {
    setPhase(BID_SUBMISSION_PHASES.PREPARING);
    baseline = transactionIds(await prepare(
      deps.findTransactions(entries.map(entry => entry.name)),
    ));
    await prepare(deps.requestPassphrase());
    throwIfCancelled(signal);

    const missing = [];
    for (const entry of entries) {
      try {
        await prepare(deps.getAuctionInfo(entry.name));
      } catch (error) {
        if (!/auction not found/i.test(error?.message || '')) throw error;
        missing.push(entry);
      }
    }

    if (missing.length) {
      const toImport = [];
      for (const entry of missing) {
        let height = entry.height;
        if (height == null) {
          const result = await prepare(deps.getNameInfo(entry.name));
          if (result?.info?.height == null) {
            throw new Error(`Cannot import ${entry.name}/ for bidding: no auction height from the node.`);
          }
          height = result.info.height - 1;
        }
        toImport.push({name: entry.name, height});
      }

      setPhase(BID_SUBMISSION_PHASES.RESCANNING, {missing: missing.length});
      const importPromise = Promise.resolve().then(() => (
        deps.importNames(toImport, {transactionAttempted: false})
      ));
      // Successful import RPC completion is not a completion signal. Observe
      // Redux rescan progress instead, while still surfacing an early RPC error.
      const importFailure = importPromise.then(() => new Promise(() => {}));
      await prepare(Promise.race([
        deps.waitForSync({signal, timeoutMs: preparationTimeoutMs}),
        importFailure,
      ]));
      throwIfCancelled(signal);
    }

    const stillMissing = [];
    for (const entry of entries) {
      try {
        await prepare(deps.getAuctionInfo(entry.name));
      } catch (error) {
        if (/auction not found/i.test(error?.message || '')) stillMissing.push(entry.name);
        else throw error;
      }
    }
    if (stillMissing.length) {
      throw new Error(`Wallet still missing auction data for: ${stillMissing.map(name => `${name}/`).join(', ')}.`);
    }

    throwIfCancelled(signal);
    setPhase(BID_SUBMISSION_PHASES.BROADCASTING);
    broadcastStarted = true;
    const payload = entries.map(entry => ({
      name: entry.name,
      bid: entry.bid,
      lockup: entry.lockup,
    }));

    let result;
    try {
      result = await waitForControlledPromise(deps.broadcast(payload), {
        timeoutMs: broadcastTimeoutMs,
        timeoutError: createSubmissionError(
          'Broadcast did not return before the safety timeout. Its outcome is uncertain, so retry is disabled.',
          {code: 'BASKET_BROADCAST_AMBIGUOUS', stage: BID_SUBMISSION_PHASES.BROADCASTING},
        ),
      });
    } catch (error) {
      const acceptedMatch = /Transaction ([0-9a-f]{64}) was accepted by the network/i
        .exec(error?.message || '');
      if (acceptedMatch) {
        // Network acceptance with a local history-write error is still a
        // successful broadcast. Keep the txid and do not offer retry.
        result = {txid: acceptedMatch[1]};
      } else {
        let matches;
        try {
          matches = await findNewBasketTransactions(entries, baseline, deps.findTransactions);
        } catch (reconcileError) {
          throw createSubmissionError(
            `${error.message || 'Basket broadcast failed.'} Wallet history reconciliation also failed, so retry is disabled.`,
            {
              code: 'BASKET_BROADCAST_AMBIGUOUS',
              stage: BID_SUBMISSION_PHASES.BROADCASTING,
              retryAllowed: false,
              broadcastUncertain: true,
            },
          );
        }
        if (matches.length === 1) {
          result = matches[0];
        } else {
          throw createSubmissionError(error.message || 'Basket broadcast failed.', {
            code: error.code || 'BASKET_BROADCAST_FAILED',
            stage: BID_SUBMISSION_PHASES.BROADCASTING,
            retryAllowed: matches.length === 0 && isDefiniteBroadcastFailure(error),
            broadcastUncertain: !isDefiniteBroadcastFailure(error) || matches.length > 1,
          });
        }
      }
    }

    let txid = result?.txid || result?.hash || result?.id;
    if (!txid) {
      const matches = await findNewBasketTransactions(entries, baseline, deps.findTransactions);
      if (matches.length === 1) txid = matches[0].txid;
    }
    if (!txid) {
      throw createSubmissionError(
        'Broadcast returned without a transaction ID. Retry is disabled until wallet history confirms the outcome.',
        {
          code: 'BASKET_BROADCAST_AMBIGUOUS',
          stage: BID_SUBMISSION_PHASES.BROADCASTING,
          retryAllowed: false,
          broadcastUncertain: true,
        },
      );
    }

    for (const entry of entries) {
      try {
        await deps.storeName(entry.name);
      } catch (error) {
        console.error(`Could not store submitted basket name ${entry.name}:`, error);
      }
    }
    try {
      await deps.refreshPending();
    } catch (error) {
      console.error('Could not refresh pending transactions after basket submission:', error);
    }
    setPhase(BID_SUBMISSION_PHASES.SUBMITTED, {txid});
    return {txid};
  } catch (error) {
    if (error?.code === 'BASKET_SUBMISSION_CANCELLED') throw error;

    let retryAllowed = !!error.retryAllowed;
    let broadcastUncertain = !!error.broadcastUncertain;
    if (!broadcastStarted) {
      try {
        const matches = baseline
          ? await findNewBasketTransactions(entries, baseline, deps.findTransactions)
          : null;
        retryAllowed = !!matches && matches.length === 0;
        broadcastUncertain = !!matches && matches.length > 0;
      } catch (reconcileError) {
        retryAllowed = false;
        broadcastUncertain = true;
      }
    }

    const wrapped = createSubmissionError(error.message || 'Basket submission failed.', {
      code: error.code || 'BASKET_SUBMISSION_FAILED',
      stage: error.stage || stage,
      retryAllowed,
      broadcastUncertain,
    });
    setPhase(BID_SUBMISSION_PHASES.FAILED, {
      error: wrapped.message,
      failedStage: wrapped.stage,
      retryAllowed,
      broadcastUncertain,
    });
    throw wrapped;
  }
}

/**
 * Place multiple bids in one batch transaction (Auction Basket).
 * @param {Array<{name: string, bid: number|string, lockup: number|string, height?: number}>} entries
 *   bid/lockup in base units.
 */
export const sendBidMany = (entries, options = {}) => async (dispatch, getState) => {
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

  const submissionKey = basketSubmissionKey(wallet.wid, entries);
  const existing = basketSubmissionLocks.get(submissionKey);
  if (existing) {
    throw createSubmissionError(
      existing.txid
        ? `This basket already produced transaction ${existing.txid}. Duplicate submission is blocked.`
        : 'The previous broadcast outcome for this basket is still uncertain. Duplicate submission is blocked.',
      {
        code: 'BASKET_DUPLICATE_BLOCKED',
        stage: BID_SUBMISSION_PHASES.BROADCASTING,
        retryAllowed: false,
        broadcastUncertain: !existing.txid,
      },
    );
  }

  try {
    const result = await submitBidManyLifecycle(entries, {
      requestPassphrase: () => new Promise((resolve, reject) => {
        dispatch(getPassphrase(resolve, reject));
      }),
      getAuctionInfo: name => walletClient.getAuctionInfo(name),
      getNameInfo: name => nodeClient.getNameInfo(name),
      importNames: (names, importOptions) => walletClient.importNames(names, importOptions),
      waitForSync: waitOptions => dispatch(waitForWalletSync(600, {
        ...waitOptions,
        requireRescanStart: true,
      })),
      findTransactions: names => walletClient.findBasketBidTransactions(names),
      broadcast: payload => {
        basketSubmissionLocks.set(submissionKey, {status: 'pending'});
        return walletClient.sendBidMany(payload);
      },
      storeName: name => namesDb.storeName(name),
      refreshPending: () => dispatch(fetchPendingTransactions()),
    }, options);
    basketSubmissionLocks.set(submissionKey, {status: 'submitted', txid: result.txid});
    return result;
  } catch (error) {
    if (error.broadcastUncertain) {
      basketSubmissionLocks.set(submissionKey, {status: 'uncertain'});
    } else {
      basketSubmissionLocks.delete(submissionKey);
    }
    throw error;
  }
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
