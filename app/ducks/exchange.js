import { getPassphrase } from './walletActions.js';
import { clientStub as shakedexClientStub } from '../background/shakedex/client.js';
import { clientStub as nodeClientStub } from '../background/node/client.js';
import { showSuccess, showError } from './notifications.js';
import networks from 'hsd/lib/protocol/networks.js';
import {getFinalizeFromTransferTx} from "../utils/shakedex";
import { LISTING_STATUS } from '../constants/exchange.js';
import { SET_WALLET } from './walletReducer.js';

const shakedex = shakedexClientStub(() => require('electron').ipcRenderer);
const nodeClient = nodeClientStub(() => require('electron').ipcRenderer);

export const GET_EXCHANGE_AUCTIONS = 'GET/EXCHANGE_AUCTIONS';
export const GET_EXCHANGE_AUCTIONS_OK = 'GET/EXCHANGE_AUCTIONS/OK';
export const GET_EXCHANGE_AUCTIONS_ERR = 'GET/EXCHANGE_AUCTIONS/ERR';

export const GET_EXCHANGE_FULLFILLMENTS = 'GET/EXCHANGE_FULLFILLMENTS';
export const GET_EXCHANGE_FULLFILLMENTS_OK = 'GET/EXCHANGE_FULLFILLMENTS/OK';
export const GET_EXCHANGE_FULLFILLMENTS_ERR = 'GET/EXCHANGE_FULLFILLMENTS/ERR';

export const GET_EXCHANGE_LISTINGS = 'GET/EXCHANGE_LISTINGS';
export const GET_EXCHANGE_LISTINGS_OK = 'GET/EXCHANGE_LISTINGS/OK';
export const GET_EXCHANGE_LISTINGS_ERR = 'GET/EXCHANGE_LISTINGS/ERR';

export const PLACE_EXCHANGE_BID = 'PLACE_EXCHANGE_BID';
export const PLACE_EXCHANGE_BID_OK = 'PLACE_EXCHANGE_BID/OK';
export const PLACE_EXCHANGE_BID_ERR = 'PLACE_EXCHANGE_BID/ERR';

export const FINALIZE_EXCHANGE_BID = 'FINALIZE_EXCHANGE_BID';
export const FINALIZE_EXCHANGE_BID_OK = 'FINALIZE_EXCHANGE_BID/OK';
export const FINALIZE_EXCHANGE_BID_ERR = 'FINALIZE_EXCHANGE_BID/ERR';

export const CANCEL_EXCHANGE_LISTING = 'CANCEL_EXCHANGE_LISTING';
export const CANCEL_EXCHANGE_LISTING_OK = 'CANCEL_EXCHANGE_LISTING/OK';
export const CANCEL_EXCHANGE_LISTING_ERR = 'CANCEL_EXCHANGE_LISTING/ERR';

export const FINALIZE_CANCEL_EXCHANGE_LISTING = 'FINALIZE_CANCEL_EXCHANGE_LISTING';
export const FINALIZE_CANCEL_EXCHANGE_LISTING_OK = 'FINALIZE_CANCEL_EXCHANGE_LISTING/OK';
export const FINALIZE_CANCEL_EXCHANGE_LISTING_ERR = 'FINALIZE_CANCEL_EXCHANGE_LISTING/ERR';

export const PLACE_EXCHANGE_LISTING = 'PLACE_EXCHANGE_LISTING';
export const PLACE_EXCHANGE_LISTING_OK = 'PLACE_EXCHANGE_LISTING/OK';
export const PLACE_EXCHANGE_LISTING_ERR = 'PLACE_EXCHANGE_LISTING/ERR';

export const FINALIZE_EXCHANGE_LOCK = 'FINALIZE_EXCHANGE_LOCK';
export const FINALIZE_EXCHANGE_LOCK_OK = 'FINALIZE_EXCHANGE_LOCK/OK';
export const FINALIZE_EXCHANGE_LOCK_ERR = 'FINALIZE_EXCHANGE_LOCK/ERR';

