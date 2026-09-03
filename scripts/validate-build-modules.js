const fs = require('fs');
const path = require('path');

const REQUIRED_DIST_FILES = [
  'app.html',
  'main.js',
  'mainWindow.js',
  'background/storage/health.js',
  'background/storage/service.js',
  'ducks/storageReducer.js',
];

function walkFiles(root, current = root) {
  const files = [];

  for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, entryPath));
    else if (entry.isFile()) files.push(path.relative(root, entryPath));
  }

  return files;
}

function relativeRequires(source) {
  const requires = [];
  const pattern = /require\(\s*(['"])(\.[^'"]+)\1\s*\)/g;
  let match;

  while ((match = pattern.exec(source))) requires.push(match[2]);
  return requires;
}

function resolveModule(files, fromFile, request) {
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), request));
  return [normalized, `${normalized}.js`, path.posix.join(normalized, 'index.js')]
    .find(candidate => files.has(candidate));
}

function validateModuleGraph(fileNames, readFile, entryFiles = ['main.js']) {
  const files = new Set(fileNames.map(file => file.replaceAll(path.sep, '/').replace(/^\//, '')));
  const missing = [];
  const visited = new Set();
  const pending = [...entryFiles];

  for (const required of REQUIRED_DIST_FILES) {
    if (!files.has(required)) missing.push(`required file: ${required}`);
  }

  while (pending.length) {
    const file = pending.shift();
    if (visited.has(file) || !files.has(file) || !file.endsWith('.js')) continue;
    visited.add(file);
    const source = readFile(file);

    for (const request of relativeRequires(source)) {
      const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(file), request));
      if (normalized.startsWith('../')) continue;
      const resolved = resolveModule(files, file, request);
      if (!resolved) {
        missing.push(`${file} -> ${request}`);
      } else if (resolved.endsWith('.js')) {
        pending.push(resolved);
      }
    }
  }

  if (missing.length) {
    throw new Error(`Missing compiled module(s):\n${missing.map(item => `- ${item}`).join('\n')}`);
  }

  return {fileCount: files.size, reachableModuleCount: visited.size};
}

module.exports = {
  REQUIRED_DIST_FILES,
  relativeRequires,
  resolveModule,
  validateModuleGraph,
  walkFiles,
};
