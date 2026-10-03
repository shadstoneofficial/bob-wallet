import {manifestError, validateStableId} from './schema';

function navigationFor(manifest) {
  switch (manifest.entry.kind) {
    case 'trusted-bundled-route':
      return {href: manifest.entry.route, internal: true};
    case 'external-content':
      return {href: manifest.entry.url, internal: false};
    case 'native-service':
      return {href: null, internal: true};
    default:
      throw manifestError('EENTRYKIND', 'Unsupported catalog entry kind.', 'entry.kind');
  }
}

function createCatalogEntries(registry, definitions) {
  if (!registry || !Array.isArray(definitions)) {
    throw manifestError('ECATALOG', 'Catalog requires a registry and definitions.');
  }

  const entries = definitions.map(definition => {
    if (!definition.manifestId) {
      return {...definition, id: validateStableId(definition.id, 'catalog.id')};
    }
    const manifest = registry.get(definition.manifestId);
    const {manifestId, ...presentation} = definition;
    const forbidden = ['id', 'name', 'href', 'internal'];
    for (const key of forbidden) {
      if (Object.prototype.hasOwnProperty.call(presentation, key)) {
        throw manifestError('ECATALOGOVERRIDE', `Catalog may not override manifest ${key}.`, key);
      }
    }
    return {
      ...presentation,
      id: manifest.id,
      name: manifest.name,
      ...navigationFor(manifest),
      manifest,
    };
  });
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw manifestError('EDUPLICATECATALOGID', `Duplicate catalog ID ${entry.id}.`, 'id');
    }
    ids.add(entry.id);
  }
  return entries;
}

export {createCatalogEntries, navigationFor};
