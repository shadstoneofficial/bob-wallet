export const DEFAULT_SPV_HELPER_API_BASE_URL =
  'https://spv.learnhns.com/hsd';

export const LEGACY_DEFAULT_SPV_HELPER_API_BASE_URL =
  'https://api.handshakeapi.com/hsd';

export function normalizeSpvHelperApiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw)
    return DEFAULT_SPV_HELPER_API_BASE_URL;

  const withProtocol = raw.includes('://') ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  return url.href.replace(/\/+$/, '');
}

/**
 * Carry installations that persisted Bob's retired default to the LearnHNS
 * endpoint. Any genuinely custom helper remains unchanged.
 */
export function resolveStoredSpvHelperApiBaseUrl(value) {
  const normalized = normalizeSpvHelperApiBaseUrl(value);
  if (normalized === LEGACY_DEFAULT_SPV_HELPER_API_BASE_URL)
    return DEFAULT_SPV_HELPER_API_BASE_URL;
  return normalized;
}
