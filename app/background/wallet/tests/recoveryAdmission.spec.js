import test from 'tape';
import {createRecoveryAdmission} from '../recoveryAdmission';
import {createRescanRiskTracker} from '../rescanRisk';

test('restore/import admission blocks overlap while empty-wallet creation and chain sync stay independent', t => {
  let status = {status: 'idle'};
  const gate = createRecoveryAdmission(() => status);
  const first = gate.beginImport();
  t.throws(() => gate.beginImport(), {code: 'WALLET_RECOVERY_BUSY'}, 'second import is rejected during an import operation');

  const finishRescan = gate.beginRescan(first);
  t.throws(() => gate.beginImport(), {code: 'WALLET_RECOVERY_BUSY'}, 'second import is rejected after scan admission');
  status = {status: 'scanning'};
  finishRescan();
  t.throws(() => gate.beginImport(), {code: 'WALLET_RECOVERY_BUSY'}, 'shared backend status still blocks import');

  status = {status: 'idle'};
  const emptyWallet = () => 'created';
  t.equal(emptyWallet(), 'created', 'empty-wallet creation has no recovery admission');
  t.notOk(gate.isBusy(), 'ordinary chain sync with idle recovery state is not blocked');
  const next = gate.beginImport();
  gate.releaseImport(next);
  t.notOk(gate.isBusy(), 'admission releases after pre-scan import failure');
  t.end();
});

test('failed recovery blocks another import with an explicit restart instruction', t => {
  const gate = createRecoveryAdmission(() => ({status: 'failed'}));
  try {gate.beginImport(); t.fail('must reject');}
  catch (error) {
    t.equal(error.code, 'WALLET_RECOVERY_BUSY');
    t.match(error.message, /Restart Bob/);
  }
  t.end();
});

test('transaction-attempt uncertainty remains set until every attempted rescan settles', t => {
  const risk = createRescanRiskTracker();
  const first = risk.track(true);
  const ordinary = risk.track(false);
  const second = risk.track(true);
  t.ok(risk.transactionAttempted);
  first();
  ordinary();
  t.ok(risk.transactionAttempted, 'an overlapping ordinary rescan cannot clear another operation’s uncertainty');
  second();
  t.notOk(risk.transactionAttempted);
  t.end();
});