export const LAUNCH_EXCHANGE_AUCTION = 'LAUNCH_EXCHANGE_AUCTION';
export const LAUNCH_EXCHANGE_AUCTION_OK = 'LAUNCH_EXCHANGE_AUCTION/OK';
export const LAUNCH_EXCHANGE_AUCTION_ERR = 'LAUNCH_EXCHANGE_AUCTION/ERR';
export const LAUNCH_EXCHANGE_AUCTIONS_BULK = 'LAUNCH_EXCHANGE_AUCTIONS_BULK';
export const LAUNCH_EXCHANGE_AUCTIONS_BULK_OK = 'LAUNCH_EXCHANGE_AUCTIONS_BULK/OK';
export const LAUNCH_EXCHANGE_AUCTIONS_BULK_ERR = 'LAUNCH_EXCHANGE_AUCTIONS_BULK/ERR';
export const CREATE_PRIVATE_SALE_PROOF = 'CREATE_PRIVATE_SALE_PROOF';
export const CREATE_PRIVATE_SALE_PROOF_OK = 'CREATE_PRIVATE_SALE_PROOF/OK';
export const CREATE_PRIVATE_SALE_PROOF_ERR = 'CREATE_PRIVATE_SALE_PROOF/ERR';

export const SET_AUCTIONS_PAGE = 'SET_AUCTION_PAGE';

export const FULFILLMENT_STATUS = {
  NOT_FOUND: 'NOT_FOUND',
  CONFIRMING: 'CONFIRMING',
  CONFIRMED: 'CONFIRMED',
  CONFIRMED_LOCKUP: 'CONFIRMED_LOCKUP',
  FINALIZED: 'FINALIZED',
  FINALIZING: 'FINALIZING',
};


function getInitialState() {
  return {
    listings: [],
    fulfillments: [],
    auctionIds: [],
    auctions: {},
    total: 0,
    currentPage: 1,
    isLoading: false,
    isLoadingListings: false,
    isError: false,
    isPlacingBid: false,
    isPlacingBidError: false,
    placingBidErrorMessage: '',
    finalizingName: null,
    isPlacingListing: false,
    isPlacingListingError: false,
  };
}

export const setAuctionPage = (page) => ({
  type: SET_AUCTIONS_PAGE,
  payload: page,
});

export const getExchangeAuctions = () => async (dispatch, getState) => {
  dispatch({
    type: GET_EXCHANGE_AUCTIONS,
  });

  let auctions;

  const {
    exchange: {
      currentPage,
    },
  } = getState();

  try {
    auctions = await shakedex.getExchangeAuctions(currentPage);
  } catch (e) {
    dispatch({
      type: GET_EXCHANGE_AUCTIONS_ERR,
      payload: {
        message: e.message,
      },
    });
    return;
  }

  dispatch({
    type: GET_EXCHANGE_AUCTIONS_OK,
    payload: {
      auctions: auctions.auctions,
      total: +auctions.total,
    },
  });
};

