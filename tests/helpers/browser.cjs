const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

async function launchBrowser() {
  const temp = path.join(root, 'test-results', 'browser-temp');
  fs.mkdirSync(temp, { recursive: true });
  process.env.TEMP = temp;
  process.env.TMP = temp;
  process.env.TMPDIR = temp;
  const options = { headless: true };
  if (!fs.existsSync(chromium.executablePath())) options.channel = 'chrome';
  return chromium.launch(options);
}

async function openApp(browser, options = {}) {
  const server = http.createServer((req, res) => {
    let filename;
    try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
    catch { res.writeHead(400).end(); return; }
    if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (filename === root) filename = path.join(root, 'index.html');
    fs.readFile(filename, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  let context;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 }, ...(options.storageState ? { storageState: options.storageState } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    // 默认隔离网站维护者的云端配置；需要真实模式的测试显式传入 cloudConfig。
    if (options.cloudConfig !== false) {
      const config = options.cloudConfig || { enabled: false, apiBase: './api/' };
      await context.route('**/js/cloud-config.js*', route => route.fulfill({
        contentType: 'application/javascript; charset=utf-8',
        body: 'window.BIC_CLOUD_CONFIG = ' + JSON.stringify(config) + ';'
      }));
    }
    if (options.prepare) await options.prepare(context);
    if (options.beforeLoad) await options.beforeLoad(page);
    // The application itself no longer reads browser storage. Test fixtures still
    // seed their starting state through the old storage key, so copy it into the
    // in-memory seed the app understands. This runs only in the test browser.
    if (typeof page.addInitScript === 'function') await page.addInitScript(() => {
      try {
        const raw = localStorage.getItem('pathwise.state.v1');
        if (raw !== null) window.__BIC_SEED_STATE__ = JSON.parse(raw);
      } catch (_) {}
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + (options.path || '/'));
    return { context, page, origin, async close() { await context.close(); await new Promise(resolve => server.close(resolve)); } };
  } catch (error) {
    // A failed setup never reaches withPage's app assignment. Release its
    // resources here without replacing the original fixture/navigation error.
    try { if (context) await context.close(); } catch (_) {}
    try {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    } catch (_) {}
    throw error;
  }
}

async function withPage(fn, options = {}) {
  const browser = await launchBrowser();
  let app;
  try {
    app = await openApp(browser, options);
    return await fn(app.page, app);
  } finally {
    if (app) await app.close();
    await browser.close();
  }
}

module.exports = { launchBrowser, openApp, withPage };
