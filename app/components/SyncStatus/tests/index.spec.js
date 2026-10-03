import test from 'tape';

import {
  formatSyncProgress,
  getSyncStatusText,
  isSyncComplete,
} from '../index';

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

test('sync completion accepts exact and display-rounded completion', t => {
  t.equal(isSyncComplete({progress: 0.5, synced: true}), true, 'HSD synchronized state is authoritative');
  t.equal(isSyncComplete({progress: 1}), true, 'exact progress is complete');
  t.equal(isSyncComplete({progress: 0.99996}), true, 'rounded 100.00% progress is complete');
  t.equal(isSyncComplete({progress: 0.99}), false, 'genuinely incomplete progress is not complete');
  t.end();
});

test('peer height prevents a stale node from being classified as synchronized', t => {
  t.equal(isSyncComplete({
    progress: 0.99996,
    height: 345516,
    bestPeerHeight: 345516,
  }), true, 'local height at the peer tip is complete');
  t.equal(isSyncComplete({
    progress: 1,
    height: 345515,
    bestPeerHeight: 345516,
  }), false, 'local height behind the peer tip is incomplete');
  t.end();
});

test('an incomplete state never displays Synchronizing at 100.00%', t => {
  t.equal(formatSyncProgress(0.99996, false), '(99.99%)');
  t.equal(
    getSyncStatusText(baseProps({
      walletSync: false,
      isSynchronizing: true,
      progress: 0.99996,
    }), translate),
    'synchronizing... (99.99%)',
  );
  t.end();
});

test('waiting and failed recovery cannot masquerade as synchronized', t => {
  t.equal(getSyncStatusText(baseProps({rescanStatus: 'waiting', isSynchronized: true}), translate), 'walletRescanWaiting');
  t.equal(getSyncStatusText(baseProps({rescanStatus: 'failed', isSynchronized: true}), translate), 'walletRescanFailed');
  t.equal(getSyncStatusText(baseProps({rescanHeight: 0}), translate), 'Rescanning... (0%)');
  t.end();
});
