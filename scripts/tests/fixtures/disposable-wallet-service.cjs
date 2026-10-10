const fs = require('node:fs');
const path = require('node:path');
const {parseSync} = require('@babel/core');
const basketScopeError = message => Object.assign(new Error(message), {code: 'BASKET_SCOPE_CHANGED'});

const source = fs.readFileSync(path.join(__dirname, '../../../app/background/wallet/service.js'), 'utf8');
const walletClass = parseSync(source, {configFile: false, babelrc: false,
  parserOpts: {plugins: ['classProperties']}}).program.body.find(node =>
  node.type === 'ClassDeclaration' && node.id.name === 'WalletService');

function disposableWalletService() {
  const wallet = {getTX: async () => null};
  const service = {name: 'acceptance-primary', networkName: 'regtest',
    walletSelectionGeneration: 0, rescanBackendGeneration: 0,
    node: {wdb: {network: {type: 'regtest'}, get: async id =>
      ['acceptance-primary', 'acceptance-secondary'].includes(id) ? wallet : null}}};
  for (const name of ['setWallet', '_assertBidManyCurrent', '_registerAllContext', 'getRegisterAllStatus']) {
    const node = walletClass.body.body.find(entry => entry.key.name === name);
    service[name] = new Function('basketScopeError',
      `return function(){return (${source.slice(node.value.start, node.value.end)});};`)(basketScopeError).call(service);
  }
  return service;
}

module.exports = {disposableWalletService};
