const {publicStatus, resolverError} = require('./contract');

const ADDON_METHODS = Object.freeze([
  'resolver.getStatus',
  'resolver.requestTest',
]);

function createAddonResolverContract({controller}) {
  if (!controller) {
    throw new TypeError('The add-on resolver contract requires a trusted core controller.');
  }

  return async function request(method) {
    if (!ADDON_METHODS.includes(method)) {
      throw resolverError('EADDONMETHOD', 'This resolver add-on method is not available.');
    }

    if (method === 'resolver.getStatus') {
      return publicStatus(controller.getStatus());
    }

    if (method === 'resolver.requestTest') {
      return publicStatus(await controller.preflight());
    }

    throw resolverError('EADDONMETHOD', 'This resolver add-on method is not available.');
  };
}

module.exports = {ADDON_METHODS, createAddonResolverContract};
