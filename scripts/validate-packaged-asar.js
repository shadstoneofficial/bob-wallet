const fs = require('fs');
const path = require('path');
const asar = require('asar');
const {validateModuleGraph} = require('./validate-build-modules');

function findAsars(root) {
  const found = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && entry.name === 'app.asar') found.push(entryPath);
    }
  }

  walk(root);
  return found;
}

const target = path.resolve(process.argv[2] || 'release');
const archives = fs.statSync(target).isDirectory() ? findAsars(target) : [target];

if (!archives.length) throw new Error(`No app.asar archives found under ${target}.`);

for (const archive of archives) {
  const distFiles = asar.listPackage(archive)
    .map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
    .filter(file => file.startsWith('dist/'))
    .map(file => file.slice('dist/'.length));
  const result = validateModuleGraph(distFiles, file => (
    asar.extractFile(archive, `dist/${file}`.split('/').join(path.sep)).toString('utf8')
  ));
  console.log(`Validated packaged ASAR ${archive} (${result.fileCount} dist files, ${result.reachableModuleCount} reachable main-process modules).`);
}
