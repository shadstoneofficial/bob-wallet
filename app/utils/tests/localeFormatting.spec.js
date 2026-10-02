import test from 'tape';
import zh from '../../../locales/zh-CN.json';
import {parseCompleteBasket} from '../auctionBasketData';
import {hoursToNow} from '../timeConverter';

const translate = (key, ...values) => {
  let text = zh[key];
  for (const value of values) text = text.replace('%s', value);
  return text;
};

test('localized basket import preserves accepted amounts and rejection decisions', t => {
  const csv = 'name,true_bid,blind\nfixture,1.000001,2\nnegative,-1,2\nprecision,1.0000001,2\nzero,0,0\ndup,1,2\ndup,3,4';
  const en = parseCompleteBasket(csv);
  const cn = parseCompleteBasket(csv, 20, translate);
  t.deepEqual(cn.map(({errors, ...row}) => row), en.map(({errors, ...row}) => row));
  t.deepEqual(cn.map(row => row.errors.length), en.map(row => row.errors.length));
  t.equal(cn[0].lockupAmount, '3.000001');
  t.ok(cn[1].errors.includes('真实出价不能为负数。'));
  t.ok(cn[2].errors.includes('真实出价超过六位小数。'));
  t.ok(cn[3].errors.includes('真实出价与掩护金额不能同时为零。'));
  t.ok(cn[4].errors.includes('导入内容中存在重复域名。'));
  t.end();
});

test('duration localization preserves units, values, and the English default', t => {
  t.equal(hoursToNow(1.5), '~1h 30m');
  t.equal(hoursToNow(25.5), '~1d 1h 30m');
  t.equal(hoursToNow(1.5, translate), '~1 小时 30 分钟');
  t.equal(hoursToNow(25.5, translate), '~1 天 1 小时 30 分钟');
  t.equal(hoursToNow(null, translate), '暂无');
  t.end();
});
