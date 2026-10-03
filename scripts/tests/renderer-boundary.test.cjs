const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
test('renderer connection constants do not import the private backend lifecycle', () => {
  for (const file of ['app/ducks/node.js', 'app/components/SplashScreen/index.js',
    'app/pages/AppHeader/index.js', 'app/pages/App/index.js', 'app/pages/Settings/index.js',
    'app/pages/Settings/CustomRPCConfigModal.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!/from\s+["'][^"']*connections\/service["']/.test(source), file);
    assert(/from\s+["'][^"']*connections\/types["']/.test(source), file);
  }
  const constants = fs.readFileSync(path.join(root, 'app/background/connections/types.js'), 'utf8');
  assert(!/\brequire\s*\(|\bimport\b/.test(constants));
  assert.match(constants, /P2P: 'P2P'/);
  assert.match(constants, /Custom: 'Custom'/);
  assert.match(constants, /TEST: 'TEST'/);
});
