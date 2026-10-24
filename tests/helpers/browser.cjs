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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 }, ...(options.storageState ? { storageState: options.storageState } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  if (options.prepare) await options.prepare(context);
  if (options.beforeLoad) await options.beforeLoad(page);
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin + (options.path || '/'));
  return { context, page, origin, async close() { await context.close(); await new Promise(resolve => server.close(resolve)); } };
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
