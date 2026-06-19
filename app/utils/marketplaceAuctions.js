export function isPendingMarketplaceAuction(auction) {
  return Boolean(auction?.pending || auction?.buyable === false || auction?.status === 'pending');
}

function normalizeMarketplaceAuctionName(auction) {
  return `${auction?.name || ''}`.trim().toLowerCase().replace(/\/+$/, '');
}

export function dedupeMarketplaceAuctionsByName(auctions = []) {
  const rows = [];
  const indexByName = new Map();

  auctions.forEach((auction) => {
    const name = normalizeMarketplaceAuctionName(auction);
    if (!name) {
      rows.push(auction);
      return;
    }

    if (!indexByName.has(name)) {
      indexByName.set(name, rows.length);
      rows.push(auction);
      return;
    }

    const existingIndex = indexByName.get(name);
    const existing = rows[existingIndex];
    const existingIsPending = isPendingMarketplaceAuction(existing);
    const incomingIsPending = isPendingMarketplaceAuction(auction);

    if (existingIsPending && !incomingIsPending) {
      rows[existingIndex] = auction;
    }
  });

  return rows;
}
