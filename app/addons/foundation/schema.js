const MANIFEST_SCHEMA_VERSION = 1;

const ENTRY_KINDS = Object.freeze([
  'trusted-bundled-route',
  'external-content',
  'native-service',
]);

const CAPABILITIES = Object.freeze([
  'external.openUrl',
  'marketplace.readListings',
  'names.readSelectedResource',
  'names.proposeRecordUpdate',
  'names.requestTransfer',
  'navigation.openOwnedName',
  'resolver.readStatus',
  'resolver.requestSystemDnsControl',
]);

const NATIVE_ONLY_CAPABILITIES = Object.freeze([
  'resolver.requestSystemDnsControl',
]);

const NETWORKS = new Set(['main', 'testnet', 'regtest', 'simnet']);
const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'publisher',
  'version',
  'description',
  'entry',
  'capabilities',
  'origins',
  'networks',
]);
const ENTRY_KEYS = new Set(['kind', 'route', 'url', 'service']);
const PUBLISHER_KEYS = new Set(['name', 'url']);

function manifestError(code, message, path = '') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw manifestError('EUNKNOWNFIELD', `Unknown field ${path}.${key}.`, `${path}.${key}`);
    }
  }
}

function requireString(value, path, {max = 256, pattern} = {}) {
  if (typeof value !== 'string' || !value || value.length > max
      || (pattern && !pattern.test(value))) {
    throw manifestError('EINVALIDFIELD', `Invalid ${path}.`, path);
  }
  return value;
}

function validateStableId(value, path = 'id') {
  return requireString(value, path, {
    max: 64,
    pattern: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  });
}

function normalizeHttpsOrigin(value, path) {
  requireString(value, path, {max: 2048});
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw manifestError('EORIGIN', `Invalid HTTPS origin at ${path}.`, path);
  }
  if (url.protocol !== 'https:' || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash || url.origin !== value) {
    throw manifestError('EORIGIN', `Expected an exact HTTPS origin at ${path}.`, path);
  }
  return url.origin;
}

function validateEntry(entry) {
  if (!plainObject(entry)) {
    throw manifestError('EENTRY', 'Manifest entry must be an object.', 'entry');
  }
  assertKnownKeys(entry, ENTRY_KEYS, 'entry');
  if (!ENTRY_KINDS.includes(entry.kind)) {
    throw manifestError('EENTRYKIND', 'Manifest entry kind is not supported.', 'entry.kind');
  }

  if (entry.kind === 'trusted-bundled-route') {
    requireString(entry.route, 'entry.route', {max: 512});
    if (!entry.route.startsWith('/') || entry.route.startsWith('//')) {
      throw manifestError('EENTRY', 'Bundled routes must be absolute Bob routes.', 'entry.route');
    }
    if (entry.url !== undefined || entry.service !== undefined) {
      throw manifestError('EENTRY', 'Bundled routes may declare only route.', 'entry');
    }
    return {kind: entry.kind, route: entry.route};
  }

  if (entry.kind === 'external-content') {
    requireString(entry.url, 'entry.url', {max: 2048});
    let url;
    try {
      url = new URL(entry.url);
    } catch (error) {
      throw manifestError('EENTRY', 'External content requires a valid URL.', 'entry.url');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw manifestError('EENTRY', 'External content must use HTTPS without credentials.', 'entry.url');
    }
    if (entry.route !== undefined || entry.service !== undefined) {
      throw manifestError('EENTRY', 'External content may declare only url.', 'entry');
    }
    return {kind: entry.kind, url: url.toString()};
  }

  requireString(entry.service, 'entry.service', {
    max: 64,
    pattern: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  });
  if (entry.route !== undefined || entry.url !== undefined) {
    throw manifestError('EENTRY', 'Native services may declare only service.', 'entry');
  }
  return {kind: entry.kind, service: entry.service};
}

