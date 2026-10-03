import "isomorphic-fetch";

// if (process.platform === 'win32') {
  //process.env.NODE_BACKEND = 'js';
// }

import {app, dialog} from 'electron';
import path from 'path';

const DEEPLINK_PROTOCOLS = new Set(['bob:', 'bob-learnhns:']);
const isPackagedSmokeTest = process.env.BOB_PACKAGED_SMOKE_TEST === 'true';
const packagedSmokeProfile = process.env.BOB_SMOKE_PROFILE || '';
let Sentry = null;
let earlyStartupError = null;
let runtimeModules = null;
let startupFailureHandled = false;
let pendingStartupDeeplinks = [];
const appRuntimeHints = [
  app.getName(),
  process.execPath,
  process.resourcesPath || '',
  process.argv.join(' '),
].join(' ');
const isLearnHnsForkBuild = process.env.BOB_LEARNHNS_TEST === 'true'
  || process.env.BOB_LEARNHNS_FORK === 'true'
  || appRuntimeHints.includes('Bob LearnHNS')
  || appRuntimeHints.includes('Bob LearnHNS Test')
  || appRuntimeHints.includes('com.learnhns.Bob')
  || appRuntimeHints.includes('com.learnhns.BobTest');

if (isLearnHnsForkBuild) {
  process.env.BOB_LEARNHNS_FORK = 'true';
  process.env.BOB_LEARNHNS_TEST = 'true';
  app.setName('Bob LearnHNS');
  const smokeUserData = process.env.BOB_SMOKE_USER_DATA;
  app.setPath('userData', isPackagedSmokeTest && smokeUserData && path.isAbsolute(smokeUserData)
    ? smokeUserData
    : path.join(app.getPath('appData'), 'Bob LearnHNS'));
}

try {
  Sentry = require('@sentry/electron/main');
  require('./sentry');

  if (process.env.NODE_ENV === 'production') {
    require('source-map-support').install();
  }
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
    require('electron-debug')();
  }
} catch (error) {
  earlyStartupError = error;
  console.error('Early Bob startup initialization failed:', error);
}

function traceDeeplink(stage, details) {
  if (runtimeModules) runtimeModules.traceDeeplink(stage, details);
}

function sendDeeplink(url) {
  if (!url) return;
  if (runtimeModules) runtimeModules.sendDeeplinkToMainWindow(url);
  else pendingStartupDeeplinks.push(url);
}

if (!isPackagedSmokeTest && isLearnHnsForkBuild) {
  if (process.env.NODE_ENV === 'development' && (process.platform === 'win32' || process.platform === 'linux')) {
    app.setAsDefaultProtocolClient('bob-learnhns', process.execPath, [
      path.resolve(path.join(app.getAppPath(), 'dist', 'main.js')),
    ]);
  } else if (process.platform === 'win32' || process.platform === 'linux') {
    app.setAsDefaultProtocolClient('bob-learnhns', process.execPath, [
      path.resolve(path.join(app.getAppPath(), 'main.js')),
    ]);
  } else {
    app.setAsDefaultProtocolClient('bob-learnhns');
  }
} else if (!isPackagedSmokeTest && process.env.NODE_ENV === 'development' && (process.platform === 'win32' || process.platform === 'linux')) {
  app.setAsDefaultProtocolClient('bob', process.execPath, [
    path.resolve(path.join(app.getAppPath(), 'dist', 'main.js')),
  ]);
} else if (!isPackagedSmokeTest && (process.platform === 'win32' || process.platform === 'linux')) {
  app.setAsDefaultProtocolClient('bob', process.execPath, [
    path.resolve(path.join(app.getAppPath(), 'main.js')),
  ]);
} else if (!isPackagedSmokeTest) {
  app.setAsDefaultProtocolClient('bob');
}

// Deeplink handler for osx
app.on('open-url', function (event, url) {
  event.preventDefault();
  traceDeeplink('main-open-url', {url});
  sendDeeplink(url);
});

