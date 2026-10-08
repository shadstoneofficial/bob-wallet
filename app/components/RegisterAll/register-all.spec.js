import test from 'tape';
import sinon from 'sinon';
import {RegisterAll} from './index';

function fixture(overrides = {}) {
  const component = new RegisterAll({walletId: 'disposable', network: 'regtest', requestGeneration: 1,
    submit: async () => null, getStatus: async () => null, cancel: async () => true, ...overrides});
  component.context = {t: key => key};
  component.setState = patch => {component.state = {...component.state, ...patch};};
  component.mounted = true;
  component.state.loaded = true;
  return component;
}

test('Register All translates the failed stage in its recovery summary', t => {
  const component = fixture();
  const calls = [];
  component.context = {t: (key, ...args) => {calls.push([key, ...args]); return key === 'registrationState_broadcasting' ? 'translated-stage' : key;}};
  component.state.operation = {status: 'paused', failedName: 'fixture-name', failedStage: 'broadcasting', entries: []};
  component.render();
  t.deepEqual(calls.find(call => call[0] === 'registrationStoppedAt'), ['registrationStoppedAt', 'fixture-name', 'translated-stage']);
  t.end();
});

test('Register All component prevents duplicate clicks and ignores late results after unmount', async t => {
  let resolve; let calls = 0; const cancelled = [];
  const component = fixture({submit: () => {calls++; return new Promise(r => {resolve = r;});},
    cancel: async context => {cancelled.push(context); return true;}});
  const pending = component.start();
  await component.start();
  t.equal(calls, 1);
  component.componentWillUnmount();
  const state = component.state;
  resolve({transactions: [{name: 'one', txid: 'aa'.repeat(32)}]});
  await pending;
  t.equal(component.state, state, 'late completion cannot update unmounted UI');
  t.equal(cancelled.length, 1);
  t.equal(cancelled[0].walletId, 'disposable');
  t.ok(cancelled[0].operationId);
  t.end();
});

test('Register All component keeps an uncertain journal retry locked and retries failed cancellation', async t => {
  let calls = 0; let cancels = 0;
  const component = fixture({submit: async () => {calls++;}, cancel: async () => {
    cancels++;
    if (cancels === 1) throw new Error('IPC unavailable');
    return true;
  }});
  component.state.operation = {retryLocked: true};
  await component.start(); t.equal(calls, 0);
  component.operationContext = {walletId: 'disposable', network: 'regtest', operationId: 'fixture'};
  component.stop(); await Promise.resolve(); await Promise.resolve();
  t.ok(component.operationContext, 'failed cancellation keeps retryable context');
  t.equal(component.state.error, 'IPC unavailable');
  component.stop(); await Promise.resolve(); await Promise.resolve();
  t.equal(component.operationContext, null);
  t.equal(cancels, 2);
  t.end();
});

test('Register All component status timeout is bounded and stale wallet responses are ignored', async t => {
  const clock = sinon.useFakeTimers();
  try {
    let resolve;
    const component = fixture({getStatus: () => new Promise(r => {resolve = r;})});
    const pending = component.refresh();
    await clock.tickAsync(10001); await pending;
    t.equal(component.refreshing, false);
    t.equal(component.state.loaded, false);
    t.equal(component.state.error, 'registrationStatusTimeout');
    resolve({walletId: 'old-wallet'}); await Promise.resolve();
    t.equal(component.state.operation, null);
    const next = component.refresh();
    component.generation++;
    resolve({walletId: 'old-wallet'}); await next;
    t.equal(component.state.operation, null);
  } finally {clock.restore();}
  t.end();
});
