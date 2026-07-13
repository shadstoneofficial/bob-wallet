import test from 'tape';
import exchangeReducer, {
  GET_EXCHANGE_AUCTIONS,
  GET_EXCHANGE_AUCTIONS_ERR,
  GET_EXCHANGE_AUCTIONS_OK,
} from '../../ducks/exchange';
import {
  classifyMarketplaceError,
  fetchMarketplaceAuctions,
  getMarketplaceAuctionsPath,
  getMarketplaceClientOptions,
  getMarketplaceViewState,
  MARKETPLACE_REQUEST_TIMEOUT_MS,
  MARKETPLACE_STATUS,
} from '../marketplaceRequest';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('marketplace request allows a slow successful response', async (t) => {
  const client = {
    async get() {
      await delay(25);
      return {
        total: 1,
        auctions: [{id: 1, name: 'slow-success', bids: []}],
      };
    },
  };

  const result = await fetchMarketplaceAuctions(client, 1);
  const options = getMarketplaceClientOptions('market.learnhns.com');
  t.equal(MARKETPLACE_REQUEST_TIMEOUT_MS, 20000, 'marketplace timeout is 20 seconds');
  t.equal(options.timeout, 20000, 'production client receives the timeout');
  t.equal(options.host, 'market.learnhns.com', 'production client retains its host');
  t.equal(result.auctions.length, 1, 'slow response is retained');
  t.equal(result.total, 1, 'server total is retained');
  t.end();
});

test('marketplace timeout is classified separately from server errors', (t) => {
  const timeout = classifyMarketplaceError({message: 'Request timed out.'});
  const server = classifyMarketplaceError({message: 'Channel returned HTTP 503.'});

  t.equal(timeout.kind, MARKETPLACE_STATUS.TIMEOUT);
  t.equal(timeout.message, 'Request timed out.');
  t.equal(server.kind, MARKETPLACE_STATUS.ERROR);
  t.equal(server.message, 'Channel returned HTTP 503.');
  t.end();
});

test('marketplace reducer preserves cached rows when refresh times out', (t) => {
  let state = exchangeReducer(undefined, {type: '@@INIT'});
  state = exchangeReducer(state, {
    type: GET_EXCHANGE_AUCTIONS_OK,
    payload: {
      auctions: [{id: 7, name: 'cached-listing'}],
      total: 298,
    },
  });
  state = exchangeReducer(state, {type: GET_EXCHANGE_AUCTIONS});
  state = exchangeReducer(state, {
    type: GET_EXCHANGE_AUCTIONS_ERR,
    payload: {
      kind: MARKETPLACE_STATUS.TIMEOUT,
      message: 'Request timed out.',
    },
  });

  t.deepEqual(state.auctionIds, [7], 'cached row ids remain');
  t.equal(state.auctions[7].name, 'cached-listing', 'cached row remains');
  t.equal(state.total, 298, 'cached total remains');
  t.equal(state.marketplaceStatus, MARKETPLACE_STATUS.TIMEOUT);
  t.equal(state.marketplaceError, 'Request timed out.');
  t.end();
});

test('successful empty marketplace response is distinct from failure', async (t) => {
  const result = await fetchMarketplaceAuctions({
    get: async () => ({total: 0, auctions: []}),
  });
  let state = exchangeReducer(undefined, {type: '@@INIT'});
  state = exchangeReducer(state, {
    type: GET_EXCHANGE_AUCTIONS_OK,
    payload: result,
  });
  const view = getMarketplaceViewState(state.marketplaceStatus, state.auctionIds.length);

  t.equal(state.marketplaceStatus, MARKETPLACE_STATUS.LOADED);
  t.equal(state.marketplaceError, '');
  t.equal(view.showEmpty, true);
  t.equal(view.showError, false);
  t.end();
});

test('marketplace pagination requests the selected page and uses server total', async (t) => {
  let requestedPath = '';
  const result = await fetchMarketplaceAuctions({
    async get(path) {
      requestedPath = path;
      return {
        total: '298',
        auctions: [{id: 41, name: 'page-three'}],
      };
    },
  }, 3);

  t.equal(requestedPath, 'api/v2/auctions?page=3&per_page=20');
  t.equal(getMarketplaceAuctionsPath(-5), 'api/v2/auctions?page=1&per_page=20');
  t.equal(result.total, 298);
  t.equal(result.auctions[0].name, 'page-three');
  t.end();
});

test('marketplace view states distinguish initial load, refresh, timeout, and error', (t) => {
  t.equal(getMarketplaceViewState(MARKETPLACE_STATUS.LOADING, 0).showInitialLoading, true);
  t.equal(getMarketplaceViewState(MARKETPLACE_STATUS.LOADING, 4).showRefreshing, true);
  t.equal(getMarketplaceViewState(MARKETPLACE_STATUS.TIMEOUT, 0).showError, true);
  t.equal(getMarketplaceViewState(MARKETPLACE_STATUS.ERROR, 0).showError, true);
  t.equal(getMarketplaceViewState(MARKETPLACE_STATUS.LOADED, 0).showEmpty, true);
  t.end();
});
