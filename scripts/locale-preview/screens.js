import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Provider} from 'react-redux';
import {StaticRouter} from 'react-router-dom';
import {createMemoryHistory} from 'history';
import reducers from '../../app/ducks';
import {I18nContext} from '../../app/utils/i18n';
import zh from '../../locales/zh-CN.json';
import en from '../../locales/en.json';
import '../../app/pages/App/app.scss';
import '../../app/global.scss';
import Onboard from '../../app/pages/Onboarding/FundAccessOptions';
import ImportWarning from '../../app/pages/Onboarding/ImportSeedWarning';
import Backup from '../../app/pages/Onboarding/BackUpSeedWarning';
import Password from '../../app/pages/Onboarding/CreatePassword';
import Overview from '../../app/pages/Overview';
import Send from '../../app/components/SendModal';
import Receive from '../../app/components/ReceiveModal';
import Basket, {AuctionBasket} from '../../app/pages/AuctionBasket';
import OpenBasket from '../../app/pages/OpenBasket';
import Domains from '../../app/pages/DomainManager';
import Exchange, {Exchange as ExchangeScreen} from '../../app/pages/Exchange';
import Settings from '../../app/pages/Settings';
import RevealSeed from '../../app/pages/Settings/RevealSeedModal';
import {FinalizeWithPaymentModal} from '../../app/pages/MyDomain/FinalizeWithPaymentModal';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'en' ? en : zh;
const shell = query.get('shell') === '1';
const dark = query.get('theme') === 'dark';
document.body.classList.toggle('bob-theme-dark', dark);
const noop = () => {};
const state = reducers(createMemoryHistory())(undefined, {type: 'fixture'});
Object.assign(state.wallet, {
  wid: 'fixture-only',
  type: 'standard',
  network: 'regtest',
  isLocked: false,
  initialized: true,
  wallets: ['fixture-only'],
  walletsDetails: {'fixture-only': {type: 'standard'}},
  receiveAddress: 'FIXTURE-NOT-A-VALID-ADDRESS',
  balance: {
    spendable: 100000000,
    confirmed: 100000000,
    unconfirmed: 100000000,
    lockedConfirmed: 0,
    lockedUnconfirmed: 0,
  },
});
Object.assign(state.node, {
  isRunning: true, spv: true, network: 'regtest',
  chain: {height: 1000, progress: 1},
  fees: {slow: 100, standard: 200, fast: 300},
});
Object.assign(state.app, {locale: 'custom', customLocale: zh});
state.walletStats.isLoading = false;
for (const group of [state.walletStats.lockedBalance, state.walletStats.actionableInfo]) {
  for (const value of Object.values(group)) {
    for (const key of Object.keys(value)) value[key] = key === 'block' ? 1100 : 0;
  }
}
state.walletStats.actionableInfo.revealable.num = 2;
state.walletStats.actionableInfo.registerable.num = 1;
state.walletStats.actionableInfo.redeemable.num = 1;
const store = {
  getState: () => state,
  subscribe: () => noop,
  dispatch: () => { throw new Error('Fixture dispatch blocked'); },
};

