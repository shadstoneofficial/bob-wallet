const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');

// Run the real CLI against disposable fixtures, never modifying repository locales.
const english = {
  message: 'Broadcast %s HNS via RPC',
  progress: 'Progress %s%',
  catalog: 'ShakeX via shakex.fun',
  url: 'https://example.invalid/help',
  markup: '<b>Warning</b>\n**Keep** `HNS`',
};
const valid = {
  message: '通过 RPC 广播 %s HNS',
  progress: '进度 %s%',
  catalog: '通过 shakex.fun 使用 ShakeX',
  url: 'https://example.invalid/help',
  markup: '<b>警告</b>\n**保留** `HNS`',
};
const cases = [
  ['valid translation', value => value, true],
  ['missing key', value => {delete value.message; return value;}],
  ['obsolete key', value => ({...value, obsolete: '旧文本'})],
  ['missing placeholder', value => ({...value, message: '通过 RPC 广播 HNS'})],
  ['duplicated placeholder', value => ({...value, message: '通过 RPC 广播 %s %s HNS'})],
  ['literal percent removed', value => ({...value, progress: '进度 %s'})],
  ['changed URL', value => ({...value, url: 'https://example.invalid/other'})],
  ['changed technical token', value => ({...value, message: '通过 RPC 广播 %s BTC'})],
  ['missing markup', value => ({...value, markup: '警告\n**保留** `HNS`'})],
  ['missing newline', value => ({...value, markup: '<b>警告</b>**保留** `HNS`'})],
  ['changed bare domain', value => ({...value, catalog: '通过 shakex.fum 使用 ShakeX'})],
  ['changed brand', value => ({...value, catalog: '通过 shakex.fun 使用 Shakex'})],
  ['empty value', value => ({...value, message: ''})],
  ['non-string value', value => ({...value, message: 42})],
];
for (const [name, mutate, succeeds = false] of cases) {
  test(name, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-locale-check-'));
    try {
      fs.mkdirSync(path.join(root, 'scripts'));
      fs.mkdirSync(path.join(root, 'locales'));
      fs.copyFileSync(__dirname + '/check-locale.js', root + '/scripts/check-locale.js');
      fs.writeFileSync(root + '/locales/en.json', JSON.stringify(english));
      fs.writeFileSync(root + '/locales/fixture.json', JSON.stringify(mutate({...valid})));
      const result = spawnSync(process.execPath, [root + '/scripts/check-locale.js', 'fixture'], {encoding: 'utf8'});
      assert.equal(result.status, succeeds ? 0 : 1, result.stdout + result.stderr);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
}
