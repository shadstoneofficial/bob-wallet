import { makeServer, nullServer } from './ipc';
import {isTrustedRendererEvent} from '../../mainWindow';

export let defaultServer;

export function start() {
  if (!require('electron').ipcMain) {
    defaultServer = nullServer
  } else {
    defaultServer = makeServer(require('electron').ipcMain, isTrustedRendererEvent);
  }

  defaultServer.start();
  return defaultServer;
}
