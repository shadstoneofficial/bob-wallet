import {ipcRenderer} from './electron';

export default function traceDeeplink(stage, details = {}) {
  ipcRenderer.send('BOB/TRACE_DEEPLINK', {stage, details});
}
