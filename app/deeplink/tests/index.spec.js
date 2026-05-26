import test from 'tape';
import { getDeeplinkMethod } from '../index';

test('deeplink method parser handles LearnHNS Shakedex buy links', (t) => {
  t.equal(
    getDeeplinkMethod(new URL('bob-learnhns://x/fulfillauction?name=horizonx')),
    'fulfillauction',
  );
  t.equal(
    getDeeplinkMethod({href: 'bob-learnhns://x/fulfillauction?name=horizonx', pathname: '//x/fulfillauction'}),
    'fulfillauction',
  );
  t.end();
});
