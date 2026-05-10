export const DEFAULT_LIQUIDITY_SPOT_CHANNEL_HOST = 'liquidity.spot';

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
