const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const commit = git(['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid build source commit.');
if (git(['status', '--porcelain', '--untracked-files=normal'])) {
  throw new Error('Build provenance requires a clean source worktree.');
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const provenance = {version: pkg.version, commit, dirty: false,
  builtAt: new Date().toISOString(), workflowRun: process.env.GITHUB_RUN_ID || null,
  platform: process.platform, architecture: process.arch};
fs.writeFileSync(path.join(root, 'dist/build-provenance.json'),
  `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Build provenance: ${pkg.version} at ${commit}`);
