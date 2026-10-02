import {manifestError, validateManifest} from './schema';

const registryData = new WeakMap();

class AddonRegistry {
  constructor(manifests = []) {
    if (!Array.isArray(manifests)) {
      throw manifestError('EREGISTRY', 'Add-On registry input must be an array.');
    }
    const manifestsById = new Map();
    for (const candidate of manifests) {
      const manifest = validateManifest(candidate);
      if (manifestsById.has(manifest.id)) {
        throw manifestError('EDUPLICATEID', `Duplicate Add-On ID ${manifest.id}.`, 'id');
      }
      manifestsById.set(manifest.id, manifest);
    }
    registryData.set(this, manifestsById);
    Object.freeze(this);
  }

  has(id) {
    return registryData.get(this).has(id);
  }

  get(id) {
    const manifest = registryData.get(this).get(id);
    if (!manifest) {
      throw manifestError('EADDONNOTFOUND', `Unknown Add-On ID ${id}.`, 'id');
    }
    return manifest;
  }

  list() {
    return [...registryData.get(this).values()];
  }
}

export {AddonRegistry};
