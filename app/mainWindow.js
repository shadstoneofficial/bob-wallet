import path from 'path';
import * as electron from 'electron';
import traceDeeplink from './utils/deeplinkTrace';
import {getSafeExternalUrl} from './utils/urlPolicy';
import {ipcMain, dialog} from 'electron';
import fs from 'fs';

let mainWindow;
let rendererReady = false;
let rendererReadyGeneration = 0;
let rendererReadyWaiters = [];
let rendererRecoveryAttempts = 0;
let rendererFailureDialogShown = false;
let pendingDeeplinks = [];
let bridgeHandlersInstalled = false;
const authorizedFilePaths = new Set();

function isUsableWindow(window) {
  return Boolean(
    window
    && !window.isDestroyed()
    && window.webContents
    && !window.webContents.isDestroyed()
  );
}

function settleReadyWaiters(error) {
  const waiters = rendererReadyWaiters;
  rendererReadyWaiters = [];

  for (const waiter of waiters) {
    if (error) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    } else if (rendererReadyGeneration > waiter.afterGeneration) {
      clearTimeout(waiter.timeout);
      waiter.resolve({window: mainWindow, generation: rendererReadyGeneration});
    } else {
      rendererReadyWaiters.push(waiter);
    }
  }
}

function clearMainWindow(window) {
  if (mainWindow !== window) return;
  mainWindow = null;
  rendererReady = false;
}

function destroyWindow(window) {
  clearMainWindow(window);
  if (window && !window.isDestroyed()) window.destroy();
}

function showRendererFailureAndQuit(error) {
  if (rendererFailureDialogShown) return;
  rendererFailureDialogShown = true;
  const detail = error && (error.stack || error.message) || String(error);

  electron.dialog.showMessageBox(null, {
    type: 'error',
    buttons: ['Quit'],
    title: 'Couldn\'t Open Bob',
    message: 'Bob could not load its application window and must quit.',
    detail,
  }).catch(dialogError => {
    console.error('Could not display renderer startup error:', dialogError);
  }).finally(() => electron.app.quit());
}

export function waitForMainWindowReady(afterGeneration = 0, timeoutMs = 30000) {
  if (rendererReady && isUsableWindow(mainWindow) && rendererReadyGeneration > afterGeneration) {
    return Promise.resolve({window: mainWindow, generation: rendererReadyGeneration});
  }

  return new Promise((resolve, reject) => {
    const waiter = {afterGeneration, resolve, reject, timeout: null};
    waiter.timeout = setTimeout(() => {
      rendererReadyWaiters = rendererReadyWaiters.filter(item => item !== waiter);
      reject(new Error('Timed out waiting for the Bob renderer to finish loading.'));
    }, timeoutMs);
    rendererReadyWaiters.push(waiter);
  });
}

function authorizePaths(paths = []) {
  for (const filePath of paths) {
    if (typeof filePath === 'string' && path.isAbsolute(filePath)) {
      authorizedFilePaths.add(path.resolve(filePath));
    }
  }
}

function assertAuthorizedPath(filePath) {
  const resolved = typeof filePath === 'string' ? path.resolve(filePath) : '';
  if (!authorizedFilePaths.has(resolved)) {
    throw new Error('File access was not authorized by a Bob file dialog.');
  }
  return resolved;
}

function isTrustedSender(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents);
}

export function isTrustedRendererEvent(event) {
  return isTrustedSender(event);
}

function installBridgeHandlers() {
  if (bridgeHandlersInstalled) return;
  bridgeHandlersInstalled = true;

  ipcMain.handle('BOB/OPEN_EXTERNAL', (event, url) => {
    if (!isTrustedSender(event)) return false;
    const safeUrl = getSafeExternalUrl(url);
    if (!safeUrl) return false;
    return electron.shell.openExternal(safeUrl)
      .then(() => true)
      .catch(() => false);
  });
  ipcMain.handle('BOB/DIALOG_OPEN', (event, options) => {
    if (!isTrustedSender(event)) return {canceled: true, filePaths: []};
    return dialog.showOpenDialog(mainWindow, options || {}).then(result => {
      authorizePaths(result.filePaths);
      return result;
    });
  });
  ipcMain.on('BOB/DIALOG_OPEN_SYNC', (event, options) => {
    const result = isTrustedSender(event)
      ? dialog.showOpenDialogSync(mainWindow, options || {})
      : undefined;
    authorizePaths(result);
    event.returnValue = result;
  });
  ipcMain.on('BOB/DIALOG_SAVE_SYNC', (event, options) => {
    const result = isTrustedSender(event)
      ? dialog.showSaveDialogSync(mainWindow, options || {})
      : undefined;
    authorizePaths(result ? [result] : []);
    event.returnValue = result;
  });
  ipcMain.handle('BOB/FILE_READ', async (event, filePath, encoding) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted file request.');
    return fs.promises.readFile(assertAuthorizedPath(filePath), encoding || undefined);
  });
  ipcMain.on('BOB/FILE_READ_SYNC', (event, filePath, encoding) => {
    try {
      if (!isTrustedSender(event)) throw new Error('Untrusted file request.');
      event.returnValue = {data: fs.readFileSync(assertAuthorizedPath(filePath), encoding || undefined)};
    } catch (e) {
      event.returnValue = {error: e.message};
    }
  });
  ipcMain.handle('BOB/FILE_WRITE', async (event, filePath, data) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted file request.');
    await fs.promises.writeFile(assertAuthorizedPath(filePath), data);
    return true;
  });
  ipcMain.on('BOB/APP_IS_PACKAGED', event => {
    event.returnValue = isTrustedSender(event) ? electron.app.isPackaged : true;
  });
  ipcMain.on('BOB/APP_GET_PATH', (event, name) => {
    const allowed = new Set(['userData', 'documents', 'downloads']);
    event.returnValue = isTrustedSender(event) && allowed.has(name)
      ? electron.app.getPath(name)
      : null;
  });
  ipcMain.on('BOB/TRACE_DEEPLINK', (event, payload) => {
    if (!isTrustedSender(event) || !payload || typeof payload.stage !== 'string') return;
    traceDeeplink(payload.stage.slice(0, 80), payload.details || {});
  });
}

