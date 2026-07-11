import path from 'path';
import * as electron from 'electron';
import traceDeeplink from './utils/deeplinkTrace';
import {getSafeExternalUrl} from './utils/urlPolicy';
import {ipcMain, dialog} from 'electron';
import fs from 'fs';

let mainWindow;
let rendererReady = false;
let pendingDeeplinks = [];
let bridgeHandlersInstalled = false;
const authorizedFilePaths = new Set();

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
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  mainWindow = new electron.BrowserWindow({
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

  installBridgeHandlers();

  mainWindow.loadURL(`file://${__dirname}/app.html`);

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    const safeUrl = getSafeExternalUrl(url);
    if (safeUrl) {
      electron.shell.openExternal(safeUrl);
    }
    return {action: 'deny'};
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
    }
  });

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    rendererReady = true;
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }

    while (pendingDeeplinks.length) {
      const pendingDeeplink = pendingDeeplinks.shift();
      traceDeeplink('main-window-flush-pending', {url: pendingDeeplink});
      mainWindow.webContents.send('deeplink', pendingDeeplink);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;

    // need to quit the entire app (i.e., including
    // the HSD window) once the main window is closed
    // on Windows
    if (process.platform === 'win32') {
      electron.app.quit();
    }
  });
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
