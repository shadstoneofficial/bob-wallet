const test = require('tape');
const {
  buildRevealActions,
  isAwaitingReveal,
  MAX_REVEAL_NAMES_PER_TRANSACTION,
} = require('../revealBatch');

test('selected reveals are deduplicated without being silently truncated', t => {
  t.deepEqual(
    buildRevealActions(['alpha', 'beta', 'alpha']),
    [['REVEAL', 'alpha'], ['REVEAL', 'beta']],
  );

  const tooMany = Array.from(
    {length: MAX_REVEAL_NAMES_PER_TRANSACTION + 1},
    (_, index) => `name-${index}`,
  );
  t.throws(
    () => buildRevealActions(tooMany),
    new RegExp(`no more than ${MAX_REVEAL_NAMES_PER_TRANSACTION}`, 'i'),
    'fails before creating a partial reveal batch',
  );
  t.end();
});

test('awaiting reveal requires an unspent own bid from the current auction', t => {
  const current = {
    state: 'REVEAL',
    own: true,
    hasUnspentBid: true,
    bidHeight: 200,
    auctionHeight: 200,
  };

  t.equal(isAwaitingReveal(current), true, 'includes a current unrevealed bid');
  t.equal(
    isAwaitingReveal({...current, bidHeight: 199}),
    false,
    'excludes a bid from an earlier auction',
  );
  t.equal(
    isAwaitingReveal({...current, hasUnspentBid: false}),
    false,
    'excludes an already revealed bid',
  );
  t.equal(
    isAwaitingReveal({...current, own: false}),
    false,
    'excludes another wallet\'s bid',
  );
  t.end();
});
