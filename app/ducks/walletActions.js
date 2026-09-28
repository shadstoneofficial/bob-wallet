import walletClient from '../utils/walletClient';
import nodeClient from '../utils/nodeClient';
import throttle from 'lodash.throttle';
import { getMaxIdleMinutes, setMaxIdleMinutes } from '../db/system';
import { getMultisigKeyName, setMultisigKeyName, delMultisigKeyName } from '../db/wallet';
import {
  GET_PASSPHRASE,
  INCREMENT_IDLE,
  LOCK_WALLET,
  SET_PHRASE_MISMATCH,
  RESET_IDLE,
  SET_MAX_IDLE,
  SET_PENDING_TRANSACTIONS,
  SET_PENDING_TRANSACTIONS_WARNING,
  SET_TRANSACTIONS,
  SET_WALLET,
  START_SYNC_WALLET,
  STOP_SYNC_WALLET,
  UNLOCK_WALLET,
  SET_API_KEY,
  SET_FETCHING,
  INVALIDATE_WALLET_REQUESTS,
} from './walletReducer';
import { NEW_BLOCK_STATUS } from './nodeReducer';
import {setNames} from "./myDomains";
import {setFilter, setYourBids} from "./bids";
import {startRequestTrace} from '../utils/requestTrace';
import {CLEAR_NAMES} from './namesReducer';

let idleInterval;

export const invalidateWalletRequests = (wid) => ({
  type: INVALIDATE_WALLET_REQUESTS,
  payload: wid,
});

export function isCurrentWalletRequest(getState, generation, wid) {
  const wallet = getState().wallet;
  const activeWid = wallet.requestWallet || wallet.wid;
  return (wallet.requestGeneration || 0) === generation && activeWid === wid;
}

export const setWallet = opts => {
  const {
    wid = '',
    watchOnly = false,
    initialized = false,
    type = '',
    receiveAddress = '',
    balance = {},
    apiKey = '',
    changeDepth,
    receiveDepth,
    accountKey = '',
    keys = [],
    keysNames = {},
    m = null,
    n = null,
  } = opts;

  return {
    type: SET_WALLET,
    payload: {
      wid,
      watchOnly,
      initialized,
      type,
      receiveAddress,
      balance,
      apiKey,
      changeDepth,
      receiveDepth,
      accountKey,
      keys,
      keysNames,
      m,
      n,
    },
  };
};

export const completeInitialization = (name, passphrase) => async (dispatch, getState) => {
  dispatch(invalidateWalletRequests(name));
  await walletClient.unlock(name, passphrase);
  await dispatch(fetchWallet());
  dispatch({
    type: UNLOCK_WALLET,
  });
};

export const fetchWalletAPIKey = () => async (dispatch) => {
  const apiKey = await walletClient.getAPIKey();
  dispatch({
    type: SET_API_KEY,
    payload: apiKey,
  });
};

export const fetchWallet = () => async (dispatch, getState) => {
  const {network, wid, requestGeneration, requestWallet} = getState().wallet;
  const expectedWid = requestWallet || wid;

  const maxIdle = await getMaxIdleMinutes();
  dispatch({
    type: SET_MAX_IDLE,
    payload: maxIdle ?? 5,
  })

  const accountInfo = await walletClient.getAccountInfo();
  if (!accountInfo) {
    throw new Error('Could not load wallet.');
  }
  if (!isCurrentWalletRequest(getState, requestGeneration, expectedWid)
    || accountInfo.wid !== expectedWid) {
    return null;
  }

  if (accountInfo.type === 'multisig') {
    accountInfo.keysNames = {};
    for (const [idx, key] of accountInfo.keys.entries()) {
      accountInfo.keysNames[key] = await getMultisigKeyName(network, expectedWid, key) || `Signer #${idx+2}`;
      if (!isCurrentWalletRequest(getState, requestGeneration, expectedWid)) {
        return null;
      }
    }
  }

  dispatch(setWallet(accountInfo));
};

export const setAccountDepth = (changeDepth = 0, receiveDepth = 0) => async () => {
  return walletClient.updateAccountDepth(changeDepth, receiveDepth);
}

export const hasAddress = (address) => async () => {
  return walletClient.hasAddress(address);
};

export const revealSeed = (passphrase) => async () => {
  return walletClient.revealSeed(passphrase);
};

