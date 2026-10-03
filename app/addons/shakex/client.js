export const SHAKEX_ORIGIN = 'https://shakex.fun';

const units = new Set(['HNS', 'USD', 'EUR', 'BTC', 'ETH']);

export function parseListings(payload) {
  if (!payload || !Array.isArray(payload.listings)) {
    throw new Error('ShakeX returned an invalid listing response.');
  }
  const seen = new Set();
  return payload.listings.slice(0, 5000).filter(item => {
    if (!item || typeof item.name !== 'string' ||
        !/^[a-z0-9_-]{1,63}$/.test(item.name) || seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  }).map(item => ({
    name: item.name,
    prices: (Array.isArray(item.prices) ? item.prices : []).filter(price =>
      price && units.has(price.unit) && typeof price.amount === 'string' &&
      /^\d{1,20}(\.\d{1,18})?$/.test(price.amount)).slice(0, 5),
    contacts: (Array.isArray(item.contacts) ? item.contacts : []).filter(contact =>
      contact && ['uri', 'text'].includes(contact.type) &&
      typeof contact.value === 'string' && contact.value.length <= 2048
    ).slice(0, 10).map(contact => contact.value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')),
    verifiedAt: typeof item.verifiedAt === 'string' && Number.isFinite(Date.parse(item.verifiedAt))
      ? new Date(item.verifiedAt).toISOString() : null,
  }));
}

export async function fetchListings(signal) {
  const response = await fetch(`${SHAKEX_ORIGIN}/api/listings`, {
    signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    throw new Error(response.status === 429
      ? 'ShakeX is rate limiting requests. Please try again later.'
      : 'ShakeX is unavailable. Please try again later.');
  }
  const body = await response.text();
  if (body.length > 2 * 1024 * 1024) throw new Error('ShakeX returned too much data.');
  return parseListings(JSON.parse(body));
}
