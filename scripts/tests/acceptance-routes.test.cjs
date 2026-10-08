const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
require('@babel/register')({extensions: ['.js'], configFile: false, babelrc: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}], '@babel/preset-react'],
  plugins: [['@babel/plugin-proposal-decorators', {legacy: true}], '@babel/plugin-proposal-class-properties']});
require.extensions['.scss'] = () => {};
const React = require('react');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', {url: 'http://localhost'});
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT = true;
const {act} = require('react-dom/test-utils');
const {createRoot} = require('react-dom/client');
const {createStore, applyMiddleware} = require('redux');
const thunk = require('redux-thunk').default;
const {Provider} = require('react-redux');
const {Router} = require('react-router-dom');
const {createMemoryHistory} = require('history');
const translations = require('../../locales/en.json');
const context = React.createContext({t: key => translations[key] || key});
const languages = [{label: 'English (US)', value: 'en-US'}, {label: 'Simplified Chinese', value: 'zh-CN'}];
const originalLoad = Module._load;
let active = true;
const marker = name => () => React.createElement('section', {'data-page': name}, name);
const routes = new Set(['../Overview', '../Account', '../Settings', '../Auction', '../Addons',
  '../Onboarding/FundAccessOptions', '../Onboarding/CreateNewAccount', '../Onboarding/ExistingAccountOptions',
  '../Onboarding/ImportSeedFlow', '../GetCoins', '../DomainManager', '../MyDomain', '../YourBids',
  '../Watching', '../Expiring', '../AuctionBasket', '../OpenBasket', '../SearchTLD', '../Exchange',
  '../SignMessage', '../VerifyMessage', '../../addons/shakex', '../Messages', '../Multisig']);
Module._load = function(request, parent, isMain) {
  const parentPath = String(parent?.filename || '').replace(/\\/g, '/');
  if (request === 'electron') return {app: {isAcceptance: active}};
  if (request.endsWith('/utils/i18n')) return {I18nContext: context,
    languageDropdownItems: languages, predefinedLanguageItems: languages, normalizeLocale: locale => locale || 'en-US'};
  if (request.endsWith('/ducks/app')) return {
    fetchLocale: () => ({type: 'NOOP'}), fetchTheme: () => ({type: 'NOOP'}), fetchShowUsdValue: () => ({type: 'NOOP'}),
    initHip2: () => assert.fail('Acceptance must not initialize external HIP2'),
    checkForUpdates: () => assert.fail('Acceptance must not query update network'),
    setLocale: value => ({type: 'TEST_LOCALE', value}), clearDeeplink: () => ({type: 'NOOP'})};
  if (request.endsWith('/ducks/node')) return {startApp: () => async () => {}, setExplorer: () => ({type: 'NOOP'})};
  if (request.endsWith('/ducks/walletActions')) return {
    watchActivity: () => ({type: 'NOOP'}), unlockWallet: name => async dispatch => dispatch({type: 'TEST_UNLOCK', name}),
    fetchWallet: () => async () => {}, verifyPhrase: () => async () => {}};
  if (request.endsWith('/utils/walletClient')) return {lock: async () => {}};
  if (request.endsWith('/background/connections/client')) return {clientStub: () => ({getConnection: async () => ({type: 'P2P'})})};
  if (request.endsWith('/background/connections/service')) return {ConnectionTypes: {Custom: 'Custom'}};
  if (parentPath.endsWith('/pages/App/index.js')) {
    if (routes.has(request)) return marker(request);
    if (request === '../../background/packagedAcceptance/InteractiveFixture') return marker('Fixed fixtures');
    if (request === '../../components/SplashScreen') return ({error}) => React.createElement('p', {role: 'alert'}, error || 'Loading');
    if (request === '../../components/LedgerModal') return {LedgerModal: () => null};
    if (request === '../../components/MultisigModal') return {MultisigModal: () => null};
    if (request.startsWith('../../components/') || request.endsWith('/PassphraseModal')) return () => null;
  }
  if (parentPath.endsWith('/pages/AppHeader/index.js')
      && ['../NetworkPicker', '../../components/SyncStatus'].includes(request)) return () => null;
  return originalLoad.call(this, request, parent, isMain);
};
const App = require('../../app/pages/App').default;
test.after(() => {Module._load = originalLoad;});

