import test from 'tape';

import nodeReducer, {START} from '../nodeReducer';

test('node start publishes the active DNS ports to settings', t => {
  const state = nodeReducer(undefined, {
    type: START,
    payload: {
      network: 'main',
      apiKey: 'test',
      noDns: false,
      nsPort: 10891,
      rsPort: 10892,
    },
  });

  t.equal(state.nsPort, 10891, 'shows the running LearnHNS root port');
  t.equal(state.rsPort, 10892, 'shows the running LearnHNS recursive port');
  t.end();
});

test('node start remains compatible when port metadata is absent', t => {
  const state = nodeReducer(undefined, {
    type: START,
    payload: {
      network: 'main',
      apiKey: 'test',
      noDns: false,
    },
  });

  t.equal(state.nsPort, 9891);
  t.equal(state.rsPort, 9892);
  t.end();
});
