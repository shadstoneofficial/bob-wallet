const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function writeManifest(directory, version, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !['arm64', 'x64'].includes(arch)) throw new Error('Invalid update version/architecture');
  const name = `Bob.LearnHNS-${version}-${arch}.zip`;
  const file = path.join(directory, name);
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const size = fs.statSync(file).size;
  if (!size) throw new Error('Empty update ZIP');
  const manifest = `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${hash.digest('base64')}\n    size: ${size}\n`;
  fs.writeFileSync(path.join(directory, `latest-${arch}-mac.yml`), manifest);
}
module.exports = {writeManifest};
if (require.main === module) writeManifest(...process.argv.slice(2)).catch(error => {console.error(error); process.exitCode = 1;});