export const getExchangeFullfillments = () => async (dispatch, getState) => {
  dispatch({
    type: GET_EXCHANGE_FULLFILLMENTS,
  });
  const walletId = getState().wallet.wid;

  let fulfillments;
  try {
    fulfillments = await shakedex.getFulfillments(walletId);
  } catch (e) {
    dispatch({
      type: GET_EXCHANGE_FULLFILLMENTS_ERR,
      payload: {
        message: e.message,
      },
    });
    return;
  }

  if (walletId !== getState().wallet.wid) {
    return;
  }

  const info = await nodeClient.getInfo();
  const transferLockup = networks[info.network].names.transferLockup;

  for (const fulfillment of fulfillments) {
    let fulfillTx;
    let finalizeTx;
    try {
      fulfillTx = await nodeClient.getTx(fulfillment.fulfillment.fulfillmentTxHash);
      finalizeTx = fulfillment.finalize ? await nodeClient.getTx(fulfillment.finalize.finalizeTxHash) : null;
    } catch (e) {
      fulfillment.status = FULFILLMENT_STATUS.NOT_FOUND;
      continue;
    }

    if (!fulfillTx || fulfillTx.height === -1) {
      fulfillment.status = FULFILLMENT_STATUS.CONFIRMING;
      continue;
    }

    if (!finalizeTx) {
      fulfillment.status = info.chain.height - fulfillTx.height > transferLockup ?
        FULFILLMENT_STATUS.CONFIRMED : FULFILLMENT_STATUS.CONFIRMED_LOCKUP;
      continue;
    }

    fulfillment.status = finalizeTx && finalizeTx.height > -1 ? FULFILLMENT_STATUS.FINALIZED : FULFILLMENT_STATUS.FINALIZING;
  }

  if (walletId !== getState().wallet.wid) {
    return;
  }

  dispatch({
    type: GET_EXCHANGE_FULLFILLMENTS_OK,
    payload: {
      fulfillments,
    },
  });
};

