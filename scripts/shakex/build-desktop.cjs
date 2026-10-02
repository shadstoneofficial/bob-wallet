require('@babel/register')();
const path = require('path');
const webpack = require('webpack');
const config = require('../../configs/webpack.config.renderer.prod.babel').default;
config.entry = path.resolve(__dirname, 'desktop-entry.js');
config.output = {...config.output, path: '/tmp/bob-shakex-desktop', filename: 'fixture.js'};
config.mode = 'development';
config.optimization = {minimize: false};
webpack(config, (err, stats) => {
  if (err || stats.hasErrors()) {console.error(err || stats.toString({all: false, errors: true})); process.exitCode = 1;}
  else console.log('Desktop fixture built.');
});
