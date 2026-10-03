import {SHAKEX_MANIFEST} from './shakex/manifest';
import {LIQUIDITY_ADDON_NAME} from '../constants/liquiditySpotChannels';
import {AddonRegistry, createCatalogEntries, validateManifest} from './foundation';

const BUILTIN_ADDON_MANIFESTS = Object.freeze([
  SHAKEX_MANIFEST,
  {
    schemaVersion: 1,
    id: 'shakedex-marketplace',
    name: 'Shakedex Marketplace',
    publisher: {name: 'Bob Wallet maintainers'},
    version: '1.0.0',
    description: 'Bob\'s built-in Shakedex marketplace and channel interface.',
    entry: {kind: 'trusted-bundled-route', route: '/exchange'},
    capabilities: ['marketplace.readListings'],
    origins: [],
    networks: ['main', 'testnet', 'regtest', 'simnet'],
  },
  {
    schemaVersion: 1,
    id: 'send-name',
    name: 'Send Name',
    publisher: {name: 'Bob Wallet maintainers'},
    version: '1.0.0',
    description: 'Bob\'s built-in name transfer and paid-claim flow.',
    entry: {kind: 'trusted-bundled-route', route: '/send?asset=name&mode=send'},
    capabilities: ['names.requestTransfer'],
    origins: [],
    networks: ['main', 'testnet', 'regtest', 'simnet'],
  },
  {
    schemaVersion: 1,
    id: 'liquidity-spot',
    name: LIQUIDITY_ADDON_NAME,
    publisher: {
      name: 'Liquidity Spot',
      url: 'https://liquidity.spot',
    },
    version: '1.0.0',
    description: 'External Liquidity Spot P2P coordination preview.',
    entry: {kind: 'external-content', url: 'https://liquidity.spot/p2p'},
    capabilities: ['external.openUrl'],
    origins: ['https://liquidity.spot'],
    networks: ['main'],
  },
  ...(process.env.NODE_ENV !== 'production' && process.env.BOB_SYSTEM_DNS_DEV === 'true' ? [{
    schemaVersion: 1,
    id: 'bob-system-dns',
    name: 'Bob System DNS',
    publisher: {name: 'Bob Wallet maintainers'},
    version: '0.1.0-development',
    description: 'Read-only readiness and resolver health checks for a future local system DNS feature.',
    entry: {kind: 'native-service', service: 'system-dns'},
    capabilities: ['resolver.readStatus'],
    origins: [],
    networks: ['main'],
  }] : []),
].map(validateManifest));

const builtInAddonRegistry = new AddonRegistry(BUILTIN_ADDON_MANIFESTS);

function createBuiltInCatalog(definitions) {
  return createCatalogEntries(builtInAddonRegistry, definitions);
}

export {
  BUILTIN_ADDON_MANIFESTS,
  builtInAddonRegistry,
  createBuiltInCatalog,
};