export const getExchangeListings = (page = 1) => async (dispatch, getState) => {
  dispatch({
    type: GET_EXCHANGE_LISTINGS,
  });
  const walletId = getState().wallet.wid;

  let listings;
  try {
    listings = await shakedex.getListings(walletId);
  } catch (e) {
    dispatch({
      type: GET_EXCHANGE_LISTINGS_ERR,
      payload: {
        message: e.message,
      },
    });
    return;
  }

  if (walletId !== getState().wallet.wid) {
    return;
  }

  const mtp = await nodeClient.getMTP();
  const info = await nodeClient.getInfo();
  const transferLockup = networks[info.network].names.transferLockup;

  for (const listing of listings) {
    console.log({ listing });

    // deprecated: auction version 1
    listing.deprecated = false;

    // safe: either all bids released or auction not active
    listing.safe = true;

    let transferTx;
    let finalizeTx;
    let finalizeCoin;
    let cancelTx;
    let cancelFinalizeTx;
    let cancelCoin;
    try {
      transferTx = await nodeClient.getTx(listing.nameLock.transferTxHash);

      cancelTx = listing.nameLockCancel
        ? await nodeClient.getTx(listing.nameLockCancel.transferTxHash)
        : null;
      cancelFinalizeTx = listing.cancelFinalize
        ? await nodeClient.getTx(listing.cancelFinalize.finalizeTxHash)
        : null;
      cancelCoin = listing.cancelFinalize
        ? await nodeClient.getCoin(listing.cancelFinalize.finalizeTxHash, listing.cancelFinalize.finalizeOutputIdx)
        : null;
    } catch (e) {
      if (listing.nameLock && listing.nameLock.transferTxHash) {
        listing.status = LISTING_STATUS.TRANSFER_CONFIRMING;
      } else {
        listing.status = LISTING_STATUS.NOT_FOUND;
      }
      continue;
    }

    if (!transferTx || transferTx.height === -1) {
      listing.status = LISTING_STATUS.TRANSFER_CONFIRMING;
      continue;
    }

    const blocksSinceTransfer = info.chain.height - transferTx.height;
    if (blocksSinceTransfer <= transferLockup) {
      listing.blocksUntilFinalize = Math.max(transferLockup - blocksSinceTransfer, 0);
      listing.status = LISTING_STATUS.TRANSFER_CONFIRMED_LOCKUP;
      continue;
    }

    try {
      const finalize = await getFinalizeFromTransferTx(
        listing.nameLock.transferTxHash,
        listing.nameLock.name,
        nodeClient,
      );

      finalizeTx = finalize.tx;
      finalizeCoin = finalize.coin;
    } catch (e) {
      try {
        const nameInfo = await nodeClient.getNameInfo(listing.nameLock.name);
        const owner = nameInfo && nameInfo.info && nameInfo.info.owner;
        if (
          owner
          && owner.hash
          && `${owner.hash}` !== `${listing.nameLock.transferTxHash}`
        ) {
          listing.status = LISTING_STATUS.SOLD;
          listing.supersededByOwner = {
            hash: owner.hash,
            index: owner.index,
          };
          continue;
        }
      } catch (ownerCheckError) {
        console.warn(`Failed to check current owner for Shakedex listing ${listing.nameLock.name}:`, ownerCheckError);
      }

      listing.status = LISTING_STATUS.TRANSFER_CONFIRMED;
      continue;
    }

    if (!finalizeTx) {
      try {
        const nameInfo = await nodeClient.getNameInfo(listing.nameLock.name);
        const owner = nameInfo && nameInfo.info && nameInfo.info.owner;
        if (
          owner
          && owner.hash
          && `${owner.hash}` !== `${listing.nameLock.transferTxHash}`
        ) {
          listing.status = LISTING_STATUS.SOLD;
          listing.supersededByOwner = {
            hash: owner.hash,
            index: owner.index,
          };
          continue;
        }
      } catch (ownerCheckError) {
        console.warn(`Failed to check current owner for Shakedex listing ${listing.nameLock.name}:`, ownerCheckError);
      }

      listing.blocksUntilFinalize = 0;
      listing.status = LISTING_STATUS.TRANSFER_CONFIRMED;
      continue;
    }

    if (finalizeTx.height === -1) {
      listing.status = LISTING_STATUS.FINALIZE_CONFIRMING;
      continue;
    }

    if (!listing.auction) {
      listing.status = LISTING_STATUS.FINALIZE_CONFIRMED;
      continue;
    }

    const version = listing.auction.version || 1;

    if (version < 2) {
      listing.deprecated = true;
    }

    // Name transferred and finalized into lockscript
    if (finalizeCoin) {
      listing.status = LISTING_STATUS.ACTIVE;

      if (listing.deprecated) {
        const futureBids = listing.auction.data.filter(bid => bid.lockTime > mtp);

        if (futureBids.length > 0) {
          listing.safe = false;

          // lowestDeprecatedPrice:
          // when v1 auction isn't cancelled, the lowest value of all bids
          listing.lowestDeprecatedPrice = Math.min(...futureBids.map(bid => bid.price));
        }
      }
      continue;
    }

    // Auction cancelled and name being transferred back
    if (cancelTx && !cancelFinalizeTx) {
      listing.status = cancelTx.height > 0 && info.chain.height - cancelTx.height > transferLockup
        ? LISTING_STATUS.CANCEL_CONFIRMED
        : LISTING_STATUS.CANCEL_CONFIRMING;
      continue;
    }

    // Auction cancelled and name return transfer finalizing
    if (cancelFinalizeTx && cancelFinalizeTx.height === -1) {
      listing.status = LISTING_STATUS.FINALIZE_CANCEL_CONFIRMING;
      continue;
    }

    // At this point, the presigns no longer work
    listing.deprecated = false;

    // Auction cancelled and name return finalized
    if (cancelCoin) {
      listing.status = LISTING_STATUS.FINALIZE_CANCEL_CONFIRMED;
      continue;
    }

    listing.status = LISTING_STATUS.SOLD;
  }

  try {
    const marketSales = await shakedex.getExchangeSales();
    const soldByName = new Map(
      marketSales
        .filter(sale => sale && sale.status === 'sold')
        .map(sale => [String(sale.name).toLowerCase(), sale])
    );
    const salePendingByName = new Map(
      marketSales
        .filter(sale => sale && sale.status === 'sale-pending')
        .map(sale => [String(sale.name).toLowerCase(), sale])
    );

    for (const listing of listings) {
      const name = String(listing.nameLock && listing.nameLock.name || '').toLowerCase();
      const sold = soldByName.get(name);
      const salePending = salePendingByName.get(name);

      if (sold) {
        listing.marketSale = sold;
        listing.status = LISTING_STATUS.SOLD;
        continue;
      }

      if (
        salePending
        && ![
          LISTING_STATUS.SOLD,
          LISTING_STATUS.FINALIZE_CANCEL_CONFIRMED,
        ].includes(listing.status)
      ) {
        listing.marketSale = salePending;
        listing.status = LISTING_STATUS.SALE_PENDING;
      }
    }
  } catch (e) {
    console.warn('Failed to load Shakedex channel sale state:', e);
  }

  if (walletId !== getState().wallet.wid) {
    return;
  }

  dispatch({
    type: GET_EXCHANGE_LISTINGS_OK,
    payload: {
      listings,
    },
  });
};

