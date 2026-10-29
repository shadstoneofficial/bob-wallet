import {validateRelease, validateUpdateInfo} from './releases';

export function deadline(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

// All dependencies are injected so safety tests never import Electron or a wallet.
export class UpdateController {
  constructor({version, arch, enabled, installable, fetchRelease, makeUpdater, gate, isBusy, shutdown, quit}) {
    Object.assign(this, {version, arch, enabled, installable, fetchRelease, makeUpdater, gate, isBusy, shutdown, quit});
    this.state = {stage: enabled ? 'idle' : 'disabled', version};
  }

  async getState() {
    return {error: null, target: null, url: null, notes: '', installable: false, progress: 0, ...this.state};
  }

  async check() {
    if (!this.enabled) throw new Error('Updates are disabled in development and test profiles.');
    if (!['idle', 'available', 'current', 'error'].includes(this.state.stage)) return this.getState();
    this.state = {stage: 'checking', version: this.version};
    try {
      this.release = validateRelease(await deadline(this.fetchRelease(), 20000, 'Release check'), this.version, this.arch);
      this.state = {stage: this.release.available ? 'available' : 'current', version: this.version,
        target: this.release.version, url: this.release.url, notes: this.release.notes,
        installable: this.installable && this.release.installable};
    } catch (error) { this.state = {stage: 'error', version: this.version, error: error.message}; }
    return this.getState();
  }

  async download() {
    if (this.state.stage !== 'available' || !this.state.installable) throw new Error('No installable update selected.');
    this.state = {...this.state, stage: 'downloading', progress: 0};
    try {
      this.updater = this.makeUpdater(this.release, progress => {
        if (this.state.stage === 'downloading') this.state.progress = Math.max(0, Math.min(100, progress));
      });
      const info = await deadline(this.updater.check(), 30000, 'Update metadata check');
      validateUpdateInfo(info, this.release);
      await deadline(this.updater.download(), 30 * 60 * 1000, 'Update download');
      this.state = {...this.state, stage: 'downloaded', progress: 100};
    } catch (error) {
      // Cleanup failures must not hide the original failure or leave the UI
      // claiming that a download is still running indefinitely.
      try { this.updater?.cancel(); } catch (_) { /* This attempt stays unusable. */ }
      // Do not reuse a possibly still completing native attempt in this process.
      this.state = {...this.state, stage: 'downloadFailed', error: error.message};
    }
    return this.getState();
  }

  async install() {
    if (this.state.stage !== 'downloaded') throw new Error('Download an update first.');
    // This synchronous fence closes the admission race before any await.
    try { this.gate.acquire(this.isBusy); } catch (error) {
      this.state = {...this.state, error: error.message};
      return this.getState();
    }
    this.state = {...this.state, stage: 'installing', error: null};
    try {
      // Close the wallet before native staging: Squirrel can install staged updates
      // on a subsequent normal quit. No native staging occurs while the wallet runs.
      await deadline(this.shutdown(), 60000, 'Wallet shutdown');
      await deadline(this.updater.stage(), 120000, 'macOS update verification');
      this.updater.install();
    } catch (error) {
      // A partial shutdown must never reopen financial RPC admission or auto-install.
      this.state = {...this.state, stage: 'installFailed', error: error.message};
    }
    return this.getState();
  }

  async close() {
    if (this.state.stage !== 'installFailed') throw new Error('Close recovery is not available.');
    try {
      await deadline(this.shutdown(), 60000, 'Wallet shutdown');
      this.quit();
    } catch (error) { this.state.error = error.message; }
    return this.getState();
  }
}
