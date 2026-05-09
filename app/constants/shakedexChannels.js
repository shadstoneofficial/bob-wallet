export const DEFAULT_SHAKEDEX_CHANNEL_HOST = 'market.learnhns.com';

export const ACTIVE_SHAKEDEX_CHANNEL = {
  id: 'learnhns',
  label: 'LearnHNS',
  host: process.env.LEARNHNS_MARKET_API_HOST || DEFAULT_SHAKEDEX_CHANNEL_HOST,
};

export function getShakedexChannelBaseUrl(channel = ACTIVE_SHAKEDEX_CHANNEL) {
  return `https://${channel.host}`;
}
