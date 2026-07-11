const Sentry = require('@sentry/electron/renderer');
const {app} = require('./electron');
const pkg = require('../../package.json');

if (app.isPackaged) {
  Sentry.init({
    dsn: 'https://ea41895688674e598d69cbd975872db8@sentry.io/1759225',
    release: 'bob-wallet@' + pkg.version,
  });
}
