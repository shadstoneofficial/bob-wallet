const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EVENT_PREFIX = 'BOB_PACKAGED_TEST_EVENT ';
const ACCEPTANCE_SCENARIOS = new Set(['multiwallet']);
const BACKEND_ERROR_LABELS = [
  'hsd error',
  'walletdb error',
  'nodeclient error',
  'transaction nodeclient error',
  'error in shutdown',
  'failed to close custom rpc clients',
  'packaged test shutdown failed',
];

function serializeError(error) {
  if (!error) return {name: 'Error', message: 'Unknown error', stack: ''};
  if (!(error instanceof Error)) {
    return {name: 'Error', message: String(error), stack: ''};
  }
  return {
    name: String(error.name || 'Error'),
    message: String(error.message || error),
    stack: String(error.stack || ''),
    code: error.code == null ? null : String(error.code),
  };
}

function findError(args) {
  return args.find(value => value instanceof Error) || null;
}

function isBackendFailure(args) {
  const error = findError(args);
  if (error && error.name === 'AssertionError') return true;
  const label = String(args[0] || '').toLowerCase();
  return BACKEND_ERROR_LABELS.some(value => label.includes(value));
}

function createBackendErrorMonitor({writeEvent = line => process.stderr.write(line)} = {}) {
  let phase = 'startup';
  const failures = [];

  function record(kind, error, details = {}) {
    const event = {
      version: 1,
      type: 'backend-error',
      kind,
      phase,
      timestamp: new Date().toISOString(),
      error: serializeError(error),
      ...details,
    };
    failures.push(event);
    writeEvent(`${EVENT_PREFIX}${JSON.stringify(event)}\n`);
    return event;
  }

  return {
    setPhase(value) {
      phase = value;
    },
    observeConsoleError(args) {
      if (!isBackendFailure(args)) return null;
      return record('console-error', findError(args) || new Error(String(args[0] || 'Backend error')), {
        label: String(args[0] || '').slice(0, 160),
      });
    },
    record,
    snapshot() {
      return failures.map(event => ({...event, error: {...event.error}}));
    },
  };
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolvePhysicalPath(target) {
  let existing = path.resolve(target);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const physical = fs.realpathSync.native(existing);
  return path.join(physical, ...suffix);
}

function assertTreeHasNoSymlinks(root) {
  if (!fs.existsSync(root)) return;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Acceptance profile cannot contain symbolic links: ${current}`);
    }
    if (!stat.isDirectory()) continue;
    for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
  }
}

function loadAcceptanceConfig(env, {appDataPath}) {
  if (env.BOB_PACKAGED_ACCEPTANCE_TEST !== 'true') return null;

  const userData = env.BOB_ACCEPTANCE_USER_DATA;
  const manifestPath = env.BOB_ACCEPTANCE_MANIFEST;
  const token = env.BOB_ACCEPTANCE_TOKEN;
  if (!userData || !path.isAbsolute(userData)) throw new Error('Acceptance userData must be an absolute path.');
  if (!manifestPath || !path.isAbsolute(manifestPath)) throw new Error('Acceptance manifest must be an absolute path.');
  if (!token || token.length < 32) throw new Error('Acceptance activation token is missing.');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const profileRoot = resolvePhysicalPath(manifest.profileRoot || '');
  const expectedUserData = resolvePhysicalPath(manifest.userData || '');
  const statusPath = resolvePhysicalPath(manifest.statusPath || '');
  const eventLogPath = resolvePhysicalPath(manifest.eventLogPath || '');
  const physicalManifestPath = resolvePhysicalPath(manifestPath);
  const productionUserData = resolvePhysicalPath(path.resolve(appDataPath, 'Bob LearnHNS'));

  if (manifest.version !== 1 || manifest.purpose !== 'bob-packaged-acceptance') {
    throw new Error('Invalid packaged acceptance manifest.');
  }
  if (!constantTimeEqual(token, manifest.activationToken)) {
    throw new Error('Packaged acceptance activation token does not match the manifest.');
  }
  if (resolvePhysicalPath(userData) !== expectedUserData || !isWithin(profileRoot, expectedUserData)) {
    throw new Error('Acceptance userData is outside its isolated profile root.');
  }
  if (!isWithin(profileRoot, physicalManifestPath)) {
    throw new Error('Acceptance manifest must stay inside the isolated profile root.');
  }
  if (expectedUserData === productionUserData || isWithin(productionUserData, expectedUserData)) {
    throw new Error('Acceptance mode refuses the production Bob profile.');
  }
  assertTreeHasNoSymlinks(profileRoot);
  if (!isWithin(profileRoot, statusPath) || !isWithin(profileRoot, eventLogPath)) {
    throw new Error('Acceptance status and event files must stay inside the isolated profile root.');
  }
  if (typeof manifest.fixturePassphrase !== 'string' || manifest.fixturePassphrase.length < 16) {
    throw new Error('Acceptance fixture passphrase is missing.');
  }
  if (!ACCEPTANCE_SCENARIOS.has(manifest.scenario)) {
    throw new Error(`Unsupported packaged acceptance scenario: ${manifest.scenario || '<missing>'}.`);
  }
  if (manifest.network !== 'regtest' || manifest.transactionMode !== 'disabled') {
    throw new Error('Packaged acceptance requires regtest with transaction fixtures disabled.');
  }
  if (manifest.externalTransactionNetwork !== false) {
    throw new Error('Packaged acceptance transaction fixtures must not use an external network.');
  }

  return {
    ...manifest,
    profileRoot,
    userData: expectedUserData,
    statusPath,
    eventLogPath,
    manifestPath: physicalManifestPath,
  };
}

function validatePackagedTestModes(env) {
  if (env.BOB_PACKAGED_SMOKE_TEST === 'true' && env.BOB_PACKAGED_ACCEPTANCE_TEST === 'true') {
    throw new Error('Packaged smoke and acceptance modes cannot run together.');
  }
}

function writeJsonAtomic(filePath, value) {
  if (!filePath) return;
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  fs.renameSync(temporary, filePath);
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  ACCEPTANCE_SCENARIOS,
  EVENT_PREFIX,
  assertTreeHasNoSymlinks,
  createBackendErrorMonitor,
  isBackendFailure,
  loadAcceptanceConfig,
  resolvePhysicalPath,
  serializeError,
  validatePackagedTestModes,
  withTimeout,
  writeJsonAtomic,
};
