#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

function loadAsar() {
  const tries = [
    'asar',
    '@electron/asar',
    'app-builder-lib/node_modules/asar',
    'electron-builder/node_modules/asar',
    'app-builder-lib/node_modules/@electron/asar',
  ];
  for (const name of tries) {
    try {
      return require(name);
    } catch (err) {
      if (err && err.code !== 'MODULE_NOT_FOUND')
        throw err;
    }
  }
  throw new Error('Could not load the asar module to inspect goosig.node.');
}

function extractGoosigFromAsar(asarPath) {
  const asar = loadAsar();
  const inner = 'node_modules/goosig/build/Release/goosig.node';
  if (typeof asar.extractFile !== 'function')
    throw new Error('asar.extractFile is not available.');
  return asar.extractFile(asarPath, inner);
}

function findGoosigNode(appPath) {
  const unpacked = path.join(
    appPath,
    'Contents/Resources/app.asar.unpacked/node_modules/goosig/build/Release/goosig.node',
  );
  if (fs.existsSync(unpacked))
    return {kind: 'unpacked', file: unpacked};

  const archive = path.join(appPath, 'Contents/Resources/app.asar');
  if (!fs.existsSync(archive))
    throw new Error(`Packaged asar not found in ${appPath}`);

  const tmp = path.join(os.tmpdir(), `bob-goosig-${process.pid}.node`);
  fs.writeFileSync(tmp, extractGoosigFromAsar(archive));
  return {kind: 'asar', file: tmp, tmp};
}

function linkedLibraries(nodePath) {
  const result = spawnSync('otool', ['-L', nodePath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `otool -L failed for ${nodePath}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function main() {
  if (process.platform !== 'darwin') {
    console.log(`Skipping goosig GMP check on ${process.platform}.`);
    return;
  }

  const appPath = process.argv[2];
  if (!appPath)
    throw new Error('Usage: node scripts/verify-goosig-no-gmp.js /path/to/Bob LearnHNS.app');
  if (!fs.existsSync(appPath))
    throw new Error(`App bundle not found: ${appPath}`);

  const found = findGoosigNode(appPath);
  try {
    const output = linkedLibraries(found.file);
    console.log(`goosig.node (${found.kind}):\n${output}`);
    if (/libgmp|\/opt\/gmp\/|Cellar\/gmp/i.test(output)) {
      throw new Error(
        'Packaged goosig.node links Homebrew/system GMP. Rebuild with mini-gmp before shipping.',
      );
    }
    console.log('Packaged goosig.node does not link libgmp.');
  } finally {
    if (found.tmp)
      fs.unlinkSync(found.tmp);
  }
}

main();
