export const SET_WALLET = 'app/wallet/setWallet';
export const SET_BALANCE = 'app/wallet/setBalance';
export const UNLOCK_WALLET = 'app/wallet/unlockWallet';
export const LOCK_WALLET = 'app/wallet/lockWallet';
export const SET_PHRASE_MISMATCH = 'app/wallet/verifyPhraseMismatch';
export const SET_TRANSACTIONS = 'app/wallet/setTransactions';
export const INCREMENT_IDLE = 'app/wallet/incrementIdle';
export const RESET_IDLE = 'app/wallet/resetIdle';
export const SET_MAX_IDLE = 'app/wallet/setMaxIdle';
export const SET_PENDING_TRANSACTIONS = 'app/wallet/setPendingTransactions';
export const SET_PENDING_TRANSACTIONS_WARNING = 'app/wallet/setPendingTransactionsWarning';
export const START_SYNC_WALLET = 'app/wallet/startSyncWallet';
export const STOP_SYNC_WALLET = 'app/wallet/stopSyncWallet';
export const SYNC_WALLET_PROGRESS = 'app/wallet/syncWalletProgress';
export const SET_RESCAN_STATE = 'app/wallet/setRescanState';
export const SET_RESCAN_HEIGHT = 'app/wallet/setRescanHeight';
export const GET_PASSPHRASE = 'app/wallet/getPassphrase';
export const SET_API_KEY = 'app/wallet/setApiKey';
export const SET_FETCHING = 'app/wallet/setFetching';
export const SET_WALLETS = 'app/wallet/setWallets';
export const SET_WALLET_NETWORK = 'app/wallet/setNetwork';
export const SET_FIND_NONCE_PROGRESS = 'app/wallet/setFindNonceProgress';
export const SET_BASKET_SUBMISSION_PROGRESS = 'app/wallet/setBasketSubmissionProgress';
export const INVALIDATE_WALLET_REQUESTS = 'app/wallet/invalidateRequests';

export function getInitialState() {
  return {
    receiveAddress: '',
    apiKey: '',
    wid: '',
    type: '',
    watchOnly: false,
    isLocked: true,
    phraseMismatch: false,
    isFetching: false,
    initialized: false,
    balanceReady: false,
    balanceContext: null,
    network: '',
    balance: {
      confirmed: 0,
      unconfirmed: 0,
      lockedConfirmed: 0,
      lockedUnconfirmed: 0,
    },
    changeDepth: 0,
    receiveDepth: 0,
    accountKey: '',
    keys: [],
    keysNames: {},
    transactions: new Map(),
    idle: 0,
    maxIdle: 5,
    walletSync: false,
    walletHeight: 0,
    rescanHeight: null,
    rescanStatus: null,
    rescanGeneration: 0,
    rescanBackendGeneration: 0,
    rescanManaged: null,
    rescanReady: null,
    activeRescanRequestIds: [],
    completedRescanRequestIds: [],
    getPassphrase: {get: false},
    wallets: [],
    walletsDetails: {},
    findNonceProgress: {
      expectedBlind: '',
      progress: -1,
      isFinding: false,
      found: false,
      bidValue: null,
    },
    basketSubmissionProgress: {
      attemptId: '',
      phase: 'idle',
      txid: '',
      broadcastAttempted: false,
      timings: {},
    },
    pendingTransactionsWarning: null,
    requestGeneration: 0,
    requestWallet: '',
    m: null,
    n: null,
  };
}

