import test from 'tape';
import {ADDONS} from '../index';
import {builtInAddonRegistry} from '../../../addons/manifests';
import {SHAKEX_ORIGIN} from '../../../addons/shakex/client';
import {reviewText} from '../../../utils/reviewText';
import en from '../../../../locales/en.json';
import zh from '../../../../locales/zh-CN.json';

test('Add Ons catalog registers ShakeX and preserves navigation and localized presentation', t => {
  const shakex = ADDONS.find(addon => addon.id === 'shakex');
  t.ok(shakex, 'stable ShakeX ID is in the actual catalog');
  t.equal(shakex.manifest, builtInAddonRegistry.get('shakex'));
  t.equal(shakex.href, '/addons/shakex');
  t.equal(shakex.internal, true);
  t.deepEqual(shakex.manifest.origins, [SHAKEX_ORIGIN]);
  t.equal(new Set(ADDONS.map(addon => addon.id)).size, ADDONS.length, 'catalog IDs remain unique');
  for (const [id, href] of [
    ['shakedex-marketplace', '/exchange'],
    ['send-name', '/send?asset=name&mode=send'],
    ['liquidity-spot', 'https://liquidity.spot/p2p'],
  ]) t.equal(ADDONS.find(addon => addon.id === id).href, href);
  for (const field of ['description', 'status', 'action']) {
    const key = shakex[`${field}Key`];
    t.equal(reviewText(k => en[k], key), en[key]);
    t.equal(reviewText(k => zh[k], key), zh[key]);
  }
  t.end();
});
