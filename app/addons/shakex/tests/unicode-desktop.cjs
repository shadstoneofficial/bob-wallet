const {app, BrowserWindow} = require('electron');
const fs = require('fs');
const assert = require('node:assert/strict');
const path = '/tmp/bob-shakex-unicode';
app.setPath('userData', fs.mkdtempSync('/tmp/bob-shakex-unicode-profile-'));
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
app.whenReady().then(async () => {
  const css = fs.readdirSync(path).filter(x => x.endsWith('.css')).map(x => `<link rel="stylesheet" href="${x}">`).join('');
  fs.writeFileSync(`${path}/index.html`, `<!doctype html><html><head><meta charset="utf-8">${css}<style>#root{width:auto;height:auto;overflow:visible}body{padding:24px;overflow:auto}</style></head><body class="bob-theme-dark"><div id="root"></div><script src="fixture.js"></script></body></html>`);
  const win = new BrowserWindow({width:1200, height:1000, show:false, webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details, cb) => cb({cancel:true}));
  const js = code => win.webContents.executeJavaScript(code);
  try {
    for (const locale of ['en','zh-CN']) {
      await win.loadFile(`${path}/index.html`, {query:{locale}});
      for (let i=0;i<50;i++) {if(await js('!!document.querySelector("button")')) break; await pause();}
      await js('document.querySelector("button").click()'); await pause();
      assert.deepEqual(await js('Array.from(document.querySelectorAll("h3 bdi")).slice(0,3).map(x=>x.textContent)'), ['🇬🇸','🐹','🧔']);
      assert.equal(await js('document.querySelectorAll("article").length'), 8);
      for (const width of [1200,600]) {
        win.setContentSize(width,1000); await pause();
        await js('document.querySelector(".shakex-addon__list").scrollIntoView()'); await pause();
        assert(await js('document.documentElement.scrollWidth <= innerWidth'), `${locale} ${width} no page overflow`);
        assert(await js('Array.from(document.querySelectorAll("article")).every(x=>x.scrollWidth<=x.clientWidth)'), 'long labels stay in cards');
        fs.writeFileSync(`${path}/${locale}-${width}.png`, (await win.webContents.capturePage()).toPNG());
        if(width===600) {
          await js('document.querySelectorAll("article")[4].scrollIntoView()'); await pause();
          fs.writeFileSync(`${path}/${locale}-${width}-long-rtl.png`, (await win.webContents.capturePage()).toPNG());
        }
      }
      await js('searchFixture("🐹")'); await pause();
      assert.equal(await js('document.querySelector("article").dataset.name'), 'xn--ep8h');
      await js('searchFixture("xn--ev9h")'); await pause();
      assert.equal(await js('document.querySelector("h3 bdi").textContent'), '🧔');
    }
    console.log('Offline Electron Unicode fixture PASS: EN/zh-CN, 600/1200px, emoji glyphs, canonical labels, Unicode/ASCII search, long names and bidi-isolated RTL.');
  } finally {win.destroy(); app.quit();}
}).catch(error => {console.error(error); app.exit(1);});