export const placeExchangeBid = (auction, bid) => async (dispatch, getState) => {
  dispatch({
    type: PLACE_EXCHANGE_BID,
  });

  let fulfillment;
  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));
    fulfillment = await shakedex.fulfillSwap(auction, bid, passphrase);
    if (!fulfillment || !fulfillment.fulfillmentTxHash) {
      throw new Error('Bob did not receive a Shakedex purchase transaction hash. No confirmed broadcast was recorded.');
    }
  } catch (e) {
    console.error(e);
    dispatch({
      type: PLACE_EXCHANGE_BID_ERR,
      payload: {
        message: e.message,
      },
    });
    return;
  }

  dispatch(getExchangeListings());
  dispatch(getExchangeFullfillments());
  dispatch({
    type: PLACE_EXCHANGE_BID_OK,
  });
  dispatch(showSuccess(`Purchase transaction accepted by local HSD: ${fulfillment.fulfillmentTxHash}. After the transfer lockup ends, finalize it from Your Fills.`));
};

export const finalizeExchangeBid = (fulfillment) => async (dispatch, getState) => {
  dispatch({
    type: FINALIZE_EXCHANGE_BID,
    payload: {
      fulfillment,
    },
  });

  const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));

  let finalized;
  try {
    finalized = await shakedex.finalizeSwap(fulfillment, passphrase);
  } catch (e) {
    dispatch({
      type: FINALIZE_EXCHANGE_BID_ERR,
      payload: {
        message: e.message,
      },
    });
    dispatch(showError(`Could not finalize Shakedex purchase: ${e.message}`));
    return;
  }

  dispatch(getExchangeFullfillments());
  dispatch({
    type: FINALIZE_EXCHANGE_BID_OK,
  });
  const finalizeTxHash = finalized && finalized.finalize && finalized.finalize.finalizeTxHash;
  dispatch(showSuccess(`Finalize transaction accepted by local HSD${finalizeTxHash ? `: ${finalizeTxHash}` : ''}. Please wait 15 minutes for it to confirm on-chain.`));
};

export const transferExchangeLock = (name, params) => async (dispatch) => {
  dispatch({
    type: PLACE_EXCHANGE_LISTING,
  });

  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));
    await shakedex.transferLock(name, params, passphrase);
  } catch (e) {
    dispatch({
      type: PLACE_EXCHANGE_LISTING_ERR,
      payload: {
        message: e.message,
      },
    });
    throw e;
  }

  dispatch({
    type: PLACE_EXCHANGE_LISTING_OK,
  });
  dispatch(showSuccess('Listing lock transfer submitted. Back up your Marketplace listings, then wait for the transfer lockup before finalizing.'));
  dispatch(getExchangeListings());
};


