import test from 'tape';

import storageReducer, {STORAGE_BLOCKED, STORAGE_CLEARED} from '../storageReducer';

test('storage failure remains transaction-aware across repeated hsd reports', t => {
  let state = storageReducer(undefined, {
    type: STORAGE_BLOCKED,
    payload: {source: 'walletdb', transactionAttempted: true},
  });
  state = storageReducer(state, {
    type: STORAGE_BLOCKED,
    payload: {source: 'hsd', transactionAttempted: false},
  });

  t.ok(state.blocked);
  t.ok(state.transactionAttempted, 'later generic errors do not erase transaction uncertainty');

  state = storageReducer(state, {type: STORAGE_CLEARED});
  t.notOk(state.blocked);
  t.notOk(state.transactionAttempted);
  t.end();
});