export const addSharedKey = (accountKey, name) => async (dispatch, getState) => {
  const {network, wid} = getState().wallet;
  const res = await walletClient.addSharedKey('default', accountKey);
  await setMultisigKeyName(network, wid, accountKey, name);
  return res;
};

export const removeSharedKey = (accountKey) => async (dispatch, getState) => {
  const {network, wid} = getState().wallet;
  const res = await walletClient.removeSharedKey('default', accountKey);
  await delMultisigKeyName(network, wid, accountKey);
  return res;
};

export const unlockWallet = (name, passphrase) => async (dispatch, getState) => {
  if (name !== getState().wallet.wid) {
    dispatch(invalidateWalletRequests(name));
  }

  await walletClient.unlock(name, passphrase);

  if (name !== getState().wallet.wid) {
    dispatch({
      type: SET_TRANSACTIONS,
      payload: new Map(),
    });
    dispatch({type: CLEAR_NAMES});

    dispatch(setNames({}));
    dispatch(setYourBids({
      order: [],
      map: {},
    }));
    dispatch(setFilter({
      OPENING: [],
      BIDDING: [],
      REVEAL: [],
      CLOSED: [],
      TRANSFER: [],
      NEED_REVEAL: [],
    }))
  }

  dispatch({
    type: UNLOCK_WALLET,
  });
};

export const lockWallet = () => async (dispatch) => {
  await walletClient.lock();
  dispatch({
    type: LOCK_WALLET,
  });
};

export const verifyPhrase = (passphrase) => async (dispatch, getState) => {
  const {watchOnly} = getState().wallet;
  if (watchOnly) {
    dispatch({
      type: SET_PHRASE_MISMATCH,
      payload: false,
    })
    return;
  };

  const {phraseMatchesKey} = await walletClient.revealSeed(passphrase);

  dispatch({
    type: SET_PHRASE_MISMATCH,
    payload: !phraseMatchesKey,
  })
}

export const reset = () => async (dispatch, getState) => {
  await walletClient.reset();
  return dispatch(fetchWallet());
};

export const send = (to, amount, fee) => async (dispatch) => {
  await new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
  const res = await walletClient.send(to, amount, fee);
  await dispatch(fetchWallet());
  return res;
};

export const startWalletSync = () => async (dispatch) => {
  await dispatch({type: START_SYNC_WALLET});
};

export const stopWalletSync = () => async (dispatch) => {
  await dispatch({type: STOP_SYNC_WALLET});
};

const WALLET_SYNC_STALL_LIMIT_SECONDS = 180;

/**
 * @param {number} [stallLimitSeconds] - seconds without progress before failing
 */