export const cancelExchangeLock = (nameLock) => async (dispatch) => {
  dispatch({
    type: CANCEL_EXCHANGE_LISTING,
  });

  // Coerce into array if single nameLock
  const nameLocks = Array.isArray(nameLock) ? nameLock : [nameLock]

  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));
    for (const nl of nameLocks) {
      await shakedex.transferCancel(nl, passphrase);
    }
  } catch (e) {
    dispatch({
      type: CANCEL_EXCHANGE_LISTING_ERR,
      payload: {
        message: e.message,
      },
    });
    dispatch(showError(e.message));
    throw e;
  }

  dispatch(getExchangeListings());
  dispatch({
    type: CANCEL_EXCHANGE_LISTING_OK,
  });
  dispatch(showSuccess('Transferring name back to your wallet. Don\'t forget to finalize after transfer period is over.'));
};

export const finalizeCancelExchangeLock = (nameLock) => async (dispatch) => {
  dispatch({
    type: FINALIZE_CANCEL_EXCHANGE_LISTING,
  });

  // Coerce into array if single nameLock
  const nameLocks = Array.isArray(nameLock) ? nameLock : [nameLock]

  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));
    for (const nl of nameLocks) {
      await shakedex.finalizeCancel(nl, passphrase);
    }
  } catch (e) {
    dispatch({
      type: FINALIZE_CANCEL_EXCHANGE_LISTING_ERR,
      payload: {
        message: e.message,
      },
    });
    dispatch(showError(e.message));
    throw e;
  }

  dispatch(getExchangeListings());
  dispatch({
    type: FINALIZE_CANCEL_EXCHANGE_LISTING_OK,
  });
  dispatch(showSuccess('Successfully finalized transfer! Please wait 15 minutes for it to confirm on-chain.'));
};

export const finalizeExchangeLock = (nameLock) => async (dispatch, getState) => {
  dispatch({
    type: FINALIZE_EXCHANGE_LOCK,
    payload: {
      nameLock,
    },
  });


  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));
    await shakedex.finalizeLock(nameLock, passphrase);
  } catch (e) {
    dispatch({
      type: FINALIZE_EXCHANGE_LOCK_ERR,
      payload: {
        message: e.message,
      },
    });
    dispatch(showError('Failed to finalize auction. Please try again.'));
    return;
  }

  dispatch(getExchangeListings());
  dispatch({
    type: FINALIZE_EXCHANGE_LOCK_OK,
  });
  dispatch(showSuccess('Successfully finalized auction! Please wait 15 minutes for it to confirm on-chain.'));
};

export const launchExchangeAuction = (nameLock, overrideParams) => async (dispatch, getState) => {
  dispatch({
    type: LAUNCH_EXCHANGE_AUCTION,
  });

  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));
    await shakedex.launchAuction(nameLock, passphrase, overrideParams, true);
  } catch (e) {
    console.log(e);
    dispatch({
      type: LAUNCH_EXCHANGE_AUCTION_ERR,
    });
    dispatch(showError(`Failed to generate listing proof: ${e.message || 'Please try again.'}`));
    throw e;
  }

  dispatch(getExchangeListings());
  dispatch({
    type: LAUNCH_EXCHANGE_AUCTION_OK,
  });

  dispatch(showSuccess('Listing proof generated locally. No on-chain transaction was sent. Click Submit to confirm the listing on the Shakedex channel, or Download to save a backup copy.'));
};

export const createPrivateSaleProof = (nameLock, params) => async (dispatch) => {
  dispatch({
    type: CREATE_PRIVATE_SALE_PROOF,
  });

  let privateProof;
  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));
    privateProof = await shakedex.createPrivateAuction(nameLock, passphrase, params);
  } catch (e) {
    dispatch({
      type: CREATE_PRIVATE_SALE_PROOF_ERR,
    });
    dispatch(showError(`Failed to generate private sale proof: ${e.message || 'Please try again.'}`));
    throw e;
  }

  await dispatch(getExchangeListings());
  dispatch({
    type: CREATE_PRIVATE_SALE_PROOF_OK,
  });
  dispatch(showSuccess('Private sale proof generated locally. It was not published to the Shakedex channel. Share the downloaded proof only with buyers you trust.'));
  return privateProof;
};

