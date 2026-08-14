import test from 'tape';

import { selectAliasResolverPort } from '../port';

test('alias resolver follows the active recursive DNS port by default', t => {
  t.equal(
    selectAliasResolverPort(null, 10892),
    10892,
    'Bob LearnHNS uses its offset recursive resolver port',
  );
  t.equal(
    selectAliasResolverPort(null, 9892),
    9892,
    'upstream Bob keeps its normal recursive resolver port',
  );
  t.end();
});

test('alias resolver preserves an explicitly configured custom port', t => {
  t.equal(selectAliasResolverPort(5353, 10892), 5353);
  t.end();
});
