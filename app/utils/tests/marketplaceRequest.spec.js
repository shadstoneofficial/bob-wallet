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

  t.equal(requestedPath, 'api/v2/auctions?page=3&per_page=20&availability=available');
  t.equal(getMarketplaceAuctionsPath(-5), 'api/v2/auctions?page=1&per_page=20&availability=available');
  t.equal(
    getMarketplaceAuctionsPath(1, 20, 'pending'),
    'api/v2/auctions?page=1&per_page=20&availability=pending',
  );
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

test('global marketplace filters travel to the channel without page-local fallback', async (t) => {
  let requested;
  const filters = {q: 'a & b', min_length: '3', max_length: '5', numbers: 'exclude', hyphens: 'include', sort: 'length-asc', mode: 'fixed'};
  const result = await fetchMarketplaceAuctions({get: async path => {
    requested = path;
    return {filterVersion: 1, total: 42, auctions: [{id: 9, name: 'b-first'}, {id: 1, name: 'a-second'}]};
  }}, 2, 'all', filters);
  t.ok(requested.includes('q=a%20%26%20b'));
  t.ok(requested.includes('min_length=3&max_length=5&numbers=exclude&hyphens=include&sort=length-asc&mode=fixed'));
  t.ok(requested.includes('page=2'));
  t.equal(result.total, 42, 'matching total comes from the channel');
  t.deepEqual(result.auctions.map(row => row.id), [9, 1], 'server order is retained');
  try {
    await fetchMarketplaceAuctions({get: async () => ({total: 100, auctions: []})}, 1, 'all', filters);
    t.fail('unsupported channel must not pretend to filter the whole inventory');
  } catch (error) {
    t.ok(error.message.includes('does not support full-list filters'));
  }
  t.end();
});

test('marketplace latest request wins and a changed query clears unrelated cached rows', t => {
  let state = exchangeReducer(undefined, {type: GET_EXCHANGE_AUCTIONS_OK,
    payload: {auctions: [{id: 1, name: 'old'}], total: 1}});
  state = exchangeReducer(state, {type: GET_EXCHANGE_AUCTIONS, meta: {requestId: 1, requestKey: 'alpha'}});
  t.deepEqual(state.auctionIds, [], 'changed query clears old inventory');
  state = exchangeReducer(state, {type: GET_EXCHANGE_AUCTIONS, meta: {requestId: 2, requestKey: 'beta'}});
  const latest = exchangeReducer(state, {type: GET_EXCHANGE_AUCTIONS_OK, meta: {requestId: 2},
    payload: {auctions: [{id: 2, name: 'beta'}], total: 1}});
  t.equal(exchangeReducer(latest, {type: GET_EXCHANGE_AUCTIONS_OK, meta: {requestId: 1},
    payload: {auctions: [{id: 1, name: 'alpha'}], total: 999}}), latest, 'stale success ignored');
  t.equal(exchangeReducer(latest, {type: GET_EXCHANGE_AUCTIONS_ERR, meta: {requestId: 1},
    payload: {kind: MARKETPLACE_STATUS.ERROR, message: 'old error'}}), latest, 'stale failure ignored');
  const refreshing = exchangeReducer(latest, {type: GET_EXCHANGE_AUCTIONS, meta: {requestId: 3, requestKey: 'beta'}});
  t.deepEqual(refreshing.auctionIds, [2], 'same-query refresh keeps cached rows');
  t.end();
});
