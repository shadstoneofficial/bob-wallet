window.bobElectron = {shell: {openExternal() {}}, ipc: {send() {}, on() {}, off() {}}, app: {isPackaged: false}};
require('../../../global.scss');
const React = require('react');
const {createRoot} = require('react-dom/client');
const {MemoryRouter} = require('react-router-dom');
const {Simulate} = require('react-dom/test-utils');
const {I18nContext} = require('../../../utils/i18n');
const ShakeX = require('../index').default;
const punycode = require('punycode/');
const en = require('../../../../locales/en.json');
const zh = require('../../../../locales/zh-CN.json');
const locale = new URLSearchParams(location.search).get('locale') || 'en';
const names = ['xn--k77hya', 'xn--ep8h', 'xn--ev9h', 'example',
  punycode.toASCII('🐹'.repeat(40)), punycode.toASCII('שלוםabc'),
  punycode.toASCII('a\u202eb'), 'xn--9999999999999999999999999999'];
window.fetch = async () => ({ok: true, text: async () => JSON.stringify({listings: names.map(name => ({name,
  prices: [{unit: 'HNS', amount: '25000'}], contacts: [{type: 'text', value: 'X @fixture'}],
}))})});
createRoot(document.getElementById('root')).render(<MemoryRouter><I18nContext.Provider value={{locale, t: key => (locale === 'zh-CN' ? zh : en)[key]}}><ShakeX /></I18nContext.Provider></MemoryRouter>);
window.searchFixture = query => Simulate.change(document.querySelector('input'), {target: {value: query}});
