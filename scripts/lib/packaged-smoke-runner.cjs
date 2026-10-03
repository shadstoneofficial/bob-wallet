const fs = require('fs');
const {spawn} = require('child_process');

const EVENT_PREFIX = 'BOB_PACKAGED_TEST_EVENT ';

function cleanOutput(value, replacements = []) {
  let result = value;
  for (const [from, to] of replacements) result = result.replaceAll(from, to);
  return result.slice(-12000);
}

function parseStructuredEvents(output) {
  const events = [];
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf(EVENT_PREFIX);
    if (index === -1) continue;
    try {
      events.push(JSON.parse(line.slice(index + EVENT_PREFIX.length)));
    } catch (error) {
      events.push({type: 'invalid-event', error: {message: error.message}, raw: line.slice(0, 500)});
    }
  }
  return events;
}

function terminateBounded(child, graceMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, graceMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function runChild({executable, args = [], env, timeoutMs = 120000, terminationGraceMs = 5000}) {
  let stdout = '';
  let stderr = '';
  const child = spawn(executable, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  let timer;
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal, timeout: false}));
  });
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({timeout: true}), timeoutMs);
  });
  const result = await Promise.race([exit, timeout]);
  clearTimeout(timer);
  if (result.timeout) await terminateBounded(child, terminationGraceMs);
  return {result, stdout, stderr};
}

function validateSmokeResult({result, stdout, stderr, reportPath, smokeProfile, replacements = []}) {
  const events = parseStructuredEvents(`${stdout}\n${stderr}`);
  const backendErrors = events.filter(event => event.type === 'backend-error');

  if (result.timeout) {
    throw new Error(`Packaged app smoke test timed out.\nstdout:\n${cleanOutput(stdout, replacements)}\nstderr:\n${cleanOutput(stderr, replacements)}`);
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Packaged app did not write a smoke report (exit ${result.code}, signal ${result.signal || 'none'}).\nstdout:\n${cleanOutput(stdout, replacements)}\nstderr:\n${cleanOutput(stderr, replacements)}`);
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
    'shutdownCompleted',
  ];
  const failed = required.filter(key => report[key] !== true);
  if (report.unhandledStartupRejection !== false) failed.push('unhandledStartupRejection');
  if (smokeProfile === 'existing-p2p-spv') {
    if (report.existingP2PSpvFixture !== true) failed.push('existingP2PSpvFixture');
    if (report.localTransactionClientAbsent !== true) failed.push('localTransactionClientAbsent');
  }
  if (Array.isArray(report.backendErrors) && report.backendErrors.length) {
    failed.push(`reportBackendErrors=${report.backendErrors.length}`);
  }
  if (backendErrors.length) failed.push(`structuredBackendErrors=${backendErrors.length}`);
  if (result.code !== 0) failed.push(`exitCode=${result.code}`);

  if (failed.length) {
    throw new Error(`Packaged app smoke test failed: ${failed.join(', ')}\nReport: ${JSON.stringify(report)}\nEvents: ${JSON.stringify(events)}\nstderr:\n${cleanOutput(stderr, replacements)}`);
  }
  return {report, events};
}

module.exports = {
  EVENT_PREFIX,
  cleanOutput,
  parseStructuredEvents,
  runChild,
  terminateBounded,
  validateSmokeResult,
};
