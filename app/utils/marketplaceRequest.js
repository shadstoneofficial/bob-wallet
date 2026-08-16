import { dedupeMarketplaceAuctionsByName } from './marketplaceAuctions';

export const MARKETPLACE_REQUEST_TIMEOUT_MS = 20 * 1000;
export const MARKETPLACE_PAGE_SIZE = 20;

export const MARKETPLACE_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  LOADED: 'loaded',
  TIMEOUT: 'timeout',
  ERROR: 'error',
};

export function getMarketplaceClientOptions(host) {
  return {
    host,
    ssl: true,
    timeout: MARKETPLACE_REQUEST_TIMEOUT_MS,
  };
}

export function normalizeMarketplacePage(value) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function normalizeMarketplaceAvailability(value) {
  return ['available', 'pending', 'all'].includes(value) ? value : 'available';
}

export function getMarketplaceAuctionsPath(
  page = 1,
  perPage = MARKETPLACE_PAGE_SIZE,
  availability = 'available',
) {
  const safePage = normalizeMarketplacePage(page);
  const safePerPage = Number.isSafeInteger(perPage) && perPage > 0
    ? perPage
    : MARKETPLACE_PAGE_SIZE;
  const safeAvailability = normalizeMarketplaceAvailability(availability);
  return `api/v2/auctions?page=${safePage}&per_page=${safePerPage}&availability=${safeAvailability}`;
}

export function normalizeMarketplaceResponse(response = {}) {
  const rows = Array.isArray(response.auctions) ? response.auctions : [];
  const auctions = dedupeMarketplaceAuctionsByName(rows).map(auction => ({
    ...auction,
    bids: [...(Array.isArray(auction.bids) ? auction.bids : [])]
      .sort((a, b) => b.price - a.price),
  }));
  const reportedTotal = Number(response.total);

  return {
    auctions,
    total: Number.isSafeInteger(reportedTotal) && reportedTotal >= 0
      ? reportedTotal
      : auctions.length,
  };
}

export async function fetchMarketplaceAuctions(client, page = 1, availability = 'available') {
  const response = await client.get(getMarketplaceAuctionsPath(page, MARKETPLACE_PAGE_SIZE, availability));
  return normalizeMarketplaceResponse(response);
}

export function classifyMarketplaceError(error) {
  const message = `${error && error.message || ''}`.trim();
  const code = error && error.code;
  const isTimeout = code === 'MARKETPLACE_TIMEOUT'
    || code === 'ETIMEDOUT'
    || /timed?\s*out|timeout/i.test(message);

  return {
    kind: isTimeout ? MARKETPLACE_STATUS.TIMEOUT : MARKETPLACE_STATUS.ERROR,
    message: message || 'The Shakedex marketplace request failed.',
  };
}

export function getMarketplaceViewState(status, rowCount) {
  const hasRows = rowCount > 0;
  return {
    hasRows,
    showInitialLoading: status === MARKETPLACE_STATUS.LOADING && !hasRows,
    showRefreshing: status === MARKETPLACE_STATUS.LOADING && hasRows,
    showEmpty: status === MARKETPLACE_STATUS.LOADED && !hasRows,
    showError: status === MARKETPLACE_STATUS.TIMEOUT || status === MARKETPLACE_STATUS.ERROR,
  };
}
