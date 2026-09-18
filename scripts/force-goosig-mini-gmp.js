#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const gooDir = path.join(root, 'node_modules', 'goosig');
const hasGmpPath = path.join(gooDir, 'utils', 'has_gmp.sh');

if (!fs.existsSync(gooDir)) {
  console.log('goosig is not installed; skipping mini-gmp rebuild.');
  process.exit(0);
}

if (fs.existsSync(path.dirname(hasGmpPath))) {
  fs.writeFileSync(
    hasGmpPath,
    '#!/bin/sh\n# Forced off so packaged Bob does not dlopen Homebrew libgmp.\necho false\nexit 0\n',
    {encoding: 'utf8', mode: 0o755},
  );
}

const gypDefines = ['with_gmp=false', process.env.GYP_DEFINES]
  .filter(Boolean)
  .join(' ');

const env = {
  ...process.env,
  npm_config_with_gmp: 'false',
  GYP_DEFINES: gypDefines,
};

console.log('Rebuilding goosig with bundled mini-gmp (no Homebrew libgmp).');
const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['rebuild', 'goosig', '--build-from-source'],
  {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
