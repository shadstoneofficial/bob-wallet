import { makeClient } from '../ipc/ipc';

export const clientStub = ipcRendererInjector => makeClient(ipcRendererInjector, 'Setting', [
  'getExplorer',
  'setExplorer',
  'getLocale',
  'setLocale',
  'getCustomLocale',
  'setCustomLocale',
  'getTheme',
  'setTheme',
  'getShowUsdValue',
  'setShowUsdValue',
  'getLatestRelease',
  'validateLiquidityChannelHost',
]);
