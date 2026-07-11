const {contextBridge, ipcRenderer} = require('electron');

const RECEIVE_CHANNELS = new Set([
  '@@RPC@@',
  'ipcToRedux',
  'deeplink',
  'LEDGER/CONNECT',
  'LEDGER/CONNECT_ERR',
  'LEDGER/CONNECT_OK',
  'MULTISIG/SHOW',
  'MULTISIG/ERR',
]);
const SEND_CHANNELS = new Set([
  '@@RPC@@',
  'LEDGER/CONNECT_CANCEL',
  'LEDGER/CONNECT_RES',
  'MULTISIG/SIGN',
  'MULTISIG/CONTINUE',
  'MULTISIG/CANCEL',
  'BOB/TRACE_DEEPLINK',
]);
const subscriptions = new Map();
let nextSubscriptionId = 0;

contextBridge.exposeInMainWorld('bobElectron', {
  ipc: {
    send(channel, ...args) {
      if (!SEND_CHANNELS.has(channel)) {
        throw new Error(`IPC send channel is not allowed: ${channel}`);
      }
      ipcRenderer.send(channel, ...args);
    },
    on(channel, listener) {
      if (!RECEIVE_CHANNELS.has(channel)) {
        throw new Error(`IPC receive channel is not allowed: ${channel}`);
      }
      const id = ++nextSubscriptionId;
      const wrapped = (event, ...args) => listener({sender: null}, ...args);
      subscriptions.set(id, {channel, wrapped});
      ipcRenderer.on(channel, wrapped);
      return id;
    },
    off(id) {
      const subscription = subscriptions.get(id);
      if (!subscription) return;
      ipcRenderer.removeListener(subscription.channel, subscription.wrapped);
      subscriptions.delete(id);
    },
  },
  shell: {
    openExternal(url) {
      return ipcRenderer.invoke('BOB/OPEN_EXTERNAL', url);
    },
  },
  dialog: {
    showOpenDialog(options) {
      return ipcRenderer.invoke('BOB/DIALOG_OPEN', options);
    },
    showOpenDialogSync(options) {
      return ipcRenderer.sendSync('BOB/DIALOG_OPEN_SYNC', options);
    },
    showSaveDialogSync(options) {
      return ipcRenderer.sendSync('BOB/DIALOG_SAVE_SYNC', options);
    },
  },
  files: {
    readFile(path, encoding) {
      return ipcRenderer.invoke('BOB/FILE_READ', path, encoding);
    },
    readFileSync(path, encoding) {
      const result = ipcRenderer.sendSync('BOB/FILE_READ_SYNC', path, encoding);
      if (result && result.error) throw new Error(result.error);
      return result && result.data;
    },
    writeFile(path, data) {
      return ipcRenderer.invoke('BOB/FILE_WRITE', path, data);
    },
  },
  app: {
    isPackaged: ipcRenderer.sendSync('BOB/APP_IS_PACKAGED'),
    getPath(name) {
      return ipcRenderer.sendSync('BOB/APP_GET_PATH', name);
    },
  },
});

window.addEventListener('DOMContentLoaded', () => {
  const scripts = [];
  const port = process.env.PORT || 1212;
  scripts.push(
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:' + port + '/dist/renderer.js'
      : './renderer.js',
  );

  scripts.map((script) => {
    const el = document.createElement('script');
    el.src = script;
    el.defer = true;
    return el;
  }).forEach((el) => document.body.appendChild(el));

  if (process.env.NODE_ENV !== 'development') {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './style.css';
    document.head.appendChild(link);
  }
});
