import {dispatchToMainWindow} from '../../mainWindow';
import {StorageHealth} from './health';

export const storageHealth = new StorageHealth({dispatch: dispatchToMainWindow});

async function getStoragePath() {
  // Loaded lazily to avoid a startup cycle: NodeService also reports storage errors.
  return require('../node/service').service.getDir();
}

const methods = {
  retryStatusCheck: async () => storageHealth.retry(await getStoragePath()),
};

export async function start(server) {
  server.withService('Storage', methods);
}