export default function walletReducer(state = getInitialState(), {type, payload}) {
  switch (type) {
    case SET_WALLET:
      return {
        ...state,
        balanceReady: true,
        balanceContext: payload.balanceContext || null,
        transactions: state.wid === payload.wid
          ? state.transactions
          : new Map(),
        wid: payload.wid,
        watchOnly: payload.watchOnly,
        receiveAddress: payload.receiveAddress,
        type: payload.type,
        balance: {
          ...state.balance,
          confirmed: payload.balance.confirmed,
          unconfirmed: payload.balance.unconfirmed,
          lockedUnconfirmed: payload.balance.lockedUnconfirmed,
          lockedConfirmed: payload.balance.lockedConfirmed,
          spendable: payload.balance.unconfirmed - payload.balance.lockedUnconfirmed,
        },
        changeDepth: payload.changeDepth,
        receiveDepth: payload.receiveDepth,
        accountKey: payload.accountKey,
        initialized: typeof payload.initialized === 'undefined' ? state.initialized : payload.initialized,
        keys: payload.keys,
        keysNames: payload.keysNames,
        m: payload.m,
        n: payload.n,
        requestWallet: '',
      };
    case INVALIDATE_WALLET_REQUESTS:
      return {
        ...state,
        balanceReady: false,
        requestGeneration: state.requestGeneration + 1,
        requestWallet: payload || state.wid,
        isFetching: false,
        pendingTransactionsWarning: null,
      };
    case SET_BALANCE:
      if (!state.balanceReady || payload.walletId !== state.wid
        || payload.network !== state.network || state.requestWallet
        || !state.balanceContext || payload.balanceContext !== state.balanceContext) return state;
      return {
        ...state,
        balance: {
          ...state.balance,
          confirmed: payload.confirmed,
          unconfirmed: payload.unconfirmed,
          lockedUnconfirmed: payload.lockedUnconfirmed,
          lockedConfirmed: payload.lockedConfirmed,
          spendable: payload.unconfirmed - payload.lockedUnconfirmed,
        }
      };
    case SET_API_KEY:
      return {
        ...state,
        apiKey: payload,
      };
    case SET_WALLET_NETWORK:
      return {
        ...state,
        balanceReady: false,
        network: payload,
      };
    case LOCK_WALLET:
      return {
        ...state,
        balanceReady: false,
        isLocked: true,
      };
    case UNLOCK_WALLET:
      return {
        ...state,
        isLocked: false,
      };
    case SET_PHRASE_MISMATCH:
      return {
        ...state,
        phraseMismatch: payload,
      };
    case SET_TRANSACTIONS:
      return {
        ...state,
        transactions: payload,
      };
    case INCREMENT_IDLE:
      return {
        ...state,
        idle: state.idle + 1,
      };
    case RESET_IDLE:
      return {
        ...state,
        idle: 0,
      };
    case SET_MAX_IDLE:
      return {
        ...state,
        maxIdle: payload,
      };
    case START_SYNC_WALLET:
      return {
        ...state,
        walletSync: true,
      };
    case STOP_SYNC_WALLET:
      return {
        ...state,
        walletSync: false,
      };
    case SYNC_WALLET_PROGRESS:
      return {
        ...state,
        walletHeight: payload,
      };
    case SET_RESCAN_STATE: {
      const backendGeneration = Number.isSafeInteger(payload.backendGeneration)
        ? payload.backendGeneration
        : state.rescanBackendGeneration;
      if (backendGeneration < state.rescanBackendGeneration) return state;
      const backendChanged = backendGeneration !== state.rescanBackendGeneration;
      return {
        ...state,
        rescanStatus: payload.status,
        rescanGeneration: Number.isSafeInteger(payload.generation)
          ? payload.generation
          : backendChanged ? 0 : state.rescanGeneration,
        rescanBackendGeneration: backendGeneration,
        rescanManaged: typeof payload.managed === 'boolean'
          ? payload.managed
          : backendChanged ? null : state.rescanManaged,
        rescanReady: Object.prototype.hasOwnProperty.call(payload, 'ready')
          ? payload.ready
          : backendChanged ? null : state.rescanReady,
        activeRescanRequestIds: Array.isArray(payload.activeRequestIds)
          ? payload.activeRequestIds.filter(id => typeof id === 'string')
          : backendChanged ? [] : state.activeRescanRequestIds,
        completedRescanRequestIds: Array.isArray(payload.completedRequestIds)
          ? payload.completedRequestIds.filter(id => typeof id === 'string')
          : backendChanged ? [] : state.completedRescanRequestIds,
        walletSync: ['starting', 'waiting', 'scanning', 'failed'].includes(payload.status),
        walletHeight: payload.height,
        rescanHeight: payload.status === 'complete' || payload.status === 'idle' ? null : payload.target,
      };
    }
    case SET_RESCAN_HEIGHT:
      return {
        ...state,
        rescanHeight: payload,
      };
    case GET_PASSPHRASE:
      return {
        ...state,
        getPassphrase: payload,
      };
    case SET_FETCHING:
      return {
        ...state,
        isFetching: payload,
      };
    case SET_WALLETS:
      return {
        ...state,
        wallets: payload.wallets,
        walletsDetails: payload.walletsDetails,
      };
    case SET_FIND_NONCE_PROGRESS:
      return {
        ...state,
        findNonceProgress: payload,
      };
    case SET_BASKET_SUBMISSION_PROGRESS:
      return {
        ...state,
        basketSubmissionProgress: {
          ...state.basketSubmissionProgress,
          ...payload,
        },
      };
    case SET_PENDING_TRANSACTIONS_WARNING:
      return {
        ...state,
        pendingTransactionsWarning: payload,
      };
    default:
      return state;
  }
}
