const {publicStatus, resolverError} = require('./contract');

const ADDON_METHODS = Object.freeze([
  'resolver.getStatus',
  'resolver.requestEnable',
  'resolver.requestDisable',
  'resolver.requestTest',
]);

function createAddonResolverContract({controller, requestCoreConfirmation}) {
  if (!controller || typeof requestCoreConfirmation !== 'function') {
    throw new TypeError('The add-on resolver contract requires core-owned controls.');
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

    const action = method === 'resolver.requestEnable' ? 'enable' : 'disable';
    const approved = await requestCoreConfirmation({
      action,
      title: action === 'enable'
        ? 'Use Bob for this computer\'s DNS?'
        : 'Restore this computer\'s previous DNS settings?',
    });
    if (approved !== true) {
      return {approved: false, status: publicStatus(controller.getStatus())};
    }

    const result = action === 'enable'
      ? await controller.enable()
      : await controller.disable();
    return {approved: true, status: publicStatus(result)};
  };
}

module.exports = {ADDON_METHODS, createAddonResolverContract};

