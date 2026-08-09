import {consensus} from 'hsd/lib/protocol';

export const MAX_REVEAL_NAMES_PER_TRANSACTION =
  consensus.MAX_BLOCK_RENEWALS / 6;

/**
 * Build one atomic REVEAL batch. Never truncate the caller's selection: a
 * partial reveal presented as complete is more dangerous than refusing it.
 */
export function buildRevealActions(names) {
  if (!Array.isArray(names))
    throw new Error('Nothing to do.');

  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (!uniqueNames.length)
    throw new Error('Nothing to do.');

  if (uniqueNames.length > MAX_REVEAL_NAMES_PER_TRANSACTION) {
    throw new Error(
      `Select no more than ${MAX_REVEAL_NAMES_PER_TRANSACTION} names per reveal transaction. ` +
      'No reveal transaction was created.'
    );
  }

  return uniqueNames.map(name => ['REVEAL', name]);
}

/**
 * An unspent own bid is actionable only when it belongs to the name's current
 * auction. Old missed bids must not reappear when a name is auctioned again.
 */
export function isAwaitingReveal({
  state,
  own,
  hasUnspentBid,
  bidHeight,
  auctionHeight,
}) {
  return state === 'REVEAL'
    && own === true
    && hasUnspentBid === true
    && Number.isInteger(bidHeight)
    && Number.isInteger(auctionHeight)
    && bidHeight >= auctionHeight;
}
