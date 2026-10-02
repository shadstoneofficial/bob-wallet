const {app, BrowserWindow} = require('electron');
const fs = require('fs');
const assert = require('assert/strict');
const path = '/tmp/bob-shakex-desktop';
app.setPath('userData', fs.mkdtempSync('/tmp/bob-shakex-fixture-'));
app.whenReady().then(async () => {
  const css = fs.readdirSync(path).filter(x => x.endsWith('.css')).map(x => `<link rel="stylesheet" href="${x}">`).join('');
  fs.writeFileSync(`${path}/index.html`, `<!doctype html><html><head><meta charset="utf-8">${css}<style>body{padding:24px;font-family:Arial;background:#fff}body.bob-theme-dark{background:#0d1117;color:#e6edf3}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
  const win = new BrowserWindow({width: 1200, height: 1500, show: false, webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}});
  try {
    await win.loadFile(`${path}/index.html`);
    const js = code => win.webContents.executeJavaScript(code);
    for (let i = 0; i < 100; i++) {if (await js('!!window.fixture && !!document.querySelector(".shakex-listing-form input")')) break; await new Promise(r => setTimeout(r, 50));}
    await js('fixture.edit()');
    await new Promise(r => setTimeout(r, 60));
    await js('document.querySelector(".shakex-listing-form button").click()');
    await new Promise(r => setTimeout(r, 120));
    const state = await js('fixture.state()');
    assert.equal(state.sends, 0);
    assert.equal(state.state.importReview.kind, 'shakex');
    assert.equal(state.state.updatedResource.records.length, 5);
    assert.equal(state.state.updatedResource.records[2].txt[0], 'x:alice');
    assert(await js('document.querySelector(".activate-import-review").textContent.includes("Complete result")'));
    await new Promise(r => setTimeout(r, 300));
    fs.writeFileSync(`${path}/review-light.png`, (await win.webContents.capturePage()).toPNG());
    await js('document.body.classList.add("bob-theme-dark")');
    await new Promise(r => setTimeout(r, 300));
    fs.writeFileSync(`${path}/review-dark.png`, (await win.webContents.capturePage()).toPNG());
    win.setContentSize(600, 850);
    await new Promise(r => setTimeout(r, 300));
    assert(await js('document.querySelector(".activate-import-review").getBoundingClientRect().right <= innerWidth'));
    assert(await js('document.documentElement.scrollWidth <= innerWidth'), 'review fits narrow viewport');
    fs.writeFileSync(`${path}/review-narrow.png`, (await win.webContents.capturePage()).toPNG());
    await js('document.querySelector(".activate-import-review").scrollIntoView()');
    await new Promise(r => setTimeout(r, 200));
    fs.writeFileSync(`${path}/review-narrow-details.png`, (await win.webContents.capturePage()).toPNG());
    await js('document.querySelector(".records-table__action-row__submit-btn").click()');
    await new Promise(r => setTimeout(r, 80));
    assert.equal((await js('fixture.state()')).sends, 1);
    assert.equal(await js('fixture.checkStale()'), true);
    assert.equal((await js('fixture.state()')).sends, 1);
    for (const mode of ['loading', 'empty', 'error', 'populated']) {
      await js(`fixture.browse('${mode}'); window.scrollTo(0, 0)`);
      await new Promise(r => setTimeout(r, 100));
      await js('document.querySelector(".shakex-addon button").click()');
      await new Promise(r => setTimeout(r, 300));
      if (mode === 'loading') assert(await js('document.querySelector(".shakex-addon button").disabled'));
      if (mode === 'empty') assert(await js('document.body.textContent.includes("No listings are available")'));
      if (mode === 'error') assert(await js('!!document.querySelector("[role=alert]")'));
      if (mode === 'populated') assert.equal(await js('document.querySelectorAll(".shakex-addon article").length'), 1);
      assert(await js('document.documentElement.scrollWidth <= innerWidth'), `${mode} fits narrow viewport`);
      fs.writeFileSync(`${path}/browse-${mode}.png`, (await win.webContents.capturePage()).toPNG());
    }
    console.log('Desktop fixture PASS: real Electron rendering, before/after, DNS preservation, explicit submit, post-unlock stale rejection, 600px layout and loading/empty/error/populated browsing states.');
  } finally {win.destroy(); app.quit();}
}).catch(error => {console.error(error); app.exit(1);});
