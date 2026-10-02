// Local, inert component fixtures only. Never starts Electron or a wallet node.
require('@babel/register');
const fs = require('fs');
const path = require('path');
const base = require('../../configs/webpack.config.renderer.dev.babel.js').default;
const outputPath = path.resolve(__dirname, '../../test-dist/locale-preview');

module.exports = {
  ...base,
  entry: path.resolve(__dirname, 'bootstrap.js'),
  devtool: false,
  output: {path: outputPath, filename: 'review.js', publicPath: '/'},
  plugins: [
    ...base.plugins.filter(plugin => plugin.constructor.name !== 'ReactRefreshPlugin'),
    {
      apply(compiler) {
        compiler.hooks.afterEmit.tap('LocalePreviewHTML', () => {
          fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(outputPath, 'index.html'));
        });
      },
    },
  ],
  module: {
    rules: base.module.rules.map(rule => rule.test.toString().includes('jsx')
      ? {...rule, use: {loader: 'babel-loader', options: {cacheDirectory: true}}}
      : rule),
  },
  devServer: undefined,
};
