const {spawnSync} = require('child_process');
const path = require('path');
for (const [file, ...args] of [
  ['restore-overlap.cjs', '--baseline'],
  ['restore-overlap.cjs', '--lock-cycle', '--baseline'],
  ['restore-overlap.cjs'],
  ['restore-overlap.cjs', '--lock-cycle'],
  ['spv-overlap.cjs', '--baseline'],
  ['spv-overlap.cjs'],
]) {
  console.log(`\nFixture: ${file} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file), ...args], {
    stdio: 'inherit', timeout: 30000,
    env: {...process.env, NODE_BACKEND: 'js', BABEL_DISABLE_CACHE: '1'},
  });
  if (result.error || result.status !== 0) {
    console.error(result.error || `Fixture exited ${result.status}`);
    process.exit(1);
  }
}
