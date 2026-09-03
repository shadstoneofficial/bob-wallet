const fs = require('fs');
const path = require('path');
const {
  validateModuleGraph,
  walkFiles,
} = require('./validate-build-modules');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

if (!fs.existsSync(dist)) throw new Error(`Compiled directory not found: ${dist}`);

const files = walkFiles(dist);
const result = validateModuleGraph(files, file => fs.readFileSync(path.join(dist, file), 'utf8'));
const storageReducer = require(path.join(dist, 'ducks', 'storageReducer.js'));

if (storageReducer.STORAGE_BLOCKED !== 'app/storage/blocked') {
  throw new Error('Compiled storageReducer is missing STORAGE_BLOCKED.');
}
if (storageReducer.STORAGE_CLEARED !== 'app/storage/cleared') {
  throw new Error('Compiled storageReducer is missing STORAGE_CLEARED.');
}

console.log(`Validated ${result.fileCount} compiled files and ${result.reachableModuleCount} reachable main-process modules.`);
