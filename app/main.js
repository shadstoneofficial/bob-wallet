import "isomorphic-fetch";

// if (process.platform === 'win32') {
  //process.env.NODE_BACKEND = 'js';
// }

import {app, dialog} from 'electron';
import path from 'path';

const {
  createBackendErrorMonitor,
  loadAcceptanceConfig,
  validatePackagedTestModes,
  withTimeout,
  writeJsonAtomic,
} = require('./background/packagedAcceptance/runtime');
const {
  configureLocalRegtest,
  seedDisposableMultiwallet,
} = require('./background/packagedAcceptance/fixture');
const {installAcceptanceBackendPolicy} = require('./background/packagedAcceptance/policy');
const {initializeAcceptanceAfterWindow} = require('./background/packagedAcceptance/startup');

const DEEPLINK_PROTOCOLS = new Set(['bob:', 'bob-learnhns:']);
const isPackagedSmokeTest = process.env.BOB_PACKAGED_SMOKE_TEST === 'true';
const isPackagedAcceptanceTest = process.env.BOB_PACKAGED_ACCEPTANCE_TEST === 'true';
const isPackagedTestMode = isPackagedSmokeTest || isPackagedAcceptanceTest;
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

let packagedAcceptanceConfig = null;
try {
  validatePackagedTestModes(process.env);
  packagedAcceptanceConfig = loadAcceptanceConfig(process.env, {
    appDataPath: app.getPath('appData'),
  });
} catch (error) {
  earlyStartupError = error;
}

const originalConsoleError = console.error.bind(console);
const packagedErrorMonitor = isPackagedTestMode
  ? createBackendErrorMonitor({
    writeEvent(line) {
      process.stderr.write(line);
      if (packagedAcceptanceConfig?.eventLogPath) {
        require('fs').appendFileSync(packagedAcceptanceConfig.eventLogPath, line, {mode: 0o600});
      }
    },
  })
  : null;
if (packagedErrorMonitor) {
  console.error = (...args) => {
    packagedErrorMonitor.observeConsoleError(args);
    originalConsoleError(...args);
  };
}

if (isLearnHnsForkBuild) {
  process.env.BOB_LEARNHNS_FORK = 'true';
  process.env.BOB_LEARNHNS_TEST = 'true';
  app.setName('Bob LearnHNS');
  const smokeUserData = process.env.BOB_SMOKE_USER_DATA;
  const isolatedUserData = isPackagedSmokeTest && smokeUserData && path.isAbsolute(smokeUserData)
    ? smokeUserData
    : packagedAcceptanceConfig?.userData;
  app.setPath('userData', isolatedUserData || path.join(app.getPath('appData'), 'Bob LearnHNS'));
}

