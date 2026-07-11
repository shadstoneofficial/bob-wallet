const MAX_EXTERNAL_URL_LENGTH = 2048;
const MAX_LIQUIDITY_INTENT_URL_LENGTH = 4096;
const LIQUIDITY_INTENT_PATH = /^\/api\/swaps\/\d+\/wallet-intents\/?$/;

export function parseSafeHttpsUrl(value, {maxLength = MAX_EXTERNAL_URL_LENGTH} = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      return null;
    }
    return url;
  } catch (e) {
    return null;
  }
}

export function getSafeExternalUrl(value) {
  const url = parseSafeHttpsUrl(value);
  return url ? url.href : null;
}

export function getSafeLiquidityIntentUrl(value, allowedHosts = ['liquidity.spot']) {
  const url = parseSafeHttpsUrl(value, {maxLength: MAX_LIQUIDITY_INTENT_URL_LENGTH});
  if (!url || !LIQUIDITY_INTENT_PATH.test(url.pathname)) {
    return null;
  }

  const hosts = new Set(allowedHosts.map(host => String(host).toLowerCase()));
  if (!hosts.has(url.host.toLowerCase())) {
    return null;
  }

  return url.href;
}

export function getLiquiditySwapRoomUrl(intentUrl, allowedHosts = ['liquidity.spot']) {
  const safeIntentUrl = getSafeLiquidityIntentUrl(intentUrl, allowedHosts);
  if (!safeIntentUrl) {
    return null;
  }

  const url = new URL(safeIntentUrl);
  const match = url.pathname.match(/^\/api\/swaps\/(\d+)\/wallet-intents\/?$/);
  return `${url.origin}/swaps/${match[1]}`;
}
