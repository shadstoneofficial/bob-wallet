import test from 'tape';
import React from 'react';
import {mount} from 'enzyme';
import {act} from 'react-dom/test-utils';
import {Provider} from 'react-redux';
import {createStore, applyMiddleware} from 'redux';
import thunk from 'redux-thunk';
import Picker, {LanguagePicker} from './index';
import Dropdown from '../Dropdown';
import {I18nContext, predefinedLanguageItems} from '../../utils/i18n';
import reducer, {fetchLocale, setLocale, setCustomLocale} from '../../ducks/app';
import settings from '../../utils/settingsClient';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const makeStore = () => createStore((s, a) => ({app: reducer(s?.app, a)}), applyMiddleware(thunk));
const tContext = {t: key => key};

test('language preference hydration, restart, shared writes, fallback and startup race', async t => {
  const original = {...settings};
  let saved = 'zh-CN', custom = '';
  const writes = [];
  settings.getLocale = async () => saved;
  settings.getCustomLocale = async () => custom;
  settings.setLocale = async value => { writes.push(value); saved = value; custom = ''; };
  settings.setCustomLocale = async value => { saved = 'custom'; custom = JSON.stringify(value); };
  try {
    let store = makeStore();
    await store.dispatch(fetchLocale());
    t.equal(store.getState().app.locale, 'zh-CN', 'saved preference loads');
    t.deepEqual(writes, [], 'hydration never writes preferences');
    await store.dispatch(setLocale('fr-FR'));
    store = makeStore();
    await store.dispatch(fetchLocale());
    t.equal(store.getState().app.locale, 'fr-FR', 'new renderer/store restores preference');
    await store.dispatch(setCustomLocale({settingLanguageTitle: 'Fixture language'}));
    await store.dispatch(fetchLocale());
    t.equal(store.getState().app.locale, 'custom');
    t.equal(store.getState().app.customLocale.settingLanguageTitle, 'Fixture language');
    await store.dispatch(setLocale('zh-CN'));
    t.equal(store.getState().app.customLocale, null, 'predefined choice clears custom state');
    custom = '{broken'; saved = 'custom';
    await store.dispatch(fetchLocale());
    t.equal(store.getState().app.locale, 'en-US', 'corrupt custom falls back');
    custom = ''; saved = 'unknown';
    await store.dispatch(fetchLocale());
    t.equal(store.getState().app.locale, 'en-US', 'unsupported saved language falls back');
    let finishRead;
    settings.getLocale = () => new Promise(resolve => {finishRead = resolve;});
    const loading = store.dispatch(fetchLocale());
    await tick();
    await store.dispatch(setLocale('zh-CN'));
    finishRead('fr-FR');
    await loading;
    t.equal(store.getState().app.locale, 'zh-CN', 'late startup read cannot overwrite selection');
    const failure = new Error('fixture write failure');
    settings.setLocale = async () => {throw failure;};
    try {await store.dispatch(setLocale('ca')); t.fail('must reject');} catch (e) {t.equal(e, failure);}
    t.equal(store.getState().app.locale, 'zh-CN', 'failed save does not claim new selection');
    settings.setLocale = async value => {saved = value;};
    await Promise.all([store.dispatch(setLocale('ca')), store.dispatch(setLocale('fr-FR'))]);
    t.equal(store.getState().app.locale, 'fr-FR', 'concurrent writes preserve request order');
    t.equal(saved, 'fr-FR', 'persisted and visible language agree');
    const earlyStore = makeStore();
    let finishEarlyRead;
    let reads = 0;
    settings.getLocale = () => ++reads === 1
      ? new Promise(resolve => {finishEarlyRead = resolve;}) : Promise.resolve(saved);
    settings.setLocale = async () => {throw failure;};
    const earlyHydration = earlyStore.dispatch(fetchLocale());
    await tick();
    try {await earlyStore.dispatch(setLocale('ca')); t.fail('must reject');} catch (e) {t.equal(e, failure);}
    finishEarlyRead('en-US');
    await earlyHydration;
    t.equal(earlyStore.getState().app.locale, 'fr-FR', 'failed early choice recovers persisted language');
  } finally {Object.assign(settings, original);}
  t.end();
});

test('header language uses shared store, preserves sibling form, and represents custom safely', async t => {
  const original = settings.setLocale;
  const store = makeStore();
  const calls = [];
  settings.setLocale = async value => {calls.push(value);};
  const wrapper = mount(<Provider store={store}><I18nContext.Provider value={tContext}>
    <Picker /><input aria-label="fixture form" defaultValue="keep draft" />
  </I18nContext.Provider></Provider>);
  try {
    t.equal(wrapper.find('select').prop('value'), 0, 'usable English fallback before hydration');
    t.ok(wrapper.find('select').prop('aria-label').includes('Language'), 'accessible stable language cue');
    t.equal(wrapper.find('option').length, predefinedLanguageItems.length, 'no inert custom import option');
    wrapper.find('input').getDOMNode().value = 'in-progress fixture';
    act(() => {wrapper.find('select').simulate('change', {target: {value: '4'}});}); await tick(); await tick(); wrapper.update();
    t.equal(store.getState().app.locale, 'zh-CN');
    t.deepEqual(calls, ['zh-CN'], 'only shared locale persistence called');
    t.equal(wrapper.find('input').getDOMNode().value, 'in-progress fixture', 'sibling form stays mounted');
    await store.dispatch(setLocale('fr-FR')); await tick(); await tick(); // Settings action.
    wrapper.update();
    t.equal(wrapper.find('select').prop('value'), 1, 'Settings action synchronizes header');
    settings.setLocale = async () => {throw new Error('fixture');};
    act(() => {wrapper.find('select').simulate('change', {target: {value: '3'}});}); await tick(); await tick(); wrapper.update();
    t.equal(wrapper.find('select').prop('value'), 1, 'failed save restores displayed selection');
    t.equal(wrapper.find('[role="alert"]').text(), 'headerLanguageSaveError');
    t.notOk(wrapper.find('select').prop('disabled'), 'retry available after failure');
    act(() => {store.dispatch({type: 'app/setLocale', payload: 'custom'});}); wrapper.update();
    t.equal(wrapper.find('option').last().text(), 'Custom JSON');
    t.ok(wrapper.find('option').last().prop('disabled'), 'current custom is display-only');
  } finally {wrapper.unmount(); settings.setLocale = original;}
  const select = mount(<Dropdown accessibleLabel="Language" items={[{label: 'one'}, {label: 'two'}]} onChange={index => calls.push(index)} />);
  select.find('select').simulate('change', {target: {value: '1'}});
  t.equal(calls[calls.length - 1], 1, 'index callback contract retained');
  select.unmount(); t.end();
});
