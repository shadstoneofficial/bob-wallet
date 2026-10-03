// Local, inert component fixtures only. Never starts Electron or a wallet node.
require('@babel/register');
const fs = require('fs');
const path = require('path');
const base = require('../../configs/webpack.config.renderer.dev.babel.js').default;
const outputPath = path.resolve(__dirname, '../../test-dist/login-language-preview');

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
          for (const [width, height] of [[800, 700], [1280, 900]]) {
            for (const theme of ['light', 'dark']) {
              for (const screen of ['login', 'create', 'restore', 'welcome']) {
                fs.writeFileSync(path.join(outputPath, `${width}-${theme}-${screen}.html`),
                  `<!doctype html><meta charset="utf-8"><title>Fixture ${width}x${height} ${theme} ${screen}</title><style>body{margin:0;background:#ddd}iframe{display:block;border:0;width:${width}px;height:${height}px}</style><iframe title="Bob fixture ${width}x${height}" src="/?theme=${theme}&screen=${screen}"></iframe>`);
              }
            }
          }
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
