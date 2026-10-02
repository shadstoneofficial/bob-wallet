import test from 'tape';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuctionBasket} from '../index';
import {I18nContext} from '../../../utils/i18n';
import zh from '../../../../locales/zh-CN.json';

const translate = (key, ...values) => {
  let text = zh[key];
  for (const value of values) text = text.replace('%s', value);
  return text;
};
const blocked = () => { throw new Error('No wallet actions permitted in locale fixture'); };
const props = {
  order: ['fixture'], items: {fixture: {bidAmount: '10', blindAmount: '5'}},
  spendableBalance: 100000000, network: 'regtest', walletType: 'standard',
  names: {}, watchingNames: [], history: {push: blocked},
  addNamesToBasket: blocked, removeFromBasket: blocked, updateBasketItem: blocked,
  clearBasket: blocked, importBasketRows: blocked, sendBidMany: blocked,
  showError: blocked, showSuccess: blocked,
};
function renderState(fixtureState) {
  class Fixture extends AuctionBasket {
    constructor(p) {
      super(p);
      this.state = {
        ...this.state, step: 'review', accepted: true,
        rowMeta: {fixture: {state: 'BIDDING', hoursUntilReveal: 12}},
        ...fixtureState,
      };
    }
  }
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(
    <I18nContext.Provider value={{t: translate}}><Fixture {...props} /></I18nContext.Provider>,
  );
  return element;
}

test('Chinese basket distinguishes local construction/signing from broadcast and locks retry', t => {
  for (const [phase, phrase] of [
    ['building', '正在构建交易 — 尚未发送交易。'],
    ['signing', '正在签名交易 — 尚未发送交易。'],
    ['broadcasting', '正在广播竞价篮交易…'],
    ['verifying', '正在核验交易…'],
  ]) {
    const view = renderState({submissionPhase: phase});
    t.ok(view.textContent.includes(phrase), `${phase} uses the Chinese safety message`);
    const buttons = view.querySelectorAll('.auction-basket__footer-actions button');
    t.equal(buttons[1].disabled, true, `${phase} cannot submit again`);
    t.equal(buttons[0].disabled, ['broadcasting', 'verifying'].includes(phase), `${phase} preserves back/stop rules`);
  }
  t.end();
});

test('uncertain Chinese broadcast warning never promises that no transaction was sent', t => {
  const view = renderState({
    submissionPhase: 'failed', submissionFailedStage: 'broadcasting',
    broadcastUncertain: true, retryAllowed: false,
  });
  t.ok(view.textContent.includes('提交在广播阶段失败。'));
  t.ok(view.textContent.includes('钱包记录无法证明交易尚未发送。'));
  t.notOk(view.textContent.includes('可以安全重试。'));
  t.equal(view.querySelectorAll('.auction-basket__footer-actions button')[1].disabled, true);
  t.end();
});

test('a proven pre-broadcast failure retains its safe retry message in Chinese', t => {
  const view = renderState({
    submissionPhase: 'failed', submissionFailedStage: 'signing',
    broadcastUncertain: false, retryAllowed: true,
  });
  t.ok(view.textContent.includes('提交在签名阶段失败。'));
  t.ok(view.textContent.includes('所有竞价篮条目均已保存，可以安全重试。'));
  const retry = view.querySelectorAll('.auction-basket__footer-actions button')[1];
  t.equal(retry.textContent, '重试提交');
  t.equal(retry.disabled, false);
  t.end();
});