function getListingOverrideParams(listing) {
  const params = listing.params || {};

  if (params.mode === 'fixed') {
    return {
      mode: 'fixed',
      price: Math.round(Number(params.price || 0)),
      durationDays: Math.max(Number(params.durationDays || 0), 365),
    };
  }

  const overrideParams = {
    mode: 'reverse',
    startPrice: Math.round(Number(params.startPrice || 0)),
    endPrice: Math.round(Number(params.endPrice || 0)),
    durationDays: params.durationDays || 7,
  };

  if (listing.lowestDeprecatedPrice) {
    overrideParams.lowestDeprecatedPrice = listing.lowestDeprecatedPrice;
  }

  return overrideParams;
}

export const launchExchangeAuctionsBulk = (listings) => async (dispatch, getState) => {
  dispatch({
    type: LAUNCH_EXCHANGE_AUCTIONS_BULK,
  });

  const failures = [];
  const succeeded = [];

  try {
    const passphrase = await new Promise((resolve, reject) => dispatch(getPassphrase(resolve, reject)));

    for (const listing of listings) {
      try {
        await shakedex.launchAuction(
          listing.nameLock,
          passphrase,
          getListingOverrideParams(listing),
          true,
        );
        succeeded.push(listing.nameLock && listing.nameLock.name);
      } catch (e) {
        failures.push({
          name: listing.nameLock && listing.nameLock.name,
          message: e.message,
        });
      }
    }
  } catch (e) {
    dispatch({
      type: LAUNCH_EXCHANGE_AUCTIONS_BULK_ERR,
    });
    dispatch(showError(e.message || 'Failed to generate listing proofs. Please try again.'));
    return {
      total: listings.length,
      succeeded,
      failures: listings.map(listing => ({
        name: listing.nameLock && listing.nameLock.name,
        message: e.message,
      })),
    };
  }

  await dispatch(getExchangeListings());

  if (failures.length) {
    dispatch({
      type: LAUNCH_EXCHANGE_AUCTIONS_BULK_ERR,
    });
    dispatch(showError(`Generated ${listings.length - failures.length} of ${listings.length} listing proofs. Failed: ${failures.map(f => f.name).join(', ')}`));
    return {
      total: listings.length,
      succeeded,
      failures,
    };
  }

  dispatch({
    type: LAUNCH_EXCHANGE_AUCTIONS_BULK_OK,
  });
  dispatch(showSuccess(`Generated ${listings.length} listing proof${listings.length === 1 ? '' : 's'} locally. No on-chain transaction was sent. Click Submit on each listing to confirm it on the Shakedex channel, or Download to save backups.`));
  return {
    total: listings.length,
    succeeded,
    failures,
  };
};

export const submitToShakedex = (auction) => async dispatch => {
  try {
    const json = await shakedex.listAuction(auction);
    if (json.error) {
      const err = new Error(json.error.message || 'The Shakedex channel rejected this listing proof.');
      err.wasShown = true;
      dispatch(showError(err.message));
      throw err;
    }

    if (json.success === false) {
      const err = new Error(json.message || 'The Shakedex channel did not accept this listing proof.');
      err.wasShown = true;
      dispatch(showError(err.message));
      throw err;
    }

    await dispatch(getExchangeListings());
    dispatch(showSuccess(`${auction.name}/ is now listed on the Shakedex channel.`));
    return json;
  } catch (e) {
    console.error(e);
    if (!e.wasShown) {
      const message = `Failed to post to the Shakedex channel: ${e.message}. You can still download your proof as a backup.`;
      dispatch(showError(message));
    }
    throw e;
  }
};

