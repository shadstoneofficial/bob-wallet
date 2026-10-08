const fs = require('fs');
const prefix = 'BOB_PACKAGED_TEST_EVENT ';
const report = {
  ok: true,
  mainWindowCreated: true,
  rendererProcessStarted: true,
  appHtmlLoaded: true,
  servicesInitialized: true,
  dockReopenCreatedWindow: true,
  dockReopenLoaded: true,
  secondRendererProcessStarted: true,
  unhandledStartupRejection: false,
  existingP2PSpvFixture: true,
  localTransactionClientAbsent: true,
  shutdownCompleted: true,
  backendErrors: [],
};
fs.writeFileSync(process.env.BOB_SMOKE_REPORT, JSON.stringify(report));
process.stderr.write(`${prefix}${JSON.stringify({
  version: 1,
  type: 'backend-error',
  kind: 'console-error',
  phase: 'shutdown',
  error: {name: 'AssertionError', message: 'Pool is not connected!'},
})}\n`);
