import test from 'tape';
import {reviewText, reviewDate} from '../reviewText';
import {buildSaleReview} from '../../addons/shakex/records';
import zh from '../../../locales/zh-CN.json';

test('review localization interpolates external data literally in one pass', t => {
  t.equal(reviewText(() => '%s then %s', 'test', '$& %s', "$` $'"), "$& %s then $` $'");
  t.equal(reviewText(key => key, 'shakexResourceBytes', 123), '123 / 512 bytes');
  t.equal(reviewText(key => zh[key], 'shakexResourceBytes', 123), '123 / 512 字节');
  t.equal(reviewText(key => zh[key], 'shakexListingCountMany', 2), zh.shakexListingCountMany.replace('%s', '2'));
  t.equal(reviewDate('2026-10-02T00:00:00Z', 'zh-CN'), new Date('2026-10-02T00:00:00Z').toLocaleString('zh-CN'));
  t.doesNotThrow(() => reviewDate('2026-10-02T00:00:00Z', 'custom'));
  t.end();
});

test('localized sale validation preserves wire records and exact amounts', t => {
  const options = {price: '123.000001', contact: 'X @alice $& %s'};
  const en = buildSaleReview('00', options);
  const cn = buildSaleReview('00', options, key => zh[key]);
  t.deepEqual(cn, en, 'locale cannot change the transaction proposal');
  t.throws(() => buildSaleReview('00', {...options, price: '1.0000001'}, key => zh[key]), new RegExp(zh.shakexInvalidPrice));
  t.throws(() => buildSaleReview('00', {remove: true}, key => zh[key]), new RegExp(zh.shakexNoSaleRecords));
  t.end();
});
