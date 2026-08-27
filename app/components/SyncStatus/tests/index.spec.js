import test from 'tape';

import {getSyncStatusText} from '../index';

const translate = key => ({
  rescanning: 'Rescanning',
  storageErrorSyncStatus: 'Storage error — synchronization paused',
  synchronized: 'Synchronized',
}[key] || key);

function baseProps(overrides = {}) {
  return {
    isSynchronized: false,
    isSynchronizing: false,
    progress: 1,
    isCustomRPCConnected: false,
    isChangingNodeStatus: false,
    isTestingCustomRPC: false,
    walletSync: true,
    walletHeight: 990,
    rescanHeight: 1000,
    storageBlocked: false,
    ...overrides,
  };
}

test('99% rescan indicator is overridden by persistent storage failure', t => {
  t.equal(getSyncStatusText(baseProps(), translate), 'Rescanning... (99%)');
  t.equal(
    getSyncStatusText(baseProps({storageBlocked: true}), translate),
    'Storage error — synchronization paused',
  );
  t.end();
});

test('normal synchronized status is unaffected', t => {
  t.equal(getSyncStatusText(baseProps({
    walletSync: false,
    isSynchronized: true,
  }), translate), 'Synchronized');
  t.end();
});
