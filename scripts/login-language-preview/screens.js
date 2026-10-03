// Interactive locale-only review. All wallet/node/I/O routes fail closed in bootstrap.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Provider, connect} from 'react-redux';
import {createStore, applyMiddleware} from 'redux';
import thunk from 'redux-thunk';
import {MemoryRouter} from 'react-router-dom';
import {createMemoryHistory} from 'history';
import reducers from '../../app/ducks';
import appReducer, {fetchLocale, setLocale} from '../../app/ducks/app';
import settings from '../../app/utils/settingsClient';
import translations, {I18nContext, languageDropdownItems} from '../../app/utils/i18n';
import {AppHeader} from '../../app/pages/AppHeader';
import Dropdown from '../../app/components/Dropdown';
import Login from '../../app/pages/AcountLogin';
import CreatePassword from '../../app/pages/Onboarding/CreatePassword';
import ImportWarning from '../../app/pages/Onboarding/ImportSeedWarning';
import Welcome from '../../app/pages/Onboarding/FundAccessOptions';
import '../../app/global.scss';
import '../../app/pages/App/app.scss';
import '../../app/components/Topbar/topbar.scss';

const query = new URLSearchParams(location.search);
const blocked = () => {throw new Error('Fixture action blocked');};
const storageKey = 'bob-header-fixture-locale';
settings.getLocale = async () => localStorage.getItem(storageKey) || query.get('locale') || 'en-US';
settings.getCustomLocale = async () => null;
settings.setLocale = async locale => {
  if (query.has('fail')) throw new Error('Fixture save failure');
  localStorage.setItem(storageKey, locale);
};
const state = reducers(createMemoryHistory())(undefined, {type: 'fixture'});
Object.assign(state.wallet, {network: 'main', wallets: ['fixture-only'], walletsDetails: {'fixture-only': {type: 'standard'}}, walletSync: false, walletHeight: 1000});
Object.assign(state.node, {isRunning: true, chain: {height: 1000, progress: 1}, spv: true});
const store = createStore((current = state, action) => ({...current, app: appReducer(current.app, action)}), applyMiddleware(thunk));
class HeaderFixture extends AppHeader { componentDidMount() {} }
const Screen = {create: CreatePassword, restore: ImportWarning, welcome: Welcome}[query.get('screen')] || Login;
function Review({locale}) {
  const t = (key, ...args) => {
    let value = (translations[locale] || translations[locale.split('-')[0]] || translations.en)[key] || translations.en[key] || key;
    for (const arg of args) value = value.replace('%s', arg);
    return value;
  };
  return <I18nContext.Provider value={{t}}><MemoryRouter><div className="app__uninitialized-wrapper">
    <HeaderFixture isMainMenu={!['create', 'restore'].includes(query.get('screen'))} isRunning history={{push: blocked}} changeNetwork={blocked} />
    <div className="app__uninitialized app__uninitialized--auto-height">
      <Screen currentStep={1} totalSteps={3} onBack={blocked} onNext={blocked} onCancel={blocked} />
    </div>
    <aside style={{marginTop: 20, width: 230}}>
      <small>Fixture: Settings locale action</small>
      <Dropdown accessibleLabel="Fixture Settings language" items={languageDropdownItems.filter(x => x.value !== 'custom')}
        currentIndex={languageDropdownItems.findIndex(x => x.value === locale)} onChange={value => store.dispatch(setLocale(value))} />
    </aside>
  </div></MemoryRouter></I18nContext.Provider>;
}
const ConnectedReview = connect(s => ({locale: s.app.locale}))(Review);
document.body.classList.toggle('bob-theme-dark', query.get('theme') === 'dark');
createRoot(document.getElementById('root')).render(<Provider store={store}><ConnectedReview /></Provider>);
store.dispatch(fetchLocale());