try {
  if (!isPackagedTestMode) {
    Sentry = require('@sentry/electron/main');
    require('./sentry');
  }

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

if (!isPackagedTestMode && isLearnHnsForkBuild) {
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
} else if (!isPackagedTestMode && process.env.NODE_ENV === 'development' && (process.platform === 'win32' || process.platform === 'linux')) {
  app.setAsDefaultProtocolClient('bob', process.execPath, [
    path.resolve(path.join(app.getAppPath(), 'dist', 'main.js')),
  ]);
} else if (!isPackagedTestMode && (process.platform === 'win32' || process.platform === 'linux')) {
  app.setAsDefaultProtocolClient('bob', process.execPath, [
    path.resolve(path.join(app.getAppPath(), 'main.js')),
  ]);
} else if (!isPackagedTestMode) {
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

    if (isPackagedTestMode) {
      const reportPath = process.env.BOB_SMOKE_REPORT || packagedAcceptanceConfig?.statusPath;
      writeJsonAtomic(reportPath, {
        ok: false,
        error: error.stack || error.message,
        backendErrors: packagedErrorMonitor?.snapshot() || [],
      });
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

  async function preparePackagedFixture(services) {
    if (isPackagedSmokeTest && packagedSmokeProfile === 'existing-p2p-spv') {
      await configureLocalRegtest(services, 'existing-hsd-profile');
    }
    if (packagedAcceptanceConfig) {
      await configureLocalRegtest(services, 'acceptance-hsd-profile', {
        profileRoot: packagedAcceptanceConfig.profileRoot,
      });
    }
  }

  async function finishPackagedSmokeTest(report, services) {
    packagedErrorMonitor.setPhase('shutdown');
    let shutdownCompleted = false;
    try {
      await withTimeout((async () => {
        await services.shakedex.closeDB();
        await services.node.service.stop();
        await services.db.close();
        services.ipc.defaultServer?.stop();
      })(), 20000, 'Packaged test shutdown');
      await new Promise(resolve => setTimeout(resolve, 500));
      shutdownCompleted = true;
    } catch (error) {
      console.error('Packaged test shutdown failed:', error);
    }

    report.shutdownCompleted = shutdownCompleted;
    report.backendErrors = packagedErrorMonitor.snapshot();
    report.ok = report.ok && shutdownCompleted && report.backendErrors.length === 0;
    writeJsonAtomic(process.env.BOB_SMOKE_REPORT, report);
    app.exit(report.ok ? 0 : 1);
  }

  async function runPackagedSmokeTest(firstWindow, services) {
    if (!isPackagedSmokeTest) return;
    packagedErrorMonitor.setPhase('running');
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
    await finishPackagedSmokeTest(report, services);
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
    };
    installAcceptanceBackendPolicy(services, packagedAcceptanceConfig);

    const server = services.ipc.start();
    services.logger.start(server);
    await services.db.start(server);
    await preparePackagedFixture(services);
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

    async function finishPackagedAcceptanceShutdown() {
      packagedErrorMonitor.setPhase('shutdown');
      let shutdownCompleted = false;
      try {
        await withTimeout((async () => {
          await services.shakedex.closeDB();
          await services.node.service.stop();
          await services.db.close();
          services.ipc.defaultServer?.stop();
        })(), 20000, 'Packaged acceptance shutdown');
        await new Promise(resolve => setTimeout(resolve, 500));
        shutdownCompleted = true;
      } catch (error) {
        console.error('Packaged test shutdown failed:', error);
      }

      const backendErrors = packagedErrorMonitor.snapshot();
      writeJsonAtomic(packagedAcceptanceConfig.statusPath, {
        ok: shutdownCompleted && backendErrors.length === 0,
        ready: false,
        shutdownCompleted,
        userData: packagedAcceptanceConfig.userData,
        backendErrors,
      });
      app.exit(shutdownCompleted && backendErrors.length === 0 ? 0 : 1);
    }

    function quit(event) {
      if (didFireQuitHandlers) {
        return;
      }
      event.preventDefault();
      didFireQuitHandlers = true;

      if (isPackagedAcceptanceTest) {
        finishPackagedAcceptanceShutdown()
          .catch(error => {
            console.error('Packaged test shutdown failed:', error);
            app.exit(1);
          });
        return;
      }

      services.shakedex.closeDB()
        .catch((e) => console.error('Error in shutdown:', e))
        .then(services.db.close)
        .catch((e) => console.error('Error in shutdown:', e))
        .then(() => app.quit());
    }

    if (!isPackagedSmokeTest) app.on('before-quit', quit);

    let firstWindow;
    if (packagedAcceptanceConfig) {
      packagedErrorMonitor.setPhase('interactive');
      firstWindow = await initializeAcceptanceAfterWindow({
        showMainWindow: runtimeModules.showMainWindow,
        seedFixture: () => seedDisposableMultiwallet(services, packagedAcceptanceConfig),
        publishReady: fixture => writeJsonAtomic(packagedAcceptanceConfig.statusPath, {
          ok: packagedErrorMonitor.snapshot().length === 0,
          ready: true,
          fixture,
          userData: packagedAcceptanceConfig.userData,
          backendErrors: packagedErrorMonitor.snapshot(),
        }),
      });
    } else {
      firstWindow = runtimeModules.showMainWindow();
    }

    while (pendingStartupDeeplinks.length) {
      runtimeModules.sendDeeplinkToMainWindow(pendingStartupDeeplinks.shift());
    }

    const menuBuilder = new runtimeModules.MenuBuilder();
    menuBuilder.buildMenu();

    await runPackagedSmokeTest(firstWindow, services);
  }

  app.on('ready', () => {
    startApplication()
      .then(() => {
        if (!isPackagedTestMode) {
          process.removeListener('unhandledRejection', handleUnhandledStartupRejection);
        }
      })
      .catch(showStartupErrorAndQuit);
  });
} else {
  app.quit();
}
