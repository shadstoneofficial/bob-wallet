export const DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST = 'liquidity.spot';
export const LIQUIDITY_SPOT_CHANNEL_STORAGE_KEY = 'bob:liquiditySpotChannelHost';
export const LIQUIDITY_SPOT_CHANNEL_LIST_STORAGE_KEY = 'bob:liquiditySpotChannels';

export const LIQUIDITY_SPOT_CHANNELS = [
  {
    id: 'liquidity-spot',
    label: 'Liquidity Spot',
    host: DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST,
    path: '/p2p',
  },
];

export function normalizeLiquiditySpotHost(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.host.toLowerCase();
  } catch (e) {
    return '';
  }
}

export function getLiquiditySpotChannelUrl(host, path = '/p2p') {
  const normalizedHost = normalizeLiquiditySpotHost(host) || DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://${normalizedHost}${normalizedPath}`;
}

export function normalizeLiquiditySpotChannels(channels = []) {
  const seen = new Set();
  return channels
    .map(channel => {
      const host = normalizeLiquiditySpotHost(channel?.host || channel);
      if (!host || seen.has(host)) {
        return null;
      }

      seen.add(host);
      return {
        id: channel?.id || host,
        label: channel?.label || host,
        host,
        path: channel?.path || '/p2p',
      };
    })
    .filter(Boolean);
}

export function mergeLiquiditySpotChannels(channels = []) {
  return normalizeLiquiditySpotChannels([
    ...LIQUIDITY_SPOT_CHANNELS,
    ...channels,
  ]);
}
