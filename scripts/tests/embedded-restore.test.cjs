const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const child = path.join(__dirname, 'fixtures/embedded-restore-process.cjs');
for (const {nodeMode, delayedAck} of [
  {nodeMode: 'full', delayedAck: false},
  {nodeMode: 'spv', delayedAck: false},
  {nodeMode: 'spv', delayedAck: true},
]) {
  test(`actual embedded ${nodeMode} disk profile survives two separate source processes${delayedAck ? ' with delayed disk acknowledgement' : ''}`, {timeout: 120000}, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-embedded-source-'));
    const userData = path.join(root, 'profile');
    fs.mkdirSync(userData);
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({version: 1,
      purpose: 'bob-packaged-acceptance', profileRoot: root, userData,
      activationToken: crypto.randomBytes(24).toString('hex'),
      fixturePassphrase: crypto.randomBytes(24).toString('hex'),
      scenario: `restore-${nodeMode}`, nodeMode, network: 'regtest',
      transactionMode: 'disabled', externalTransactionNetwork: false,
      statusPath: path.join(root, 'status.json'), eventLogPath: path.join(root, 'events.jsonl'),
    }), {mode: 0o600});
    const run = (delay = false) => {
      const result = spawnSync(process.execPath, [child, root, ...(delay ? ['delay-final-ack'] : [])], {encoding: 'utf8', timeout: 55000});
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const line = result.stdout.split('\n').find(value => value.startsWith('EMBEDDED_RESTORE_RESULT '));
      assert(line, 'Missing embedded process evidence.');
      return JSON.parse(line.slice('EMBEDDED_RESTORE_RESULT '.length));
    };
    try {
      const first = run();
      assert.equal(first.evidence.height, 5);
      assert.equal(first.evidence.target, 20);
      assert.equal(first.evidence.recoveryAdmissionClosed, true);
      if (nodeMode === 'full') assert.equal(first.evidence.backendState.status, 'failed');
      else assert.equal(first.evidence.backendState.ready, false);
      assert(first.evidence.pendingRequestIds.includes(first.evidence.requestId));
      const second = run(delayedAck);
      if (delayedAck) assert.equal(second.delayedAcknowledgements, 1);
      assert.equal(second.evidence.height, 20);
      assert.equal(second.evidence.backendState.ready, true);
      assert.equal(second.evidence.recoveryAdmissionClosed, false);
      assert.equal(second.evidence.requestId, first.evidence.requestId);
      assert.equal(second.evidence.target, first.evidence.target);
      assert.deepEqual(second.evidence.pendingRequestIds, []);
      assert(second.rescanActions.some(action => action.payload.activeRequestIds.includes(first.evidence.requestId)
        && action.payload.target === 20 && action.payload.ready === false));
      assert.equal(second.wallets.length, 5);
      assert(second.evidence.balances.every(wallet => wallet.confirmed > 0 && wallet.historyCount > 0));
      assert.equal(second.evidence.facility, 'embedded-NodeService-WalletService');
      assert.equal(second.evidence.packagedBackendStatus, 'NOT TESTED');
      assert.equal(second.realProfileAccessed, false);
      assert.deepEqual(second.failures, []);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
  });
}