export const waitForWalletSync = (
  stallLimitSeconds = WALLET_SYNC_STALL_LIMIT_SECONDS,
  options = {},
) => async (dispatch, getState) => {
  let lastProgressKey = '';
  let stall = 0;
  let sawRescan = !options.requireRescanStart;
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : null;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0
    ? options.pollIntervalMs
    : 1000;
  const limit = Number.isFinite(stallLimitSeconds) && stallLimitSeconds > 0
    ? stallLimitSeconds
    : WALLET_SYNC_STALL_LIMIT_SECONDS;

  for (; ;) {
    if (options.signal?.aborted) {
      const error = new Error('Stopped waiting for wallet synchronization.');
      error.code = 'BASKET_SUBMISSION_CANCELLED';
      throw error;
    }
    if (timeoutMs && Date.now() - startedAt >= timeoutMs) {
      const error = new Error('Wallet rescan did not finish before the preparation timeout. No transaction was sent.');
      error.code = 'BASKET_PREPARATION_TIMEOUT';
      throw error;
    }

    const state = getState();
    if (state.storage?.blocked) {
      const transactionMessage = state.storage.transactionAttempted
        ? ' The transaction may not have been submitted. Check transaction history after resolving the storage issue.'
        : '';
      throw new Error(
        `Bob cannot continue because your device is low on storage.${transactionMessage}`
      );
    }

    const nodeHeight = state.node.chain.height;
    const {walletHeight, rescanHeight, walletSync} = state.wallet;

    if (!sawRescan && walletSync && rescanHeight !== null) {
      sawRescan = true;
    }

    if (!sawRescan) {
      // The import RPC was dispatched, but its rescan progress event has not
      // reached Redux yet. Do not mistake the pre-rescan synchronized state for
      // completion.
    } else if (walletSync) {
      if (rescanHeight === null || walletHeight >= rescanHeight) {
        break;
      }
    } else if (nodeHeight && walletHeight >= nodeHeight) {
      break;
    }

    let progress;
    if (walletSync && rescanHeight) {
      progress = walletHeight / rescanHeight * 100;
    } else if (nodeHeight) {
      progress = walletHeight / nodeHeight * 100;
    } else {
      progress = 0;
    }

    const progressKey = `${walletSync}:${walletHeight}:${rescanHeight}:${nodeHeight}:${progress.toFixed(4)}`;
    if (lastProgressKey === progressKey) {
      stall++;
    } else {
      lastProgressKey = progressKey;
      stall = 0;
    }

    if (stall >= limit) {
      throw new Error(
        'Wallet sync progress has stalled. Leave Bob open until the top-right status shows Synchronized, then retry. Do not submit another basket while rescanning.'
      );
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
};

export function collectOpenedNames(txs) {
  const names = new Map();

  for (const tx of txs || []) {
    for (const output of tx.outputs || []) {
      const covenant = output.covenant;
      if (!covenant || covenant.action !== 'OPEN'
        || !Array.isArray(covenant.items) || covenant.items.length < 3) {
        continue;
      }

      try {
        const name = Buffer.from(covenant.items[2], 'hex').toString('ascii');
        if (name) names.set(covenant.items[0], name);
      } catch (error) {
        // Malformed historical data will use the normal node lookup path.
      }
    }
  }

  return names;
}

export const fetchTransactions = () => async (dispatch, getState) => {
  const state = getState();
  const net = state.wallet.network;
  const currentTXs = state.wallet.transactions;
  const generation = state.wallet.requestGeneration || 0;
  const wid = state.wallet.wid;

  if (state.wallet.isFetching) {
    return;
  }

  const trace = startRequestTrace({
    operation: 'transaction-history',
    caller: 'walletActions.fetchTransactions',
    walletGeneration: generation,
  });

  dispatch({
    type: SET_FETCHING,
    payload: true,
  });


  try {
    const txs = await walletClient.getTransactionHistory();
    if (!isCurrentWalletRequest(getState, generation, wid)) {
      trace.cancel();
      return;
    }

    let payload = new Map();
    const openedNames = collectOpenedNames(txs);

    for (let i = 0; i < txs.length; i++) {
      if (!isCurrentWalletRequest(getState, generation, wid)) {
        trace.cancel();
        return;
      }

      const tx = txs[i];
      const {time, block} = tx;
      const existing = currentTXs.get(tx.hash);

      if (existing) {
        const isPending = !block;
        existing.date = isPending ? Date.now() : time * 1000;
        existing.pending = isPending;

        payload.set(existing.id, existing);
        continue;
      }

      if (!(i % 100)) {
        dispatch({
          type: NEW_BLOCK_STATUS,
          payload: `Processing TX: ${i}/${txs.length}`,
        });
      }

      const ios = await parseInputsOutputs(net, tx, openedNames);
      if (!isCurrentWalletRequest(getState, generation, wid)) {
        trace.cancel();
        return;
      }
      const isPending = !block;
      const txData = {
        id: tx.hash,
        date: isPending ? Date.now() : time * 1000,
        pending: isPending,
        ...ios,
      };

      payload.set(tx.hash, txData);
    }

    // Sort all TXs by date without losing the hash->tx mapping
    payload = new Map([...payload.entries()].sort((a, b) => b[1].date - a[1].date));

    if (isCurrentWalletRequest(getState, generation, wid)) {
      dispatch({
        type: SET_TRANSACTIONS,
        payload,
      });
      trace.complete();
    }
  } catch (error) {
    trace.fail();
    throw error;
  } finally {
    if (isCurrentWalletRequest(getState, generation, wid)) {
      dispatch({type: NEW_BLOCK_STATUS, payload: ''});
      dispatch({
        type: SET_FETCHING,
        payload: false,
      });
    }
  }
};

export const fetchPendingTransactions = () => async (dispatch, getState) => {
  const state = getState();
  const generation = state.wallet.requestGeneration || 0;
  const wid = state.wallet.wid;

  if (!state.wallet.initialized) {
    return;
  }

  let result;
  try {
    const pendingTxs = await walletClient.getPendingTransactions();
    if (!isCurrentWalletRequest(getState, generation, wid)) return;
    result = await processPendingTransactions(state.names, pendingTxs);
  } catch (error) {
    if (!isCurrentWalletRequest(getState, generation, wid)) return;
    console.error('Could not enrich names with pending transactions.', error);
    dispatch({
      type: SET_PENDING_TRANSACTIONS_WARNING,
      payload: {general: true, hashes: []},
    });
    return;
  }
  if (!isCurrentWalletRequest(getState, generation, wid)) return;

  // SET_PENDING_TRANSACTIONS takes payload to replace `state.names`
  dispatch({
    type: SET_PENDING_TRANSACTIONS,
    payload: result.names,
  });
  dispatch({
    type: SET_PENDING_TRANSACTIONS_WARNING,
    payload: result.warning,
  });
};

const incrementIdle = () => ({
  type: INCREMENT_IDLE,
});

export const resetIdle = () => ({
  type: RESET_IDLE,
});

export const setMaxIdle = (maxIdle) => async (dispatch) => {
  await setMaxIdleMinutes(maxIdle);
  dispatch({
    type: SET_MAX_IDLE,
    payload: maxIdle,
  })
};

export const getPassphrase = (resolve, reject) => async (dispatch, getState) => {
  if (getState().wallet.watchOnly === true) {
    resolve();
    return;
  }

  dispatch({
    type: GET_PASSPHRASE,
    payload: {get: true, resolve, reject},
  })
};

export const closeGetPassphrase = () => ({
  type: GET_PASSPHRASE,
  payload: {get: false},
});

export const waitForPassphrase = () => async (dispatch) => {
  return new Promise((resolve, reject) => {
    dispatch(getPassphrase(resolve, reject));
  });
};

export const watchActivity = () => dispatch => {
  if (!idleInterval) {
    // Increment idle once a minute
    setInterval(() => dispatch(incrementIdle()), 60000);

    // Reset idle time to zero on any activity, throttled by 5 seconds
    const handler = throttle(() => dispatch(resetIdle()), 5000, {leading: true});
    document.addEventListener('mousemove', handler);
    document.addEventListener('keypress', handler);
  }
};

async function parseInputsOutputs(net, tx, openedNames = new Map()) {
  // Look for covenants. A TX with multiple covenant types is not supported
  let covAction = null;
  let covValue = 0;
  let covDomains = new Set();
  let covData = {};
  let count = 0;
  let totalValue = 0;
  for (let i = 0; i < tx.outputs.length; i++) {
    const output = tx.outputs[i];

    // Find outputs to the wallet's receive branch
    if (output.path && output.path.change)
      continue;

    const covenant = output.covenant;

    // Track normal receive amounts for later
    if (covenant.action === 'NONE') {
      if (output.path) {
        totalValue += output.value;
      }
      continue;
    }
    // Stay focused on the first non-NONE covenant type, ignore other types
    if (covAction && covenant.action !== covAction)
      continue;

    covAction = covenant.action;

    // Special case for reveals and registers, indicate how much
    // spendable balance is returning to the wallet
    // as change from the mask on the bid, or the difference
    // between the highest and second-highest bid.
    if (covenant.action === 'REVEAL'
      || covenant.action === 'REGISTER') {
      covValue += !output.path
        ? output.value
        : tx.inputs[i].value - output.value;
    } else {
      // Special case for reserved name claims, we are receiving
      // coins but they are locked. The spendable balance will
      // be incremented by the reward value when we REGISTER.
      // (The name's value is burned at 0 but we get the reward as change)
      if (covenant.action !== 'CLAIM')
        covValue += output.value;
    }

    if (covenant.action == 'FINALIZE') {
      const isSender = output.path == null;

      // Start with no payment for normal Finalizes
      covValue = 0;

      // containsOtherOutputs: Look for outputs that are not change addresses to self
      if (isSender) {
        // If yes, sum all self outputs (payment made by receiver)
        const containsOtherOutputs = tx.outputs.findIndex(x => x.covenant.action == 'NONE' && x.path === null) !== -1;
        if (containsOtherOutputs) covValue = tx.outputs.reduce((sum, op) => op.path ? (sum+op.value) : sum, 0);
      } else {
        // If yes, sum all outputs to others' addresses (payment made to sender)
        const containsOtherOutputs = tx.outputs.findIndex(x => x.covenant.action == 'NONE' && x.path !== null) !== -1;
        if (containsOtherOutputs) covValue = -tx.outputs.reduce((sum, op) => !op.path ? (sum+op.value) : sum, 0);
      }
    }

    // Renewals and Updates have a value, but it doesn't
    // affect the spendable balance of the wallet.
    if (covenant.action === 'RENEW' ||
      covenant.action === 'UPDATE') {
      covValue = 0;
    }

    if (covenant.action === 'TRANSFER' ) {
      if (output.path) {
        covValue = 0;
      } else {
        covValue = getNetValue(tx);
      }
    }

    // May be called redundantly but should be handled by cache
    covData = await parseCovenant(net, covenant, openedNames);

    if (covData.meta?.domain) {
      covDomains.add(covData.meta.domain);
    }

    // Identify this TX as having multiple actions
    count++;
    covData.meta.multiple = count > 1;
  }

  // This TX was a covenant, return.
  if (covAction) {
    return {
      ...covData,
      fee: tx.fee,
      value: covValue,
      domains: Array.from(covDomains),
    };
  }

  // If there were outputs to the wallet's receive branch
  // but no covenants, this was just a plain receive.
  // Note: assuming input[0] is the "from" is not really helpful data.
  if (totalValue > 0) {
    return {
      type: tx.inputs[0].address === null ? 'COINBASE' : 'RECEIVE',
      meta: {
        from: tx.inputs[0].address,
      },
      value: totalValue,
      fee: tx.fee,
    };
  }

  // This TX must have been a plain send from the wallet.
  // Assume that the first non-wallet output of the TX is the "to".
  const output = tx.outputs.filter(({path}) => !path)[0];
  if (!output) {
    return {
      type: 'UNKNOWN',
      meta: {},
      fee: tx.fee,
      value: 0,
    };
  }

  return {
    type: 'SEND',
    meta: {
      to: output.address,
    },
    value: output.value,
    fee: tx.fee,
  };
}

function getNetValue(tx) {
  let totalValue = 0;

  for (let i = 0; i < tx.outputs.length; i++) {
    const output = tx.outputs[i];
    if (output.path) {
      totalValue += output.value;
    }
  }

  for (let j = 0; j < tx.inputs.length; j++) {
    const input = tx.inputs[j];
    if (input.path) {
      totalValue -= input.value;
    }
  }

  return totalValue;
}

async function parseCovenant(net, covenant, openedNames) {
  switch (covenant.action) {
    case 'CLAIM':
      return {type: 'CLAIM', meta: {domain: await nameByHash(net, covenant, openedNames)}};
    case 'OPEN':
      return {type: 'OPEN', meta: {domain: await nameByHash(net, covenant, openedNames)}};
    case 'BID':
      return {type: 'BID', meta: {domain: await nameByHash(net, covenant, openedNames)}};
    case 'REVEAL':
      return {type: 'REVEAL', meta: {domain: await nameByHash(net, covenant, openedNames)}};
    case 'UPDATE':
      return {
        type: 'UPDATE',
        meta: {
          domain: await nameByHash(net, covenant, openedNames),
          data: covenant.items[2],
        },
      };
    case 'REGISTER':
      return {
        type: 'REGISTER',
        meta: {
          domain: await nameByHash(net, covenant, openedNames),
          data: covenant.items[2],
        },
      };
    case 'RENEW':
      return {
        type: 'RENEW',
        meta: {
          domain: await nameByHash(net, covenant, openedNames),
        },
      };
    case 'REDEEM':
      return {
        type: 'REDEEM',
        meta: {
          domain: await nameByHash(net, covenant, openedNames),
        },
      };
    case 'TRANSFER':
      return {
        type: 'TRANSFER',
        meta: {
          domain: await nameByHash(net, covenant, openedNames),
        },
      };
    case 'REVOKE':
      return {
        type: 'REVOKE',
        meta: {
          domain: await nameByHash(net, covenant, openedNames),
        },
      };
    case 'FINALIZE':
      return {
        type: 'FINALIZE',
        meta: {
          domain: await nameByHash(net, covenant, openedNames),
        },
      };
    default:
      return {type: 'UNKNOWN', meta: {}};
  }
}

const MAX_NAME_CACHE_SIZE = 500;

const nameCache = {
  currNet: null,
  cache: {},
};

async function nameByHash(net, covenant, openedNames = new Map()) {
  if (nameCache.currNet !== net) {
    nameCache.currNet = net;
    nameCache.cache = {};
  }

  if (Object.keys(nameCache.cache).length > MAX_NAME_CACHE_SIZE) {
    nameCache.cache = {};
  }

  const hash = covenant.items[0];

  if (openedNames.has(hash)) {
    return openedNames.get(hash);
  }

  if (nameCache.cache[hash]) {
    return nameCache.cache[hash];
  }

  let name = await nodeClient.getNameByHash(hash);

  if (!name && covenant.action === 'OPEN') {
    // Before an OPEN is confirmed, the name->hash mapping will not be present
    // in the full node. Luckily, the name is included as an ASCII string in
    // the covenant itself.
    name = Buffer.from(covenant.items[2], 'hex').toString('ascii');
  }

  if (name) {
    nameCache.cache[hash] = name;
  }

  return name;
}

// For processPendingTransactions
const ALLOWED_COVENANTS = new Set([
  'OPEN',
  'BID',
  'REVEAL',
  'UPDATE',
  'REGISTER',
  'RENEW',
  'REDEEM',
  'TRANSFER',
  'FINALIZE',
]);

/**
 * Process Pending Transactions
 * Parse covenant values as needed and add `pendingOperation[Meta]` to state.names
 * @param {Object} names state.names
 * @param {TX[]} pendingTxs result of walletClient.getPendingTransactions()
 * @returns {{names: Object, warning: ?Object}} normalized names and warning scope
 */
export async function processPendingTransactions(names = {}, pendingTxs = []) {
  const pendingByHash = new Map();
  const warningHashes = new Set();
  let generalWarning = false;

  if (!Array.isArray(pendingTxs)) {
    pendingTxs = [];
    generalWarning = true;
  }

  for (const entry of pendingTxs) {
    const outputs = entry?.tx?.outputs;
    if (!Array.isArray(outputs)) {
      generalWarning = true;
      continue;
    }

    for (const output of outputs) {
      const covenant = output?.covenant;
      const action = covenant?.action;
      if (!ALLOWED_COVENANTS.has(action)) continue;

      const hash = Array.isArray(covenant.items) ? covenant.items[0] : null;
      if (typeof hash !== 'string' || !hash) {
        generalWarning = true;
        continue;
      }

      if (action === 'BID' && (covenant.items.length < 4 || !covenant.items[3])) {
        warningHashes.add(hash);
      }
      if ((action === 'UPDATE' || action === 'REGISTER') && covenant.items.length < 3) {
        warningHashes.add(hash);
      }

      const aggregate = pendingByHash.get(hash) || {operations: [], bidOutputs: []};
      aggregate.operations.push({action, covenant, output});
      if (action === 'BID') aggregate.bidOutputs.push(output);
      pendingByHash.set(hash, aggregate);
    }
  }

  const oldNames = Object.keys(names || {});
  const newNames = {};
  for (const name of oldNames) {
    const data = names[name];
    const hash = data.hash;
    const aggregate = pendingByHash.get(hash) || {operations: [], bidOutputs: []};
    const primary = aggregate.operations[aggregate.operations.length - 1];
    const pendingOp = primary?.action || null;
    const pendingOperationMeta = {
      operations: aggregate.operations,
      bids: [],
    };

    if (pendingOp === 'UPDATE' || pendingOp === 'REGISTER') {
      pendingOperationMeta.data = primary.covenant.items[2];
    }

    if (pendingOp === 'REVEAL') {
      pendingOperationMeta.output = primary.output;
    }

    if (aggregate.bidOutputs.length) {
      const promises = aggregate.bidOutputs.map(async output => {
        const blind = output.covenant.items[3] || null;
        let bv = null;
        if (blind) {
          try {
            bv = await walletClient.getBlind(blind);
          } catch (error) {
            warningHashes.add(hash);
          }
        }
        if (bv?.value == null) {
          warningHashes.add(hash);
        }

        return {
          value: output.value,
          height: -1,
          from: output.address,
          date: null,
          bid: {
            value: bv?.value || null,
            prevout: null,
            own: true,
            namehash: hash,
            name: name,
            lockup: output.value,
            blind: blind,
          },
        }
      });

      pendingOperationMeta.bids = await Promise.all(promises);
    }

    newNames[name] = {
      ...data,
      pendingOperation: pendingOp || null,
      pendingOperationMeta,
      pendingMetadataMalformed: warningHashes.has(hash),
    };
  }

  return {
    names: {
      ...names,
      ...newNames,
    },
    warning: generalWarning || warningHashes.size
      ? {general: generalWarning, hashes: [...warningHashes]}
      : null,
  };
}
