const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runChild,
  validateSmokeResult,
} = require('./lib/packaged-smoke-runner.cjs');

const appPath = path.resolve(process.argv[2] || '');
const smokeProfile = process.argv[3] || '';
const executable = path.join(appPath, 'Contents', 'MacOS', 'Bob LearnHNS');

if (process.platform !== 'darwin') throw new Error('Packaged macOS smoke test requires macOS.');
if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-packaged-smoke-'));
const userData = path.join(tempRoot, 'user-data');
const reportPath = path.join(tempRoot, 'report.json');
fs.mkdirSync(userData);

async function main() {
  const {result, stdout, stderr} = await runChild({
    executable,
    env: {
      ...process.env,
      BOB_LEARNHNS_FORK: 'true',
      BOB_PACKAGED_SMOKE_TEST: 'true',
      BOB_SMOKE_USER_DATA: userData,
      BOB_SMOKE_REPORT: reportPath,
      BOB_SMOKE_PROFILE: smokeProfile,
    },
    timeoutMs: 120000,
  });
  const {report} = validateSmokeResult({
    result,
    stdout,
    stderr,
    reportPath,
    smokeProfile,
    replacements: [[tempRoot, '<smoke-temp>']],
  });
  console.log(`Packaged macOS smoke test passed: ${JSON.stringify(report)}`);
}

main().finally(() => {
  fs.rmSync(tempRoot, {recursive: true, force: true});
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
