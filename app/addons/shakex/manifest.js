import {validateManifest} from '../foundation';
import {SHAKEX_ORIGIN} from './client';

// Trusted bundled metadata, not a runtime permission grant. Bob owns every
// record review and wallet action; the public discovery feed is mainnet-only.
export const SHAKEX_MANIFEST = validateManifest({
  schemaVersion: 1,
  id: 'shakex',
  name: 'ShakeX',
  publisher: {
    name: 'Marioo / ShakeX; bundled adapter maintained by Bob maintainers',
    url: SHAKEX_ORIGIN,
  },
  version: '1.0.0',
  description: 'Community name discovery and reviewed sale-record updates in Bob.',
  entry: {kind: 'trusted-bundled-route', route: '/addons/shakex'},
  capabilities: [
    'marketplace.readListings',
    'external.openUrl',
    'names.readSelectedResource',
    'names.proposeRecordUpdate',
    'navigation.openOwnedName',
  ],
  origins: [SHAKEX_ORIGIN],
  networks: ['main'],
});