export default function showMainWindow() {
  if (isUsableWindow(mainWindow) && rendererReady) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  if (isUsableWindow(mainWindow) && mainWindow.webContents.isLoadingMainFrame()) {
    return mainWindow;
  }

  if (mainWindow) {
    destroyWindow(mainWindow);
  }

  const window = new electron.BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    }
  });
  mainWindow = window;
  rendererReady = false;

  installBridgeHandlers();

  window.webContents.setWindowOpenHandler(({url}) => {
    const safeUrl = getSafeExternalUrl(url);
    if (safeUrl) {
      electron.shell.openExternal(safeUrl);
    }
    return {action: 'deny'};
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  window.webContents.on('did-finish-load', () => {
    if (mainWindow !== window || !isUsableWindow(window)) return;
    rendererReady = true;
    rendererReadyGeneration += 1;
    rendererRecoveryAttempts = 0;
    if (process.env.START_MINIMIZED) {
      window.minimize();
    } else {
      window.show();
      window.focus();
    }

    settleReadyWaiters();

    while (pendingDeeplinks.length) {
      const pendingDeeplink = pendingDeeplinks.shift();
      traceDeeplink('main-window-flush-pending', {url: pendingDeeplink});
      window.webContents.send('deeplink', pendingDeeplink);
    }
  });

  window.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (isMainFrame === false || mainWindow !== window) return;
    const error = new Error(`Renderer failed to load ${url || 'app.html'} (${code}): ${description}`);
    destroyWindow(window);
    settleReadyWaiters(error);
    showRendererFailureAndQuit(error);
  });

  window.webContents.on('render-process-gone', (event, details) => {
    if (mainWindow !== window) return;
    const error = new Error(`Renderer process exited unexpectedly: ${details.reason}`);
    destroyWindow(window);
    settleReadyWaiters(error);

    if (rendererRecoveryAttempts < 1 && electron.app.isReady()) {
      rendererRecoveryAttempts += 1;
      showMainWindow();
      return;
    }

    showRendererFailureAndQuit(error);
  });

  window.on('closed', () => {
    const closedBeforeReady = mainWindow === window && !rendererReady;
    clearMainWindow(window);
    if (closedBeforeReady) settleReadyWaiters(new Error('Bob window closed before its renderer finished loading.'));

    // need to quit the entire app (i.e., including
    // the HSD window) once the main window is closed
    // on Windows
    if (process.platform === 'win32') {
      electron.app.quit();
    }
  });

  window.loadURL(`file://${__dirname}/app.html`).catch(error => {
    if (mainWindow !== window) return;
    destroyWindow(window);
    settleReadyWaiters(error);
    showRendererFailureAndQuit(error);
  });

  return window;
}

export function getMainWindow() {
  return mainWindow;
}

export function dispatchToMainWindow(reduxAction) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return false;
  }
  mainWindow.webContents.send('ipcToRedux', reduxAction);
  return true;
}

export function sendDeeplinkToMainWindow(url) {
  if (!url) {
    return;
  }

  if (electron.app.isReady()) {
    showMainWindow();
  }

  if (!mainWindow || !rendererReady) {
    traceDeeplink('main-window-queue', {
      url,
      hasMainWindow: Boolean(mainWindow),
      rendererReady,
    });
    pendingDeeplinks.push(url);
    return;
  }

  traceDeeplink('main-window-send', {url});
  mainWindow.webContents.send('deeplink', url);
}
