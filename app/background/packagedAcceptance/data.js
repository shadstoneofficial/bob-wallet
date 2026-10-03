const FIXED_RESOURCE = {records: [
  {type: 'NS', ns: 'ns1.example.'},
  {type: 'TXT', txt: ['x:acceptance-preserve']},
  {type: 'DS', keyTag: 1, algorithm: 13, digestType: 2, digest: 'ab'.repeat(32)},
  {type: 'TXT', txt: ['v=FORSALE1;ftxt=old fixture contact']},
]};

const FIXED_LISTINGS = {listings: [
  {name: 'fixture-sale-one', prices: [{amount: '1', unit: 'HNS'}],
    contacts: [{type: 'text', value: 'Disposable fixture contact'}], verifiedAt: '2026-10-03T00:00:00Z'},
  {name: 'fixture-sale-two', prices: [], contacts: [{type: 'text', value: 'Second fixture contact'}]},
]};

module.exports = {FIXED_RESOURCE, FIXED_LISTINGS};