// Seed component state directly; never invoke preflight, signing, or submission.
class BasketReview extends AuctionBasket {
  constructor(props) {
    super(props);
    this.state = {
      ...this.state,
      submissionPhase: query.get('phase') || 'idle',
      submissionFailedStage: query.get('phase') === 'failed' ? 'broadcasting' : '',
      broadcastUncertain: query.get('phase') === 'failed',
      retryAllowed: false,
      step: 'review',
      rowMeta: {fixture: {state: 'BIDDING', hoursUntilReveal: 12}},
    };
  }
}
const fixtureListings = [
  {nameLock: {name: 'fixture'}, params: {mode: 'fixed', price: 1000000}, status: 'FINALIZE_CONFIRMED'},
  {nameLock: {name: 'fixture-long-domain-name'}, params: {mode: 'fixed', price: 2000000}, status: 'TRANSFER_CONFIRMED'},
  {nameLock: {name: 'fixture-sold'}, params: {mode: 'fixed', price: 3000000}, status: 'SOLD'},
];
class MarketReady extends ExchangeScreen {
  constructor(props) {
    super(props);
    this.state = {...this.state, isLoadingLocalListings: false};
  }
  isMarketplaceVisible() { return true; }
}
function PopulatedMarket() {
  return <MarketReady spv={false} nodeProgress={1} walletSync={false} walletHeight={1000}
    isCustomRPCConnected={false} network="regtest" height={1000} walletType="standard"
    walletWatchOnly={false} walletId="fixture-only" walletsDetails={{}} deeplinkParams={{}}
    clearDeeplinkParams={noop} auctions={[]} total={0} currentPage={1}
    marketplaceStatus="loaded" fulfillments={[]} listings={fixtureListings} />;
}
const common = {
  order: ['fixture'],
  items: {fixture: {bidAmount: '10', blindAmount: '5'}},
  spendableBalance: 100000000,
  network: 'regtest',
  names: {},
  watchingNames: [],
  currentStep: 1,
  totalSteps: 3,
  onBack: noop, onNext: noop, onCancel: noop, onClose: noop,
};
const screens = {
  onboarding: [Onboard, '/funding-options'],
  warning: [ImportWarning, '/import-seed'],
  backup: [Backup, '/new-wallet'],
  password: [Password, '/new-wallet'],
  overview: [Overview, '/overview'],
  send: [Send, '/send'],
  receive: [Receive, '/receive'],
  basket: [Basket, '/auction-basket'],
  review: [BasketReview, '/auction-basket'],
  open: [OpenBasket, '/open-basket'],
  domains: [Domains, '/domains'],
  marketplace: [Exchange, '/exchange'],
  'market-ready': [PopulatedMarket, '/exchange'],
  settings: [Settings, '/settings/general'],
  seed: [RevealSeed, '/settings/wallet'],
  finalize: [FinalizeWithPaymentModal, '/domains/fixture'],
};
const key = query.get('screen') || 'onboarding';
const [Screen, route] = screens[key] || screens.onboarding;
const t = (key, ...args) => {
  let value = locale[key] || en[key] || key;
  for (const arg of args) value = value.replace('%s', arg);
  return value;
};
try {
  // SSR avoids componentDidMount/effects. No React hydration or event handlers.
  document.getElementById('root').innerHTML = renderToStaticMarkup(
    <Provider store={store}>
      <StaticRouter location={route} context={{}}>
        <I18nContext.Provider value={{t}}>
          {shell && key !== 'settings' ? (
            <div className="app">
              <aside className="app__sidebar-wrapper" style={{background: '#f0f2f5', paddingTop: 24}}>
                <strong>{t('headingExchange')}</strong><p>Fixture / 230px</p>
              </aside>
              <main className="app__main-wrapper"><section className="app__content">
                <Screen {...common} name="fixture" transferTo="FIXTURE-NOT-A-VALID-ADDRESS" />
              </section></main>
            </div>
          ) : <Screen {...common} name="fixture" transferTo="FIXTURE-NOT-A-VALID-ADDRESS" />}
        </I18nContext.Provider>
      </StaticRouter>
    </Provider>,
  );
  document.getElementById('root').inert = true;
  // Review-only positioning keeps wallet controls inert while exposing overflow.
  requestAnimationFrame(() => {
    const content = document.querySelector('.app__content');
    if (content) content.scrollTop = Number(query.get('offset')) || 0;
    if (query.get('edge') === 'right') {
      document.querySelectorAll('.exchange-table').forEach(table => {
        table.scrollLeft = table.scrollWidth;
      });
    }
  });
  document.getElementById('review-nav').innerHTML = Object.keys(screens)
    .map(screen => `<a href="?screen=${screen}&shell=${shell ? 1 : 0}&locale=${locale === en ? 'en' : 'zh-CN'}&theme=${dark ? 'dark' : 'light'}">${screen}</a>`).join(' | ');
} catch (error) {
  document.getElementById('root').textContent = error.stack;
}
