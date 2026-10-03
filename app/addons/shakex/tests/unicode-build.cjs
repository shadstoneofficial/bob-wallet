// Compile only the offline display fixture; never package/sign/publish Bob.
require('@babel/register')();
const path = require('path');
const webpack = require('webpack');
const config = require('../../../../configs/webpack.config.renderer.prod.babel').default;
config.entry = path.resolve(__dirname, 'unicode-entry.js');
config.output = {...config.output, path: '/tmp/bob-shakex-unicode', filename: 'fixture.js'};
config.mode = 'development';
config.optimization = {minimize: false};
webpack(config, (error, stats) => {
  if (error || stats.hasErrors()) {console.error(error || stats.toString({all: false, errors: true})); process.exitCode = 1;}
  else console.log('Offline Unicode fixture compiled.');
});
