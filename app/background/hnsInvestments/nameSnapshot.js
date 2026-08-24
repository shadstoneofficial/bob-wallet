const NameState = require('hsd/lib/covenants/namestate');

const {states, statesByVal} = NameState;

export function nameOwnershipStatus(domain, auctionState) {
  if (domain.expired) return 'expired';
  if (domain.revoked || auctionState === states.REVOKED) return 'revoked';

  if (auctionState === states.REVEAL)
    return 'auction-reveal-leading';

  if (auctionState === states.CLOSED && !domain.registered)
    return 'auction-won-registration-pending';

  if (auctionState < states.CLOSED)
    return `auction-${String(statesByVal[auctionState] || 'pending').toLowerCase()}`;

  if (domain.transfer)
    return 'transfer-pending-or-history';

  return domain.registered ? 'owned' : 'auction-pending';
}

export function nameStateSnapshot(domain, height, network) {
  const auctionState = domain.state(height, network);
  const status = nameOwnershipStatus(domain, auctionState);

  return {
    auctionState: String(statesByVal[auctionState] || 'UNKNOWN').toLowerCase(),
    status,
    ownershipFinal: !!domain.registered
      && !domain.expired
      && !domain.revoked
      && auctionState === states.CLOSED,
  };
}

export {states};
