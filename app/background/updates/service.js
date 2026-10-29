import {UpdateController} from './controller';
import {fetchLatestRelease} from './releases';
import {UpdateGate, walletIsBusy} from './gate';

export function start(server, {app, testMode, wallet, shutdown}) {
  const gate = new UpdateGate();
  server.setAdmissionGate(gate);
  const controller = new UpdateController({
    version: app.getVersion(), arch: process.arch,
    enabled: app.isPackaged && !testMode,
    installable: process.platform === 'darwin' && app.isInApplicationsFolder(),
    fetchRelease: fetchLatestRelease, gate, isBusy: () => walletIsBusy(wallet), shutdown, quit: () => app.quit(),
    makeUpdater: (release, progress) => {
      const {MacUpdater} = require('electron-updater');
      const {CancellationToken} = require('builder-util-runtime');
      const updater = new MacUpdater();
      updater.updateConfigPath = require('path').join(process.resourcesPath, 'manual-update.yml');
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.disableDifferentialDownload = true;
      updater.setFeedURL({provider: 'generic', url: release.base, channel: `latest-${process.arch}`});
      updater.on('error', () => {}); // Errors are surfaced through the operation promise.
      updater.on('download-progress', info => progress(info.percent));
      const token = new CancellationToken();
      let cancelled = false;
      updater.on('update-downloaded', () => { if (cancelled) updater.closeServerIfExists(); });
      return {
        check: async () => (await updater.checkForUpdates()).updateInfo,
        download: () => updater.downloadUpdate(token),
        cancel: () => { cancelled = true; token.cancel(); updater.closeServerIfExists(); },
        stage: () => new Promise((resolve, reject) => {
          const native = require('electron').autoUpdater;
          const clean = () => { native.removeListener('error', fail); native.removeListener('update-downloaded', done); };
          const fail = error => { clean(); reject(error); };
          const done = () => { clean(); resolve(); };
          native.once('error', fail);
          native.once('update-downloaded', done);
          try { native.checkForUpdates(); } catch (error) { fail(error); }
        }),
        install: () => require('electron').autoUpdater.quitAndInstall(),
      };
    },
  });
  server.withService('Updates', {
    getState: () => controller.getState(), check: () => controller.check(),
    download: () => controller.download(), install: () => controller.install(), close: () => controller.close(),
  });
  return controller;
}