export default function (state = getInitialState(), action) {
  switch (action.type) {
    case SET_WALLET:
      return {
        ...state,
        listings: [],
        fulfillments: [],
        finalizingName: null,
        isLoadingListings: false,
      };

    case GET_EXCHANGE_AUCTIONS:
      return {
        ...state,
        isLoading: true,
        isError: false,
      };

    case GET_EXCHANGE_AUCTIONS_OK:
      const auctionIds = [];
      const auctions = action.payload.auctions.reduce((acc, curr) => {
        auctionIds.push(curr.id);
        acc[curr.id] = curr;
        return acc;
      }, {});

      return {
        ...state,
        auctionIds,
        auctions,
        isLoading: false,
        isError: false,
        total: action.payload.total,
      };

    case GET_EXCHANGE_AUCTIONS_ERR:
      return {
        ...state,
        isLoading: false,
        isError: true,
      };

    case GET_EXCHANGE_FULLFILLMENTS_OK:
      return {
        ...state,
        fulfillments: action.payload.fulfillments,
        isLoading: false,
        isError: false,
      };

    case GET_EXCHANGE_FULLFILLMENTS_ERR:
      return {
        ...state,
        isLoading: false,
        isError: true,
      };

    case GET_EXCHANGE_LISTINGS:
      return {
        ...state,
        isLoadingListings: true,
        isError: false,
      };

    case GET_EXCHANGE_LISTINGS_OK:
      return {
        ...state,
        listings: action.payload.listings,
        isLoadingListings: false,
        isLoading: false,
        isError: false,
      };

    case GET_EXCHANGE_LISTINGS_ERR:
      return {
        ...state,
        isLoadingListings: false,
        isLoading: false,
        isError: true,
      };

    case PLACE_EXCHANGE_BID: {
      return {
        ...state,
        isPlacingBid: true,
        isPlacingBidError: false,
        placingBidErrorMessage: '',
      };
    }
    case PLACE_EXCHANGE_BID_OK: {
      return {
        ...state,
        isPlacingBid: false,
        isPlacingBidError: false,
        placingBidErrorMessage: '',
      };
    }
    case PLACE_EXCHANGE_BID_ERR: {
      return {
        ...state,
        isPlacingBid: false,
        isPlacingBidError: true,
        placingBidErrorMessage: action.payload.message,
      };
    }
    case FINALIZE_EXCHANGE_BID: {
      return {
        ...state,
        finalizingName: action.payload.fulfillment.name,
      };
    }
    case FINALIZE_EXCHANGE_BID_OK: {
      return {
        ...state,
        finalizingName: null,
      };
    }
    case PLACE_EXCHANGE_LISTING: {
      return {
        ...state,
        isPlacingListing: true,
        isPlacingListingError: false,
      };
    }
    case PLACE_EXCHANGE_LISTING_ERR: {
      return {
        ...state,
        isPlacingListing: false,
        isPlacingListingError: true,
      };
    }
    case PLACE_EXCHANGE_LISTING_OK: {
      return {
        ...state,
        isPlacingListing: false,
        isPlacingListingError: false,
      };
    }
    case FINALIZE_EXCHANGE_LOCK: {
      return {
        ...state,
        finalizingName: action.payload.nameLock.name,
      };
    }
    case FINALIZE_EXCHANGE_LOCK_ERR: {
      return {
        ...state,
        finalizingName: null,
      };
    }
    case FINALIZE_EXCHANGE_LOCK_OK: {
      return {
        ...state,
        finalizingName: null,
      };
    }
    case LAUNCH_EXCHANGE_AUCTIONS_BULK:
    case CREATE_PRIVATE_SALE_PROOF:
      return {
        ...state,
        isLoading: true,
      };
    case LAUNCH_EXCHANGE_AUCTIONS_BULK_ERR:
    case LAUNCH_EXCHANGE_AUCTIONS_BULK_OK:
    case CREATE_PRIVATE_SALE_PROOF_ERR:
    case CREATE_PRIVATE_SALE_PROOF_OK:
      return {
        ...state,
        isLoading: false,
      };
    case SET_AUCTIONS_PAGE:
      return {
        ...state,
        currentPage: action.payload,
      };
    default:
      return state;
  }
}
