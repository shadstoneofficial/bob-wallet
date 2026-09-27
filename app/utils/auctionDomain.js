function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject);
}

export function normalizeAuctionDomain(domain) {
  if (!isObject(domain)) return domain;

  const metaIsObject = isObject(domain.pendingOperationMeta);
  const expectsPendingMeta = domain.pendingOperation != null || domain.pendingOperationMeta != null;
  const meta = metaIsObject ? domain.pendingOperationMeta : {};
  const bids = normalizeArray(domain.bids);
  const reveals = normalizeArray(domain.reveals);
  const pendingBids = normalizeArray(meta.bids);
  const operations = normalizeArray(meta.operations);
  const malformed = (
    !Array.isArray(domain.bids)
    || !Array.isArray(domain.reveals)
    || (expectsPendingMeta && !metaIsObject)
    || (expectsPendingMeta && !Array.isArray(meta.bids))
    || (expectsPendingMeta && !Array.isArray(meta.operations))
    || bids.length !== domain.bids.length
    || reveals.length !== domain.reveals.length
    || (Array.isArray(meta.bids) && pendingBids.length !== meta.bids.length)
    || (Array.isArray(meta.operations) && operations.length !== meta.operations.length)
  );

  return {
    ...domain,
    bids,
    reveals,
    pendingOperationMeta: {
      ...meta,
      bids: pendingBids,
      operations,
    },
    pendingMetadataMalformed: !!domain.pendingMetadataMalformed || malformed,
  };
}

export function hasPendingMetadataWarning(domain, warning) {
  if (domain?.pendingMetadataMalformed) return true;
  if (!warning) return false;
  if (warning.general) return true;
  return !!domain?.hash && Array.isArray(warning.hashes) && warning.hashes.includes(domain.hash);
}

export function hasPendingBids(domain) {
  return Array.isArray(domain?.pendingOperationMeta?.bids)
    && domain.pendingOperationMeta.bids.length > 0;
}
