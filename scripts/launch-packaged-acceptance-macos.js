const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {resolvePhysicalPath} = require('../app/background/packagedAcceptance/runtime');

const CASES = [
  ['packagedStartup', 'READY', 'Launch, renderer, local regtest services and structured error monitoring.'],
  ['persistentRestart', 'READY', 'Quit and reopen the same disposable profile.'],
  ['multiwalletSwitching', 'READY', 'Two generated, encrypted disposable wallets.'],
  ['localeSelectionPersistence', 'READY', 'Manual English/Simplified Chinese selection and restart.'],
  ['auctionRealErrorRetry', 'NOT TESTED', 'No exact packaged auction-error fixture yet.'],
  ['basket20NameDelayedConstruction', 'NOT TESTED', 'Transaction construction is disabled in this profile.'],
  ['basketAmbiguousOutcomeLock', 'NOT TESTED', 'Transaction broadcast is disabled in this profile.'],
  ['shakeXReviewAndDnsPreservation', 'NOT TESTED', 'No controlled packaged ShakeX listing fixture yet.'],
  ['sequentialRestore', 'NOT TESTED', 'Backend restore interface is owned by the separate sync investigation.'],
  ['overlappingRestore', 'NOT TESTED', 'Backend restore interface is owned by the separate sync investigation.'],
];

function usage() {
  console.error('Usage: node scripts/launch-packaged-acceptance-macos.js <Bob LearnHNS.app> --profile-root <absolute-path> (--initialize|--reuse) --accept-disposable-profile');
  process.exit(2);
}

function parseArgs(argv) {
  const result = {appPath: argv[0]};
  for (let index = 1; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--profile-root') result.profileRoot = argv[++index];
    else if (value === '--initialize') result.initialize = true;
    else if (value === '--reuse') result.reuse = true;
    else if (value === '--accept-disposable-profile') result.accepted = true;
    else usage();
  }
  return result;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
}

function assertSafeProfileRoot(profileRoot) {
  if (!profileRoot || !path.isAbsolute(profileRoot)) throw new Error('Profile root must be absolute.');
  const resolved = resolvePhysicalPath(profileRoot);
  const production = resolvePhysicalPath(path.join(os.homedir(), 'Library', 'Application Support', 'Bob LearnHNS'));
  const relative = path.relative(production, resolved);
  if (resolved === production || (relative && !relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Refusing to use the production Bob LearnHNS profile.');
  }
  return resolved;
}

function initializeProfile(profileRoot) {
  if (fs.existsSync(profileRoot) && fs.readdirSync(profileRoot).length) {
    throw new Error('Profile root is not empty. Use --reuse only for a previously initialized acceptance profile.');
  }
  fs.mkdirSync(profileRoot, {recursive: true});
  const userData = path.join(profileRoot, 'user-data');
  fs.mkdirSync(userData, {recursive: true});
  const manifest = {
    version: 1,
    purpose: 'bob-packaged-acceptance',
    scenario: 'multiwallet',
    profileRoot,
    userData,
    network: 'regtest',
    transactionMode: 'disabled',
    externalTransactionNetwork: false,
    activationToken: crypto.randomBytes(32).toString('hex'),
    fixturePassphrase: crypto.randomBytes(24).toString('base64url'),
    statusPath: path.join(profileRoot, 'runtime-status.json'),
    eventLogPath: path.join(profileRoot, 'backend-events.jsonl'),
    caseMatrix: Object.fromEntries(CASES.map(([id, status, reason]) => [id, {status, reason}])),
    createdAt: new Date().toISOString(),
  };
  writeJson(path.join(profileRoot, 'manifest.json'), manifest);
  writeJson(path.join(profileRoot, 'acceptance-matrix.json'), manifest.caseMatrix);
  return manifest;
}

function loadProfile(profileRoot) {
  const manifestPath = path.join(profileRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('This is not an initialized Bob packaged-acceptance profile.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.purpose !== 'bob-packaged-acceptance' || path.resolve(manifest.profileRoot) !== profileRoot) {
    throw new Error('Acceptance profile manifest does not match this directory.');
  }
  const allowed = new Set(['manifest.json', 'acceptance-matrix.json', 'user-data']);
  for (const entry of fs.readdirSync(profileRoot, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) throw new Error('Acceptance profile root cannot contain symbolic links.');
    if (allowed.has(entry.name)) continue;
    if (/^(runtime-status|backend-events)-\d+-\d+\.(json|jsonl)$/.test(entry.name)) continue;
    throw new Error(`Unexpected content in acceptance profile root: ${entry.name}`);
  }
  return manifest;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Packaged acceptance launcher currently supports macOS only.');
  const args = parseArgs(process.argv.slice(2));
  if (!args.appPath || !args.profileRoot || args.initialize === args.reuse || !args.accepted) usage();

  const appPath = path.resolve(args.appPath);
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Bob LearnHNS');
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);
  const profileRoot = assertSafeProfileRoot(args.profileRoot);
  const manifest = args.initialize ? initializeProfile(profileRoot) : loadProfile(profileRoot);
  const manifestPath = path.join(profileRoot, 'manifest.json');
  const runId = `${Date.now()}-${process.pid}`;
  manifest.statusPath = path.join(profileRoot, `runtime-status-${runId}.json`);
  manifest.eventLogPath = path.join(profileRoot, `backend-events-${runId}.jsonl`);
  manifest.lastRunAt = new Date().toISOString();
  writeJson(manifestPath, manifest);

  console.log(`Launching isolated packaged acceptance profile: ${profileRoot}`);
  console.log('Network: regtest; transaction fixtures: disabled; generated disposable wallets only.');
  for (const [id, status] of CASES) console.log(`${status.padEnd(10)} ${id}`);

  const childEnv = {...process.env};
  for (const name of ['BOB_PACKAGED_SMOKE_TEST', 'BOB_SMOKE_USER_DATA', 'BOB_SMOKE_REPORT', 'BOB_SMOKE_PROFILE']) {
    delete childEnv[name];
  }
  const child = spawn(executable, [], {
    env: {
      ...childEnv,
      BOB_LEARNHNS_FORK: 'true',
      BOB_PACKAGED_ACCEPTANCE_TEST: 'true',
      BOB_ACCEPTANCE_USER_DATA: manifest.userData,
      BOB_ACCEPTANCE_MANIFEST: manifestPath,
      BOB_ACCEPTANCE_TOKEN: manifest.activationToken,
    },
    stdio: 'inherit',
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });

  const events = fs.existsSync(manifest.eventLogPath)
    ? fs.readFileSync(manifest.eventLogPath, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    : [];
  if (events.length) {
    throw new Error(`Packaged acceptance recorded ${events.length} backend error event(s). See ${manifest.eventLogPath}.`);
  }
  if (!fs.existsSync(manifest.statusPath)) {
    throw new Error(`Packaged acceptance did not write a status report: ${manifest.statusPath}`);
  }
  const status = JSON.parse(fs.readFileSync(manifest.statusPath, 'utf8'));
  if (!status.shutdownCompleted || status.ok !== true) {
    throw new Error(`Packaged acceptance shutdown was not clean. See ${manifest.statusPath}.`);
  }
  if (result.code !== 0) throw new Error(`Packaged acceptance app exited ${result.code} (${result.signal || 'no signal'}).`);
  console.log(`Profile preserved for restart testing: ${profileRoot}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
