import { setDeeplink } from '../ducks/app';
import { clientStub as aClientStub } from '../background/analytics/client';
const analytics = aClientStub(() => require('electron').ipcRenderer);
import { store } from '../store/configureStore';
import * as methods from './methods';

export default function handleDeeplink(message) {
  const url = new URL(message);
  const state = store.getState();
  const isLocked = state.wallet.isLocked;

  analytics.track('deeplink', {
    pathname: url.pathname,
  });

  const method = getDeeplinkMethod(url);
  const handler = methods[method];

  if (typeof handler === 'function') {
    if (isLocked) {
      store.dispatch(setDeeplink(message));
      return;
    }

    methods[method](message);
  } else {
    console.error('Unknown deeplink:', message);
  }
}

function getDeeplinkMethod(url) {
  const pathnameMethod = url.pathname.replace(/^\/+/, '').split('/')[0];

  if (url.hostname === 'x' && pathnameMethod) {
    return pathnameMethod.toLowerCase();
  }

  // Legacy Bob links encoded the method with a leading double slash in the
  // path, which produced a pathname like "//fulfillauction".
  return url.pathname.substr(2).split('/')[0].toLowerCase();
}
