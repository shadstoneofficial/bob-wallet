const test = require('tape');
const {
  nameOwnershipStatus,
  nameStateSnapshot,
  states,
} = require('../nameSnapshot');

test('HNS Investments bridge does not call a current reveal leader owned', t => {
  t.equal(
    nameOwnershipStatus({registered: false}, states.REVEAL),
    'auction-reveal-leading',
    'a later reveal can still overtake the current leader'
  );
  t.end();
});

test('HNS Investments bridge distinguishes a closed winner awaiting registration', t => {
  t.equal(
    nameOwnershipStatus({registered: false}, states.CLOSED),
    'auction-won-registration-pending'
  );
  t.end();
});

test('HNS Investments bridge calls only registered closed names owned', t => {
  t.equal(nameOwnershipStatus({registered: true}, states.CLOSED), 'owned');
  t.equal(
    nameOwnershipStatus({registered: true, transfer: 42}, states.CLOSED),
    'transfer-pending-or-history'
  );
  t.end();
});

test('HNS Investments bridge marks reveal ownership as non-final', t => {
  const domain = {
    registered: false,
    state(height, network) {
      t.equal(height, 343944, 'uses the current wallet height');
      t.equal(network.type, 'main', 'uses the wallet network');
      return states.REVEAL;
    },
  };

  t.deepEqual(nameStateSnapshot(domain, 343944, {type: 'main'}), {
    auctionState: 'reveal',
    status: 'auction-reveal-leading',
    ownershipFinal: false,
  });
  t.end();
});