// Deeplink handler for win
// https://stackoverflow.com/questions/38458857/electron-url-scheme-open-url-event
let deeplinkingUrl;
const isPrimaryInstance = app.requestSingleInstanceLock();

function getProtocolDeeplinkFromArgv(argv) {
  return [...argv].reverse().find((arg) => {
    try {
      return DEEPLINK_PROTOCOLS.has(new URL(arg).protocol);
    } catch (e) {
      return false;
    }
  });
}

if (isPrimaryInstance) {
  app.on('second-instance', (e, argv) => {
    // Someone tried to run a second instance, we should focus our window.
    if (runtimeModules) runtimeModules.showMainWindow();

    // Protocol handler for win32
    // argv: An array of the second instance’s (command line / deep linked) arguments
    if (process.platform === 'win32' || process.platform === 'linux') {
      // Keep only command line / deep linked arguments
      deeplinkingUrl = getProtocolDeeplinkFromArgv(argv);
    }

    traceDeeplink('main-second-instance', {
      argv,
      deeplinkingUrl,
    });
    sendDeeplink(deeplinkingUrl);
  });

  async function showStartupErrorAndQuit(reason) {
    if (startupFailureHandled) return;
    startupFailureHandled = true;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.error('Bob startup failed:', error);
    if (Sentry) Sentry.captureException(error);

    if (isPackagedSmokeTest) {
      const fs = require('fs');
      const reportPath = process.env.BOB_SMOKE_REPORT;
      if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ok: false, error: error.stack || error.message}));
      app.exit(1);
      return;
    }

    try {
      await dialog.showMessageBox(null, {
        type: 'error',
        buttons: ['Quit'],
        title: 'Couldn\'t Start Bob',
        message: 'An error occurred that prevented Bob from starting.',
        detail: `Error: ${error.message}\n\n${error.stack || ''}`,
      });
    } catch (dialogError) {
      console.error('Could not display startup error:', dialogError);
    } finally {
      app.quit();
    }
  }

  const handleUnhandledStartupRejection = reason => showStartupErrorAndQuit(reason);
  process.on('unhandledRejection', handleUnhandledStartupRejection);

  async function waitForSmokeCondition(check, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  async function preparePackagedSmokeFixture(services) {
    if (!isPackagedSmokeTest || packagedSmokeProfile !== 'existing-p2p-spv') return;

    const fs = require('fs');
    const hsdDir = path.join(app.getPath('userData'), 'existing-hsd-profile');
    fs.mkdirSync(hsdDir, {recursive: true});

    await services.db.put('connection_type', 'P2P');
    await services.db.put('network', 'regtest');
    await services.db.put('nodeSpvMode', '1');
    await services.db.put('nodeNoDns1', '1');
    await services.db.put('nodeApiKey', 'packaged-smoke-node-api-key');
    await services.db.put('walletApiKey', 'packaged-smoke-wallet-api-key');
    await services.db.put('hsdPrefixDir', hsdDir);
    await services.db.put('regtest-hsd-4.0.0-migrate-spv', true);
  }

  async function runPackagedSmokeTest(firstWindow, services) {
    if (!isPackagedSmokeTest) return;
    const fs = require('fs');
    const reportPath = process.env.BOB_SMOKE_REPORT;
    const firstReady = await runtimeModules.waitForMainWindowReady(0, 60000);
    const firstRendererPid = firstReady.window.webContents.getOSProcessId();
    const expectsExistingP2PSpv = packagedSmokeProfile === 'existing-p2p-spv';
    const nodeService = services.node.service;
    const localNodeStarted = !expectsExistingP2PSpv || await waitForSmokeCondition(() => (
      nodeService.connectionType === 'P2P'
      && nodeService.networkName === 'regtest'
      && nodeService.spv === true
      && Boolean(nodeService.hsd)
      && Boolean(nodeService.client)
    ));
    await new Promise(resolve => setTimeout(resolve, 1000));
    const closed = new Promise(resolve => firstWindow.once('closed', resolve));
    firstWindow.close();
    await closed;

    const secondWindow = runtimeModules.showMainWindow();
    const secondReady = await runtimeModules.waitForMainWindowReady(firstReady.generation, 60000);
    const report = {
      ok: true,
      mainWindowCreated: Boolean(firstWindow),
      rendererProcessStarted: firstRendererPid > 0,
      appHtmlLoaded: true,
      servicesInitialized: true,
      dockReopenCreatedWindow: secondWindow !== firstWindow,
      dockReopenLoaded: secondReady.generation > firstReady.generation,
      secondRendererProcessStarted: secondReady.window.webContents.getOSProcessId() > 0,
      unhandledStartupRejection: false,
      existingP2PSpvFixture: !expectsExistingP2PSpv || localNodeStarted,
      localTransactionClientAbsent: !expectsExistingP2PSpv || nodeService.transactionClient === null,
    };
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report));
    app.quit();
  }

  async function startApplication() {
    if (earlyStartupError) throw earlyStartupError;

    const mainWindowModule = require('./mainWindow');
    const menuModule = require('./menu');
    const traceModule = require('./utils/deeplinkTrace');
    runtimeModules = {
      showMainWindow: mainWindowModule.default || mainWindowModule,
      sendDeeplinkToMainWindow: mainWindowModule.sendDeeplinkToMainWindow,
      waitForMainWindowReady: mainWindowModule.waitForMainWindowReady,
      MenuBuilder: menuModule.default || menuModule,
      traceDeeplink: traceModule.default || traceModule,
    };

    const services = {
      ipc: require('./background/ipc/service'),
      logger: require('./background/logger/service'),
      db: require('./background/db/service'),
      node: require('./background/node/service'),
      storage: require('./background/storage/service'),
      wallet: require('./background/wallet/service'),
      analytics: require('./background/analytics/service'),
      connections: require('./background/connections/service'),
      setting: require('./background/setting/service'),
      hip2: require('./background/hip2/service'),
      claim: require('./background/claim/service'),
      ledger: require('./background/ledger/service'),
      hnsInvestments: require('./background/hnsInvestments/service'),
      shakedex: require('./background/shakedex/service.js'),
      systemDns: require('./background/systemDns/service'),
    };

    const server = services.ipc.start();
    services.logger.start(server);
    await services.db.start(server);
    await preparePackagedSmokeFixture(services);
    await services.node.start(server);
    await services.storage.start(server);
    await services.wallet.start(server);
    await services.analytics.start(server);
    await services.connections.start(server);
    await services.setting.start(server);
    await services.hip2.start(server);
    await services.claim.start(server);
    await services.ledger.start(server);
    await services.hnsInvestments.start(server);
    await services.shakedex.start(server);
    await services.systemDns.start(server);

    app.on('window-all-closed', () => {
      // Respect the macOS convention of having the application in memory even
      // after all windows have been closed
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      runtimeModules.showMainWindow();
    });

    let didFireQuitHandlers = false;

    function quit(event) {
      if (didFireQuitHandlers) {
        return;
      }
      event.preventDefault();
      didFireQuitHandlers = true;

      services.shakedex.closeDB()
        .catch((e) => console.error('Error in shutdown:', e))
        .then(services.db.close)
        .catch((e) => console.error('Error in shutdown:', e))
        .then(() => app.quit());
    }

    app.on('before-quit', quit);

    const firstWindow = runtimeModules.showMainWindow();

    while (pendingStartupDeeplinks.length) {
      runtimeModules.sendDeeplinkToMainWindow(pendingStartupDeeplinks.shift());
    }

    const menuBuilder = new runtimeModules.MenuBuilder();
    menuBuilder.buildMenu();

    await runPackagedSmokeTest(firstWindow, services);
  }

  app.on('ready', () => {
    startApplication()
      .then(() => process.removeListener('unhandledRejection', handleUnhandledStartupRejection))
      .catch(showStartupErrorAndQuit);
  });
} else {
  app.quit();
}
