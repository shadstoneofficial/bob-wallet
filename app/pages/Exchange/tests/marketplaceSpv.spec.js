import React from 'react';
import test from 'tape';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import { Exchange } from '../index';
import { I18nContext } from '../../../utils/i18n';
import { MARKETPLACE_STATUS } from '../../../utils/marketplaceRequest';

const noop = () => {};

function getProps(overrides = {}) {
  return {
    spv: true,
    nodeProgress: 1,
    walletSync: false,
    walletHeight: 337994,
    rescanHeight: 0,
    isCustomRPCConnected: false,
    deeplinkParams: {},
    clearDeeplinkParams: noop,
    network: 'main',
    height: 337994,
    walletType: 'software',
    walletWatchOnly: false,
    walletId: 'spv-smoke',
    walletsDetails: {},
    auctions: [],
    total: 0,
    currentPage: 1,
    marketplaceStatus: MARKETPLACE_STATUS.LOADED,
    marketplaceError: '',
    listings: [],
    fulfillments: [],
    finalizingName: null,
    location: {pathname: '/exchange'},
    setAuctionPage: noop,
    getExchangeAuctions: () => Promise.resolve(),
    getExchangeFullfillments: () => Promise.resolve([]),
    getExchangeListings: () => Promise.resolve([]),
    finalizeExchangeBid: noop,
    finalizeExchangeLock: noop,
    cancelExchangeLock: noop,
    finalizeCancelExchangeLock: noop,
    launchExchangeAuction: noop,
    launchExchangeAuctionsBulk: noop,
    createPrivateSaleProof: noop,
    submitToShakedex: noop,
    showError: noop,
    showSuccess: noop,
    ...overrides,
  };
}

function renderExchange(props) {
  const store = createStore(() => ({exchange: {listings: []}}));
  return renderToStaticMarkup(
    <Provider store={store}>
      <I18nContext.Provider value={{t: key => key}}>
        <MemoryRouter>
          <Exchange {...props} />
        </MemoryRouter>
      </I18nContext.Provider>
    </Provider>,
  );
}

test('SPV mode renders successfully loaded public marketplace rows', (t) => {
  const html = renderExchange(getProps({
    auctions: [{
      id: 'active-spv-listing',
      name: 'visible-in-spv',
      pending: false,
      buyable: true,
      bids: [{price: 1000000, lockTime: 2000000000}],
    }],
    total: 298,
  }));

  t.equal(html.includes('exchange__auction-listing__row'), true);
  t.equal(html.includes('visible-in-spv'), true);
  t.equal(html.includes('marketplaceLoadedEmpty'), false);
  t.end();
});

test('SPV mode renders timeout details and a visible Retry action', (t) => {
  const html = renderExchange(getProps({
    marketplaceStatus: MARKETPLACE_STATUS.TIMEOUT,
    marketplaceError: 'Request timed out.',
  }));

  t.equal(html.includes('marketplaceRequestTimedOut'), true);
  t.equal(html.includes('Request timed out.'), true);
  t.equal(html.includes('retry'), true);
  t.equal(html.includes('marketplaceLoadedEmpty'), false);
  t.end();
});
