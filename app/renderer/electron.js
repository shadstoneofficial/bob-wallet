const bridge = window.bobElectron;
if (!bridge) {
  throw new Error('Bob preload bridge is unavailable.');
}

const listenerIds = new WeakMap();

function rememberListener(channel, listener, id) {
  let channels = listenerIds.get(listener);
  if (!channels) {
    channels = new Map();
    listenerIds.set(listener, channels);
  }
  const ids = channels.get(channel) || [];
  ids.push(id);
  channels.set(channel, ids);
}

export const ipcRenderer = {
  send(channel, ...args) {
    bridge.ipc.send(channel, ...args);
  },
  on(channel, listener) {
    rememberListener(channel, listener, bridge.ipc.on(channel, listener));
    return ipcRenderer;
  },
  off(channel, listener) {
    const channels = listenerIds.get(listener);
    const ids = channels && channels.get(channel);
    if (ids && ids.length) bridge.ipc.off(ids.shift());
    return ipcRenderer;
  },
  removeListener(channel, listener) {
    return ipcRenderer.off(channel, listener);
  },
};

export const shell = bridge.shell;
export const dialog = bridge.dialog;
export const app = bridge.app;
export const remote = {app};

export default {ipcRenderer, shell, dialog, app, remote};
