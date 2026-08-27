import test from 'tape';

import {
  MIN_FREE_SPACE_BYTES,
  STORAGE_BLOCKED_ERROR_CODE,
  StorageHealth,
  isStorageFullError,
  safeStorageDiagnostic,
} from '../health';
import {STORAGE_BLOCKED, STORAGE_CLEARED} from '../../../ducks/storageReducer';

function statForBytes(bytes) {
  return {bavail: BigInt(bytes), bsize: 1n};
}

test('detects supported disk-full and LevelDB errors', t => {
  t.ok(isStorageFullError(Object.assign(new Error('write failed'), {code: 'ENOSPC'})));
  t.ok(isStorageFullError(new Error('IO error: /wallet/003655.ldb: No space left on device')));
  t.ok(isStorageFullError(Object.assign(new Error('win32 write failure'), {errno: 112})));
  t.ok(isStorageFullError(Object.assign(new Error('quota'), {code: 'EDQUOT'})));
  t.notOk(isStorageFullError(Object.assign(new Error('connection refused'), {code: 'ECONNREFUSED'})));
  t.end();
});

test('storage diagnostics preserve the cause while redacting secret fields', t => {
  const diagnostic = safeStorageDiagnostic(
    Object.assign(new Error('No space left; apiKey=abc123 password=hunter2'), {
      code: 'ENOSPC',
      syscall: 'write',
    }),
    'walletdb',
  );

  t.equal(diagnostic.code, 'ENOSPC');
  t.equal(diagnostic.syscall, 'write');
  t.ok(diagnostic.message.includes('No space left'));
  t.notOk(diagnostic.message.includes('abc123'));
  t.notOk(diagnostic.message.includes('hunter2'));
  t.end();
});

test('mocked low-space preflight blocks before transaction execution', async t => {
  const actions = [];
  let broadcasts = 0;
  const health = new StorageHealth({
    dispatch: action => actions.push(action),
    statfs: async () => statForBytes(MIN_FREE_SPACE_BYTES - 1),
    logger: () => {},
  });

  try {
    await health.preflight('/mock/hsd_data', {
      source: 'transaction-preflight',
      transactionAttempted: true,
    });
    broadcasts++;
    t.fail('preflight should reject');
  } catch (error) {
    t.equal(error.code, STORAGE_BLOCKED_ERROR_CODE);
  }

  t.equal(broadcasts, 0, 'transaction was not prepared or broadcast');
  t.equal(actions.length, 1);
  t.equal(actions[0].type, STORAGE_BLOCKED);
  t.equal(actions[0].payload.transactionAttempted, true);
  t.end();
});

test('mocked ENOSPC stays blocked until a manual status check sees 10 GB', async t => {
  const actions = [];
  let available = 0;
  let statusChecks = 0;
  let transactionRetries = 0;
  const health = new StorageHealth({
    dispatch: action => actions.push(action),
    statfs: async () => {
      statusChecks++;
      return statForBytes(available);
    },
    logger: () => {},
  });

  const writeError = Object.assign(
    new Error('IO error: wallet/003655.ldb: No space left on device'),
    {code: 'ENOSPC'},
  );
  t.ok(health.reportError(writeError, {
    source: 'walletdb',
    transactionAttempted: true,
  }));

  let result = await health.retry('/mock/hsd_data');
  t.notOk(result.ok);
  t.equal(actions[actions.length - 1].type, STORAGE_BLOCKED);

  available = MIN_FREE_SPACE_BYTES + 1;
  result = await health.retry('/mock/hsd_data');
  t.ok(result.ok);
  t.equal(actions[actions.length - 1].type, STORAGE_CLEARED);
  t.equal(transactionRetries, 0, 'status checks never retry a transaction');
  t.equal(statusChecks, 2, 'only explicit status checks queried the filesystem');
  t.end();
});
