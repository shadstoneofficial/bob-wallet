import walletClient from '../utils/walletClient';
import {INVALIDATE_WALLET_REQUESTS, LOCK_WALLET, SET_WALLET_NETWORK} from './walletReducer';

export const WALLET_STATS_REQUEST = 'app/walletStats/request';
export const WALLET_STATS_SUCCESS = 'app/walletStats/success';
export const WALLET_STATS_FAILURE = 'app/walletStats/failure';
export const WALLET_STATS_INVALIDATE_REDEEMABLE =
  'app/walletStats/invalidateRedeemable';

const EMPTY_STATS = {
  lockedBalance: {
    bidding: {HNS: null, num: null},
    revealable: {HNS: null, num: null, block: null},
    finished: {HNS: null, num: null},
  },
  actionableInfo: {
    revealable: {HNS: null, num: null, block: null},
    redeemable: {HNS: null, num: null},
    renewable: {domains: null, block: null},
    transferring: {domains: null, block: null},
    finalizable: {domains: null},
    registerable: {HNS: null, num: null},
  },
};

let nextRequestId = 0;

export function getInitialState() {
  return {
    ...EMPTY_STATS,
    isLoading: true,
    requestId: 0,
    error: null,
  };
}

export default function walletStatsReducer(
  state = getInitialState(),
  {type, payload} = {},
) {
  switch (type) {
    case INVALIDATE_WALLET_REQUESTS:
    case LOCK_WALLET:
    case SET_WALLET_NETWORK:
      return getInitialState();
    case WALLET_STATS_REQUEST:
      return {
        ...getInitialState(),
        isLoading: true,
        requestId: payload.requestId,
        error: null,
      };
    case WALLET_STATS_SUCCESS:
      if (payload.requestId !== state.requestId) return state;
      return {
        ...state,
        ...payload.stats,
        isLoading: false,
        error: null,
      };
    case WALLET_STATS_FAILURE:
      if (payload.requestId !== state.requestId) return state;
      return {
        ...state,
        isLoading: false,
        error: payload.error,
      };
    case WALLET_STATS_INVALIDATE_REDEEMABLE: {
      const redeemable = state.actionableInfo.redeemable;
      return {
        ...state,
        requestId: payload.requestId,
        lockedBalance: {
          ...state.lockedBalance,
          finished: {
            HNS: Math.max(
              0,
              (state.lockedBalance.finished.HNS || 0) - (redeemable.HNS || 0),
            ),
            num: Math.max(
              0,
              (state.lockedBalance.finished.num || 0) - (redeemable.num || 0),
            ),
          },
        },
        actionableInfo: {
          ...state.actionableInfo,
          redeemable: {HNS: 0, num: 0},
        },
      };
    }
    default:
      return state;
  }
}

export const invalidateRedeemableStats = () => ({
  type: WALLET_STATS_INVALIDATE_REDEEMABLE,
  payload: {requestId: ++nextRequestId},
});

export const fetchWalletStats = () => async (dispatch, getState) => {
  const wallet = getState().wallet;
  if (wallet.requestWallet || wallet.balanceReady === false) return;
  const wid = wallet.requestWallet || wallet.wid;
  const generation = wallet.requestGeneration || 0;
  const network = wallet.network;
  const isCurrent = () => {
    const current = getState().wallet;
    return (current.requestWallet || current.wid) === wid
      && (current.requestGeneration || 0) === generation
      && current.network === network;
  };
  const requestId = ++nextRequestId;
  dispatch({type: WALLET_STATS_REQUEST, payload: {requestId}});

  try {
    const stats = await walletClient.getStats();
    if (!isCurrent()) return;
    dispatch({
      type: WALLET_STATS_SUCCESS,
      payload: {requestId, stats},
    });
    return stats;
  } catch (error) {
    if (!isCurrent()) return;
    dispatch({
      type: WALLET_STATS_FAILURE,
      payload: {requestId, error: error.message},
    });
    throw error;
  }
};
