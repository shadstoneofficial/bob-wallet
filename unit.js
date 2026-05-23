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

require('./app/pages/Auction/tests/RepairBid.spec');
require('./app/pages/MyDomain/tests/Records.spec');
require('./app/background/wallet/tests/liquidityHtlc.spec');
require('./app/utils/tests/paidNameTransfer.spec');
