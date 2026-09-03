const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');

const appPath = path.resolve(process.argv[2] || '');
const executable = path.join(appPath, 'Contents', 'MacOS', 'Bob LearnHNS');

if (process.platform !== 'darwin') throw new Error('Packaged macOS smoke test requires macOS.');
if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-packaged-smoke-'));
const userData = path.join(tempRoot, 'user-data');
const reportPath = path.join(tempRoot, 'report.json');
fs.mkdirSync(userData);

function cleanOutput(value) {
  return value.replaceAll(tempRoot, '<smoke-temp>').slice(-12000);
}

async function main() {
  let stdout = '';
  let stderr = '';
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      BOB_LEARNHNS_FORK: 'true',
      BOB_PACKAGED_SMOKE_TEST: 'true',
      BOB_SMOKE_USER_DATA: userData,
      BOB_SMOKE_REPORT: reportPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({timeout: true}), 120000);
  });
  const result = await Promise.race([exit, timeout]);

  if (result.timeout) {
    child.kill('SIGTERM');
    throw new Error(`Packaged app smoke test timed out.\nstdout:\n${cleanOutput(stdout)}\nstderr:\n${cleanOutput(stderr)}`);
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Packaged app did not write a smoke report (exit ${result.code}, signal ${result.signal || 'none'}).\nstdout:\n${cleanOutput(stdout)}\nstderr:\n${cleanOutput(stderr)}`);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const required = [
    'ok',
    'mainWindowCreated',
    'rendererProcessStarted',
    'appHtmlLoaded',
    'servicesInitialized',
    'dockReopenCreatedWindow',
    'dockReopenLoaded',
    'secondRendererProcessStarted',
  ];
  const failed = required.filter(key => report[key] !== true);
  if (report.unhandledStartupRejection !== false) failed.push('unhandledStartupRejection');
  if (result.code !== 0) failed.push(`exitCode=${result.code}`);

  if (failed.length) {
    throw new Error(`Packaged app smoke test failed: ${failed.join(', ')}\nReport: ${JSON.stringify(report)}\nstderr:\n${cleanOutput(stderr)}`);
  }

  console.log(`Packaged macOS smoke test passed: ${JSON.stringify(report)}`);
}

main().finally(() => {
  fs.rmSync(tempRoot, {recursive: true, force: true});
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
