import fs from 'fs';
import path from 'path';

function getUserDataPath() {
  try {
    const electron = require('electron');
    if (electron.app) {
      return electron.app.getPath('userData');
    }
  } catch (e) {}

  return null;
}

export default function traceDeeplink(stage, details = {}) {
  try {
    const userDataPath = getUserDataPath();
    if (!userDataPath) {
      return;
    }

    const entry = {
      at: new Date().toISOString(),
      stage,
      ...details,
    };
    fs.appendFileSync(
      path.join(userDataPath, 'deeplink-debug.log'),
      `${JSON.stringify(entry)}\n`,
    );
  } catch (e) {}
}