function validateManifest(value) {
  if (!plainObject(value)) {
    throw manifestError('EMANIFEST', 'Add-On manifest must be an object.');
  }
  assertKnownKeys(value, MANIFEST_KEYS, 'manifest');
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw manifestError('ESCHEMAVERSION', 'Unsupported Add-On manifest schema version.', 'schemaVersion');
  }

  const id = validateStableId(value.id);
  const name = requireString(value.name, 'name', {max: 80});
  const version = requireString(value.version, 'version', {
    max: 64,
    pattern: /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/,
  });
  const description = requireString(value.description, 'description', {max: 500});

  if (!plainObject(value.publisher)) {
    throw manifestError('EPUBLISHER', 'Manifest publisher must be an object.', 'publisher');
  }
  assertKnownKeys(value.publisher, PUBLISHER_KEYS, 'publisher');
  const publisher = {
    name: requireString(value.publisher.name, 'publisher.name', {max: 120}),
  };
  if (value.publisher.url !== undefined) {
    publisher.url = normalizeHttpsOrigin(value.publisher.url, 'publisher.url');
  }

  const entry = validateEntry(value.entry);
  if (!Array.isArray(value.capabilities)) {
    throw manifestError('ECAPABILITY', 'Manifest capabilities must be an array.', 'capabilities');
  }
  const capabilities = [];
  const capabilitySet = new Set();
  for (const capability of value.capabilities) {
    if (!CAPABILITIES.includes(capability)) {
      throw manifestError('EUNKNOWNCAPABILITY', `Unknown capability ${capability}.`, 'capabilities');
    }
    if (capabilitySet.has(capability)) {
      throw manifestError('EDUPLICATECAPABILITY', `Duplicate capability ${capability}.`, 'capabilities');
    }
    if (NATIVE_ONLY_CAPABILITIES.includes(capability) && entry.kind !== 'native-service') {
      throw manifestError('ENATIVECAPABILITY', `${capability} is restricted to a native service.`, 'capabilities');
    }
    capabilitySet.add(capability);
    capabilities.push(capability);
  }

  if (!Array.isArray(value.origins)) {
    throw manifestError('EORIGIN', 'Manifest origins must be an array.', 'origins');
  }
  const origins = value.origins.map((origin, index) =>
    normalizeHttpsOrigin(origin, `origins[${index}]`));
  if (new Set(origins).size !== origins.length) {
    throw manifestError('EDUPLICATEORIGIN', 'Manifest origins must be unique.', 'origins');
  }

  if (entry.kind === 'external-content') {
    const entryOrigin = new URL(entry.url).origin;
    if (!origins.includes(entryOrigin)) {
      throw manifestError('EENTRYORIGIN', 'External entry origin must be explicitly declared.', 'origins');
    }
    if (!capabilitySet.has('external.openUrl')) {
      throw manifestError('EENTRYCAPABILITY', 'External content requires external.openUrl.', 'capabilities');
    }
  }
  if (entry.kind === 'native-service' && origins.length !== 0) {
    throw manifestError('EORIGIN', 'Native services may not declare network origins.', 'origins');
  }

  if (!Array.isArray(value.networks) || value.networks.length === 0) {
    throw manifestError('ENETWORK', 'Manifest networks must be a non-empty array.', 'networks');
  }
  const networks = [];
  for (const network of value.networks) {
    if (!NETWORKS.has(network)) {
      throw manifestError('ENETWORK', `Unsupported network ${network}.`, 'networks');
    }
    if (networks.includes(network)) {
      throw manifestError('EDUPLICATENETWORK', `Duplicate network ${network}.`, 'networks');
    }
    networks.push(network);
  }

  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id,
    name,
    publisher: Object.freeze(publisher),
    version,
    description,
    entry: Object.freeze(entry),
    capabilities: Object.freeze(capabilities),
    origins: Object.freeze(origins),
    networks: Object.freeze(networks),
  });
}

export {
  CAPABILITIES,
  ENTRY_KINDS,
  MANIFEST_SCHEMA_VERSION,
  NATIVE_ONLY_CAPABILITIES,
  manifestError,
  validateStableId,
  validateManifest,
};
