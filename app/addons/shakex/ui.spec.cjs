// Run: node app/addons/shakex/ui.spec.cjs
require('@babel/register')({configFile: false, babelrc: false, presets: [['@babel/preset-env', {targets: {node: 'current'}}], '@babel/preset-react']});
require.extensions['.scss'] = () => {};
require('jsdom-global')();
global.IS_REACT_ACT_ENVIRONMENT = true;
const assert = require('node:assert/strict');
const React = require('react');
const {createRoot} = require('react-dom/client');
const {act, Simulate} = require('react-dom/test-utils');
const {MemoryRouter} = require('react-router-dom');
const opened = [];
require.cache[require.resolve('electron')] = {exports: {shell: {openExternal: url => opened.push(url)}}};
const ShakeX = require('./index').default;
(async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {ok: true, text: async () => JSON.stringify({listings: [{name: 'example', prices: [{unit: 'HNS', amount: '0.000001'}], contacts: [{type: 'text', value: '<img src=x onerror=alert(1)>'}]}]})};
  };
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(MemoryRouter, {}, React.createElement(ShakeX))));
  assert.equal(calls, 0, 'no background fetch on mount');
  await act(async () => host.querySelector('button').click());
  assert.equal(calls, 1);
  assert.equal(host.querySelectorAll('article').length, 1);
  assert(host.textContent.includes('0.000001 HNS'));
  assert.equal(host.querySelectorAll('img').length, 0, 'seller HTML is text');
  await act(async () => Simulate.change(host.querySelector('input'), {target: {value: 'missing'}}));
  assert(host.textContent.includes('No names match'));
  await act(async () => Array.from(host.querySelectorAll('button')).find(x => x.textContent === 'Deal guide ↗').click());
  assert.deepEqual(opened, ['https://shakex.fun/deal']);
  global.fetch = async () => {throw new Error('offline');};
  await act(async () => host.querySelector('button').click());
  assert(host.querySelector('[role=alert]').textContent.includes('Previously loaded'));
  await act(async () => root.unmount());
  console.log('ShakeX UI checks passed (opt-in loading, display, search, escaped contacts, fixed links and retry state).');
})().catch(error => {console.error(error); process.exitCode = 1;});
