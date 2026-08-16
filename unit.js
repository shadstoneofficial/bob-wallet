const nodeCrypto = eval('require')('crypto');
const { configure } = require('enzyme');
const Adapter = require('@cfaester/enzyme-adapter-react-18');

const cryptoShim = {
  getRandomValues(array) {
    return nodeCrypto.randomFillSync(array);
  },
};

for (const target of [globalThis, globalThis.window, globalThis.self]) {
  if (target && !target.crypto) {
    Object.defineProperty(target, 'crypto', {
      configurable: true,
      value: cryptoShim,
    });
  } else if (target && !target.crypto.getRandomValues) {
    Object.defineProperty(target.crypto, 'getRandomValues', {
      configurable: true,
      value: cryptoShim.getRandomValues,
    });
  }
}

configure({ adapter: new Adapter.default() });

window.bobElectron = {
  ipc: {send() {}, on() { return 1; }, off() {}},
  shell: {openExternal() { return Promise.resolve(false); }},
  dialog: {
    showOpenDialog() { return Promise.resolve({canceled: true, filePaths: []}); },
    showOpenDialogSync() { return undefined; },
    showSaveDialogSync() { return undefined; },
  },
  files: {
    readFile() { return Promise.reject(new Error('No test file selected.')); },
    readFileSync() { throw new Error('No test file selected.'); },
    writeFile() { return Promise.resolve(true); },
  },
  app: {isPackaged: false, getPath() { return null; }},
};

require('./app/pages/Auction/tests/RepairBid.spec');
require('./app/pages/MyDomain/tests/Records.spec');
require('./app/background/wallet/tests/liquidityHtlc.spec');
require('./app/background/wallet/tests/registerValidation.spec');
require('./app/background/wallet/tests/revealBatch.spec');
require('./app/background/node/tests/spvHelper.spec');
require('./app/ducks/tests/nodeReducer.spec');
require('./app/deeplink/tests/index.spec');
require('./app/utils/tests/paidNameTransfer.spec');
require('./app/utils/tests/shakedexListingAction.spec');
require('./app/utils/tests/marketplaceAuctions.spec');
require('./app/utils/tests/marketplaceRequest.spec');
require('./app/pages/Exchange/tests/marketplaceSpv.spec');
require('./app/utils/tests/urlPolicy.spec');
require('./app/utils/tests/transactionNotifications.spec');
require('./app/background/ipc/tests/ipc.spec');
require('./app/background/hip2/tests/alias.spec');
require('./app/background/hip2/tests/port.spec');
require('./app/components/AddressInput/tests/index.spec');
