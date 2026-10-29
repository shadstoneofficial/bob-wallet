import https from 'https';
import semver from 'semver';

export const RELEASES_URL = 'https://github.com/shadstoneofficial/bob-wallet/releases';
export const RELEASE_API = 'https://api.github.com/repos/shadstoneofficial/bob-wallet/releases/latest';

// Metadata only. No credentials, wallet identifiers, automatic checks or redirects.
export function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    let size = 0;
    const request = https.get(RELEASE_API, {headers: {
      Accept: 'application/vnd.github+json', 'User-Agent': 'Bob-LearnHNS-update-check',
    }}, response => {
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error('Release check unavailable.')); return;
      }
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) { request.destroy(new Error('Release response too large.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new Error('Invalid release response.')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('Release check timed out.')), 15000);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}

export function validateRelease(release, currentVersion, arch) {
  const version = typeof release?.tag_name === 'string' && release.tag_name.replace(/^v/, '');
  if (!semver.valid(version) || semver.prerelease(version) || release.draft || release.prerelease
      || release.tag_name !== `v${version}` || release.html_url !== `${RELEASES_URL}/tag/v${version}`) {
    throw new Error('Invalid stable release.');
  }
  const base = `${RELEASES_URL}/download/v${version}/`;
  const zipName = `Bob.LearnHNS-${version}-${arch}.zip`;
  const manifestName = `latest-${arch}-mac.yml`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = name => assets.filter(item => item.name === name && item.state === 'uploaded'
    && Number.isSafeInteger(item.size) && item.size > 0
    && item.browser_download_url === base + name);
  const zip = asset(zipName);
  return {
    version, available: semver.gt(version, currentVersion), url: release.html_url,
    notes: typeof release.body === 'string' ? release.body.slice(0, 20000) : '',
    base, zipName, zipSize: zip[0]?.size,
    installable: ['arm64', 'x64'].includes(arch) && zip.length === 1 && asset(manifestName).length === 1,
  };
}

export function validateUpdateInfo(info, release) {
  const files = info?.files;
  if (info?.version !== release.version || !Array.isArray(files) || files.length !== 1
      || files[0].url !== release.zipName || files[0].size !== release.zipSize
      || !/^[A-Za-z0-9+/]{86}==$/.test(files[0].sha512 || '')) {
    throw new Error('Update metadata does not match the selected official release.');
  }
}