test('route fixture mocks handle Windows module paths without loading product assets', () => {
  const settings = Module._load('../Settings', {filename: 'D:\\fixture\\app\\pages\\App\\index.js'}, false);
  assert.equal(settings().props['data-page'], '../Settings');
  const status = Module._load('../../components/SyncStatus',
    {filename: 'D:\\fixture\\app\\pages\\AppHeader\\index.js'}, false);
  assert.equal(status(), null);
});

async function mount(path, error = '') {
  const initial = {node: {error, isRunning: true, isChangingNetworks: false},
    app: {locale: 'en-US'}, wallet: {initialized: true, isLocked: true,
      wallets: ['acceptance-primary', 'acceptance-secondary'], walletsDetails: {}}};
  const store = createStore((state = initial, action) => {
    if (action.type === 'TEST_LOCALE') return {...state, app: {...state.app, locale: action.value}};
    if (action.type === 'TEST_UNLOCK') return {...state, wallet: {...state.wallet, wid: action.name, isLocked: false}};
    if (action.type === 'TEST_LOCK') return {...state, wallet: {...state.wallet, isLocked: true}};
    return state;
  }, applyMiddleware(thunk));
  const history = createMemoryHistory({initialEntries: [path]});
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(React.createElement(Provider, {store}, React.createElement(context.Provider,
      {value: {t: key => translations[key] || key}}, React.createElement(Router, {history}, React.createElement(App)))));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  return {root, store, history};
}

test('acceptance preserves actual login language and disposable-wallet selection plus normal routes', async () => {
  const {root, store, history} = await mount('/login');
  try {
    const language = document.querySelector('select[aria-label*="Language"]');
    assert(language, 'Actual logged-out language picker remains visible');
    await act(async () => {language.value = '1'; language.dispatchEvent(new window.Event('change', {bubbles: true}));});
    assert.equal(store.getState().app.locale, 'zh-CN');
    const wallet = [...document.querySelectorAll('.login .dropdown__option')].find(item => item.textContent === 'acceptance-secondary');
    assert(wallet);
    await act(async () => wallet.click());
    await act(async () => document.querySelector('.login_cta').click());
    assert.equal(store.getState().wallet.wid, 'acceptance-secondary');
    assert.equal(history.location.pathname, '/overview');
    for (const [path, page] of [['/settings', '../Settings'], ['/account', '../Account'], ['/addons', '../Addons'], ['/domain/fixture-auction-retry', '../Auction']]) {
      await act(async () => history.push(path));
      assert.equal(document.querySelector('[data-page]')?.getAttribute('data-page'), page);
    }
    await act(async () => history.push('/acceptance-fixtures'));
    assert.equal(document.querySelector('[data-page]')?.getAttribute('data-page'), 'Fixed fixtures');
    await act(async () => store.dispatch({type: 'TEST_LOCK'}));
    await act(async () => history.push('/login'));
    assert(document.querySelector('.login'));
    assert(document.querySelector('select[aria-label*="Language"]'));
  } finally {await act(async () => root.unmount());}
});

test('acceptance cannot replace a backend failure with a fixture or ordinary route', async () => {
  for (const path of ['/acceptance-fixtures', '/login', '/settings/connection']) {
    const {root} = await mount(path, 'Fixed backend failure');
    try {
      assert.equal(document.querySelector('[role="alert"]')?.textContent, 'Fixed backend failure');
      assert.equal(document.querySelector('[data-page]'), null);
      assert.equal(document.querySelector('nav[aria-label="Isolated acceptance navigation"]'), null);
    } finally {await act(async () => root.unmount());}
  }
});
