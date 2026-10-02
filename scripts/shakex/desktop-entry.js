window.bobElectron = {
  ipc: {send() {}, on() {return 1;}, off() {}},
  shell: {openExternal() {return Promise.resolve(true);}},
  dialog: {}, files: {}, app: {isPackaged: false},
};
require('../../app/global.scss');
const React = require('react');
const {createRoot} = require('react-dom/client');
const {Provider} = require('react-redux');
const {MemoryRouter} = require('react-router-dom');
const ShakeX = require('../../app/addons/shakex').default;
const {Records} = require('../../app/components/Records');
const {Resource} = require('hsd/lib/dns/resource');
const {I18nContext} = require('../../app/utils/i18n');
const locale = new URLSearchParams(location.search).get('locale') || 'en';
const english = require('../../locales/en.json');
const chinese = require('../../locales/zh-CN.json');
const {reviewText} = require('../../app/utils/reviewText');
const t = (key, ...values) => reviewText(k => (locale === 'zh-CN' ? chinese : english)[k], key, ...values);
const {Simulate} = require('react-dom/test-utils');
const resource = {records: [
  {type: 'NS', ns: 'ns1.example.'},
  {type: 'DS', keyTag: 1, algorithm: 13, digestType: 2, digest: 'ab'.repeat(32)},
  {type: 'TXT', txt: ['x:alice']},
  {type: 'TXT', txt: ['v=FORSALE1;ftxt=Old contact']},
]};
let canonical = Resource.fromJSON(resource).encode().toString('hex');
let sends = 0;
let instance;
const store = {getState: () => ({node: {chain: {height: 100}}, wallet: {network: 'regtest'}}), subscribe: () => () => {}, dispatch: () => {}};
const props = {
  name: 'fixture', network: 'regtest', walletId: 'fixture', walletGeneration: 0,
  domain: {name: 'fixture', isOwner: true}, resource, pendingData: null,
  deeplinkParams: {}, editable: true, transferring: false, currentHeight: 100,
  clearDeeplinkParams() {}, showSuccess() {}, refreshCanonicalNameInfo: async () => {},
  loadCanonicalNameInfo: async () => ({info: {data: canonical}}),
  sendUpdate: async (name, next, beforeSend) => {if (beforeSend) await beforeSend(); sends++; return null;},
  openProposalFile: async () => ({canceled: true}), readProposalFile: async () => '',
};
const root = createRoot(document.getElementById('root'));
root.render(
  <MemoryRouter><Provider store={store}><I18nContext.Provider value={{t, locale}}>
    <h1>ShakeX listing review — isolated fixture</h1>
    <Records {...props} ref={ref => {instance = ref;}} />
  </I18nContext.Provider></Provider></MemoryRouter>
);
window.fixture = {
  browse(mode) {
    window.fetch = async () => {
      if (mode === 'loading') return new Promise(() => {});
      if (mode === 'error') throw new Error('fixture offline');
      return {ok: true, text: async () => JSON.stringify({listings: mode === 'empty' ? [] : [{name:'xn--ls8h', prices:[{unit:'HNS',amount:'123.000001'}], contacts:[{type:'text',value:'X @alice'}]}]})};
    };
    root.render(<MemoryRouter><I18nContext.Provider value={{t, locale}}><ShakeX key={mode} /></I18nContext.Provider></MemoryRouter>);
  },
  edit() {
    const inputs = document.querySelectorAll('.shakex-listing-form input');
    Simulate.change(inputs[0], {target: {value: '5000'}});
    Simulate.change(inputs[1], {target: {value: 'X @alice'}});
  },
  state: () => ({sends, state: instance.state}),
  stale: () => {canonical = '00';},
  checkStale: async () => {
    // Exercise the same post-unlock guard without the unrelated logger IPC path.
    let rejected = false;
    const oldSend = instance.props.sendUpdate;
    const next = {...instance.props, sendUpdate: async (name, next, guard) => {
      canonical = '00';
      try {await guard();} catch (error) {rejected = error.message === t('recordsStale');}
      return null;
    }};
    instance.props = next;
    await instance.sendUpdate();
    instance.props = {...next, sendUpdate: oldSend};
    return rejected;
  },
};
