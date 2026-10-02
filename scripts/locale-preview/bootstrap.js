// Fail closed if any fixture accidentally attempts wallet IPC, I/O, or network access.
const blocked = () => { throw new Error('Fixture review: operation blocked'); };
window.bobElectron = {
  ipc: {send: blocked, on: () => 1, off() {}},
  shell: {openExternal: blocked},
  dialog: {
    showOpenDialog: blocked,
    showOpenDialogSync: blocked,
    showSaveDialogSync: blocked,
  },
  files: {readFile: blocked, readFileSync: blocked, writeFile: blocked},
  app: {isPackaged: false, getPath: () => null},
};
window.fetch = blocked;
window.WebSocket = blocked;
window.XMLHttpRequest = blocked;
// Render portal contents inline, without mounting or attaching handlers.
require('react-dom').createPortal = children => children;
require('./screens');
