export function toSafeFilenamePart(value, fallback = 'wallet') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

export function walletFileLabel(walletId, walletsDetails = {}) {
  const displayName = walletsDetails?.[walletId]?.displayName;
  return toSafeFilenamePart(displayName || walletId || 'wallet');
}
