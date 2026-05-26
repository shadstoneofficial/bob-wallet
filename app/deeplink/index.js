import { setDeeplink } from '../ducks/app';
import { clientStub as aClientStub } from '../background/analytics/client';
const analytics = aClientStub(() => require('electron').ipcRenderer);
import { store } from '../store/configureStore';
import * as methods from './methods';
import traceDeeplink from '../utils/deeplinkTrace';

export default function handleDeeplink(message) {
  const url = new URL(message);
  const state = store.getState();
  const isLocked = state.wallet.isLocked;

  analytics.track('deeplink', {
    pathname: url.pathname,
  });

  const method = getDeeplinkMethod(url);
  const handler = methods[method];
  traceDeeplink('renderer-handle-deeplink', {
    url: message,
    method,
    isLocked,
    hasHandler: typeof handler === 'function',
  });

  if (typeof handler === 'function') {
    if (isLocked && method !== 'fulfillauction') {
      traceDeeplink('renderer-store-pending-deeplink', {url: message, method});
      store.dispatch(setDeeplink(message));
      return;
    }

    methods[method](message);
  } else {
    console.error('Unknown deeplink:', message);
  }
}

export function getDeeplinkMethod(url) {
  const href = url.href || String(url);
  const pathish = href
    .replace(/^[a-z][a-z0-9+.-]*:/i, '')
    .split(/[?#]/)[0]
    .replace(/^\/+/, '');
  const parts = pathish.split('/').filter(Boolean);

  if (parts[0] === 'x' && parts[1]) {
    return parts[1].toLowerCase();
  }

  if (parts[0]) {
    return parts[0].toLowerCase();
  }

  const pathnameMethod = url.pathname.replace(/^\/+/, '').split('/')[0];
  return pathnameMethod.toLowerCase();
}
