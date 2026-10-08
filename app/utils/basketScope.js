import {verifyName} from 'hsd/lib/covenants/rules';

export function basketScopeError(message) {
  const error = new Error(`${message} No transaction was sent. Review the complete basket again.`);
  error.code = 'BASKET_SCOPE_CHANGED';
  return error;
}

// Base units only. Never compare formatted/rounded HNS amounts at this boundary.
export function basketScope(entries, fee = null) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20) {
    throw basketScopeError('The basket must contain 1 to 20 bids.');
  }
  const seen = new Set();
  const rows = entries.map(entry => {
    const {name} = entry;
    const bid = Number(entry.bid);
    const lockup = Number(entry.lockup);
    if (!verifyName(name) || seen.has(name)
        || !Number.isSafeInteger(bid) || bid < 0
        || !Number.isSafeInteger(lockup) || lockup <= 0 || lockup < bid) {
      throw basketScopeError('A basket name or amount is invalid.');
    }
    seen.add(name);
    return {name, bid, blind: lockup - bid, lockup};
  });
  if (fee !== null && (!Number.isSafeInteger(fee) || fee < 0)) {
    throw basketScopeError('The exact transaction fee is unavailable.');
  }
  const totalBid = rows.reduce((sum, row) => sum + row.bid, 0);
  const totalLockup = rows.reduce((sum, row) => sum + row.lockup, 0);
  if (!Number.isSafeInteger(totalLockup + (fee || 0))) {
    throw basketScopeError('The basket total is invalid.');
  }
  return {rows, totalBid, totalBlind: totalLockup - totalBid, totalLockup, fee, transactionCount: 1};
}

export function assertBasketScope(actual, expected) {
  if (!actual || !expected || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw basketScopeError('The names, amounts, fee or transaction count changed.');
  }
}

export function assertBasketEligibility(name, result) {
  if (result?.info?.state !== 'BIDDING') {
    throw basketScopeError(`${name}/ is ${result?.info?.state || 'unavailable'}, not bidding.`);
  }
  if (result.info.stats?.blocksUntilReveal <= 1) {
    throw basketScopeError(`${name}/ reaches reveal before the next block can include this bid.`);
  }
}
