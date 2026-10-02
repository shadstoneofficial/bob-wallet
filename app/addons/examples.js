import {validateManifest} from './foundation';

// Coordination examples only. These are validated but deliberately not added
// to builtInAddonRegistry and do not install routes, services, or remote code.
const EXAMPLE_ADDON_MANIFESTS = Object.freeze([
  validateManifest({
    schemaVersion: 1,
    id: 'shakex',
    name: 'ShakeX',
    publisher: {
      name: 'Marioo / ShakeX; bundled adapter maintained by Bob maintainers',
      url: 'https://shakex.fun',
    },
    version: '0.1.0-example',
    description: 'Proposed contract for reviewed, bundled ShakeX discovery and name-record proposals.',
    entry: {kind: 'trusted-bundled-route', route: '/addons/shakex'},
    capabilities: [
      'marketplace.readListings',
      'names.readSelectedResource',
      'names.proposeRecordUpdate',
      'navigation.openOwnedName',
    ],
    origins: ['https://shakex.fun'],
    networks: ['main'],
  }),
  validateManifest({
    schemaVersion: 1,
    id: 'bob-name-quest',
    name: 'Bob\'s Name Quest',
    publisher: {
      name: 'Bob Wallet website maintainers',
      url: 'https://bobwallet.org',
    },
    version: '0.1.0-example',
    description: 'Proposed external game entry with no wallet or name capabilities.',
    entry: {kind: 'external-content', url: 'https://bobwallet.org/game/play'},
    capabilities: ['external.openUrl'],
    origins: ['https://bobwallet.org'],
    networks: ['main'],
  }),
  validateManifest({
    schemaVersion: 1,
    id: 'bob-system-dns',
    name: 'Bob System DNS',
    publisher: {name: 'Bob Wallet maintainers'},
    version: '0.1.0-example',
    description: 'Proposed native resolver status and host-mediated system DNS controls.',
    entry: {kind: 'native-service', service: 'system-dns'},
    capabilities: [
      'resolver.readStatus',
      'resolver.requestSystemDnsControl',
    ],
    origins: [],
    networks: ['main'],
  }),
]);

export {EXAMPLE_ADDON_MANIFESTS};
