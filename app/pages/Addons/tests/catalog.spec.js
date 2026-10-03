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

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Addons} from '../index';
import {I18nContext, translateLocale} from '../../../utils/i18n';
import ru from '../../../../locales/ru-RU.json';
import th from '../../../../locales/th-TH.json';

class CatalogFixture extends Addons {
  constructor(props) {
    super(props);
    this.state = {...this.state, pendingExternalAddon: ADDONS.find(a => a.id === 'liquidity-spot'),
      liquiditySpotChannelError: 'addonLiquidityChannelInvalid'};
  }
}
test('catalog presentation is localized without changing manifests or navigation', t => {
  for (const [locale, strings] of [['en-US', en], ['zh-CN', zh], ['ru-RU', ru], ['th-TH', th]]) {
    const tr = (key, ...args) => translateLocale(locale, null, key, ...args);
    const html = renderToStaticMarkup(<I18nContext.Provider value={{t: tr}}>
      <CatalogFixture location={{pathname: '/addons'}} history={{push: () => t.fail('must not navigate')}} deeplinkParams={{}} />
    </I18nContext.Provider>);
    for (const addon of ADDONS) {
      for (const key of [addon.nameKey, addon.statusKey, addon.actionKey, addon.externalNoticeKey, ...(addon.detailKeys || [])].filter(Boolean)) {
        t.ok(strings[key], `${locale}: ${key} exists`);
        t.ok(html.includes(strings[key]), `${key} renders`);
      }
      if (addon.manifest) {
        t.equal(addon.name, addon.manifest.name, 'localized name never overwrites manifest identity');
        t.equal(addon.manifest, builtInAddonRegistry.get(addon.id));
      }
    }
    t.ok(html.includes(tr('addonLiquidityChannelDescription', 'liquidity.spot')), 'host appears in translated description');
    t.ok(html.includes(strings.addonLiquidityChannelInvalid), 'validation error translates at render time');
    t.ok(html.includes(strings.addonExternalTitle));
    if (locale !== 'en-US') for (const literal of ['Open External Add On?', 'Public Preview', 'Add/Save', 'Guest P2P:']) t.notOk(html.includes(literal), `no English catalog leak: ${literal}`);
  }
  const page = new Addons({location: {pathname: '/addons'}, history: {push: () => t.fail('external link must await confirmation')}});
  page.setState = value => {page.state = {...page.state, ...value};};
  page.state.liquiditySpotDraftHost = '';
  page.saveLiquiditySpotChannel();
  t.equal(page.state.liquiditySpotChannelError, 'addonLiquidityChannelInvalid', 'invalid host never reaches service');
  const addon = ADDONS.find(a => a.id === 'liquidity-spot');
  page.openAddon(addon);
  t.equal(page.state.pendingExternalAddon, addon, 'opening external catalog only stages confirmation');
  page.cancelExternalAddon();
  t.equal(page.state.pendingExternalAddon, null, 'cancel clears pending external request');
  t.end();
});
