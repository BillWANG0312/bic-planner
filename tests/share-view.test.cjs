const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { withPage, launchBrowser } = require('./helpers/browser.cjs');

const token = 'T'.repeat(43);
const pagePath = '/share.html#share=' + token;
function snapshot() {
  const now = Math.floor(Date.now() / 1000);
  return {
    format: 'bic-parent-summary', version: 1, shared_at: now - 60, expires_at: now + 3600,
    report: { name: '家长分享测试同学', grade: '8', year: '2027 年秋季', batchId: 'AP-SHARE-VIEW', date: '2026年10月24日', bankVersion: '2026.10', catalogVersion: '2026.10.24', revision: 2 },
    content: { status: 'draft', direction: '计算机科学', personality: '待完成性格测评',
      subjects: ['english', 'maths', 'physics', 'chemistry'].map((key, i) => ({ key, name: ['英语', '数学', '物理', '化学'][i], answered: i === 1 ? 15 : 0, total: 15, pct: i === 1 ? 80 : null })),
      sections: { summary: '请结合后续测评讨论。', academic: '先补齐作答。', plan: '参加专业体验课程。', personality: '保持多种学习方式。' } }
  };
}
function options(settings = {}) {
  return { path: settings.path || pagePath, viewport: settings.viewport,
    beforeLoad: async page => {
      await page.addInitScript(() => {
        for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Public viewer must not access private browser storage'); } });
      });
    },
    prepare: async context => {
      await context.addCookies([{ name: 'bic_session', value: 'private-owner-cookie', domain: '127.0.0.1', path: '/', httpOnly: true }]);
      await context.route('**/js/cloud-config.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.BIC_CLOUD_CONFIG=' + JSON.stringify(settings.config || { enabled: true, apiBase: './api/' }) + ';' }));
      await context.route('**/api/public/share', route => settings.respond ? settings.respond(route) : route.fulfill({ json: snapshot() }));
    }
  };
}

test('public share page waits for an explicit read and keeps the capability out of URL, DOM and cookies', async () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../share.html')), '独立家长只读页应存在');
  let calls = 0;
  await withPage(async page => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    assert.equal(calls, 0);
    assert.ok(!page.url().includes(token));
    assert.ok(!(await page.content()).includes(token));
    await page.locator('#shareLoadBtn').click();
    await page.locator('#shareContent').waitFor({ state: 'visible' });
    assert.equal(calls, 1);
    assert.match(await page.locator('#shareHeading').textContent(), /家长分享测试同学/);
    assert.deepEqual(errors, []);
  }, options({ respond: route => {
    calls++;
    const request = route.request();
    assert.equal(request.method(), 'GET');
    assert.equal(request.headers()['x-bic-share'], token);
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers().referer, undefined);
    assert.ok(!request.url().includes(token));
    return route.fulfill({ json: snapshot() });
  } }));
});

test('summary renders plain text, pending percentages and only read controls', () => withPage(async page => {
  await page.locator('#shareLoadBtn').click();
  await page.locator('#shareContent').waitFor({ state: 'visible' });
  assert.match(await page.locator('#shareSections').textContent(), /<script>alert/);
  assert.equal(await page.locator('#shareContent script, #shareContent img, #shareContent form, #shareContent input, #shareContent textarea').count(), 0);
  assert.match(await page.locator('#shareSubjects').textContent(), /80%/);
  assert.match(await page.locator('#shareSubjects').textContent(), /待完成/);
  assert.equal(await page.locator('#shareSubjects').getByText('0%', { exact: true }).count(), 0);
  assert.match(await page.locator('#shareMeta').textContent(), /2026.10|修订/);
}, options({ respond: route => {
  const data = snapshot();
  data.report.name = '<img src=x onerror=1>';
  data.content.sections.summary = '<script>alert(1)</script>\n顾问建议';
  return route.fulfill({ json: data });
} })));

test('a revoked or expired reread removes the previously displayed summary', async () => {
  let calls = 0;
  await withPage(async page => {
    await page.locator('#shareLoadBtn').click();
    await page.locator('#shareContent').waitFor({ state: 'visible' });
    await page.locator('#shareLoadBtn').click();
    await page.waitForFunction(() => /失效|无法读取/.test(document.querySelector('#shareStatus').textContent));
    assert.equal(await page.locator('#shareContent').isVisible(), false);
    assert.equal(await page.locator('#shareContent').textContent(), '');
    assert.equal(calls, 2);
    assert.ok(!(await page.locator('#shareStatus').textContent()).includes('private-server-message'));
  }, options({ respond: route => ++calls === 1 ? route.fulfill({ json: snapshot() }) : route.fulfill({ status: 404, json: { detail: 'private-server-message' } }) }));
});

test('disabled, cross-origin or invalid capability links send no public request', async () => {
  for (const settings of [
    { config: { enabled: false, apiBase: './api/' } },
    { config: { enabled: true, apiBase: 'https://outside.invalid/api/' } },
    { config: { enabled: true, apiBase: 'http://name:secret@127.0.0.1/api/' } },
    { config: { enabled: true, apiBase: './api/?secret=x' } },
    { path: '/share.html#share=not-valid' },
    { path: '/share.html' },
    { path: pagePath + '&share=' + token }
  ]) {
    let calls = 0;
    await withPage(async page => {
      assert.equal(await page.locator('#shareLoadBtn').isDisabled(), true);
      assert.equal(calls, 0);
      assert.equal(await page.locator('#shareContent').isVisible(), false);
      assert.ok(!page.url().includes('#'));
    }, options({ ...settings, respond: route => { calls++; return route.fulfill({ json: snapshot() }); } }));
  }
});

test('malformed or oversized responses do not expose their body or keep earlier student data', async () => {
  for (const data of ['x'.repeat(100_001), JSON.stringify({ ...snapshot(), private: 'do-not-display' })]) {
    await withPage(async page => {
      await page.locator('#shareLoadBtn').click();
      await page.waitForFunction(() => /格式|不受支持/.test(document.querySelector('#shareStatus').textContent));
      assert.equal(await page.locator('#shareContent').isVisible(), false);
      assert.ok(!(await page.locator('#shareStatus').textContent()).includes('do-not-display'));
    }, options({ respond: route => route.fulfill({ contentType: 'application/json', body: data }) }));
  }
});

test('network failures are shown without retry and never include the link secret', async () => {
  let calls = 0;
  await withPage(async page => {
    await page.locator('#shareLoadBtn').click();
    await page.waitForFunction(() => /网络|连接/.test(document.querySelector('#shareStatus').textContent));
    assert.equal(calls, 1);
    assert.equal(await page.locator('#shareContent').isVisible(), false);
    assert.ok(!(await page.locator('#shareStatus').textContent()).includes(token));
  }, options({ respond: route => { calls++; return route.abort('failed'); } }));
});

test('public summary fits a 375px display and has an accessible read action', () => withPage(async page => {
  await page.locator('#shareLoadBtn').focus();
  assert.equal(await page.locator('#shareLoadBtn').evaluate(button => button === document.activeElement), true);
  await page.locator('#shareLoadBtn').click();
  await page.locator('#shareContent').waitFor({ state: 'visible' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /noindex/);
  assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'), 'no-referrer');
  assert.ok(!(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).includes('unsafe-inline'));
}, options({ viewport: { width: 375, height: 812 } })));

test('a read has a hard timeout even when a fetch wrapper ignores cancellation', () => withPage(async page => {
  await page.clock.install();
  await page.evaluate(() => { window.fetch = () => new Promise(() => {}); });
  await page.locator('#shareLoadBtn').click();
  await page.clock.runFor(15_001);
  await page.waitForFunction(() => /超时/.test(document.querySelector('#shareStatus').textContent));
  assert.equal(await page.locator('#shareLoadBtn').isDisabled(), false);
  assert.equal(await page.locator('#shareContent').isVisible(), false);
}, options()));

test('leaving clears data and an older ignored-abort response cannot replace a new read', () => withPage(async page => {
  await page.evaluate(data => {
    window.fetch = () => new Promise(resolve => { window.__finishOlderRead = () => resolve(new Response(JSON.stringify({ ...data, report: { ...data.report, name: '不应显示的迟到同学' } }), { headers: { 'Content-Type': 'application/json' } })); });
  }, snapshot());
  await page.locator('#shareLoadBtn').click();
  assert.equal(await page.locator('#shareLoadBtn').isDisabled(), true);
  await page.evaluate(data => {
    window.dispatchEvent(new Event('pagehide'));
    window.fetch = () => Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
  }, snapshot());
  assert.equal(await page.locator('#shareContent').isVisible(), false);
  await page.locator('#shareLoadBtn').click();
  await page.locator('#shareContent').waitFor({ state: 'visible' });
  await page.evaluate(async () => { window.__finishOlderRead(); await new Promise(resolve => requestAnimationFrame(resolve)); });
  assert.match(await page.locator('#shareHeading').textContent(), /家长分享测试同学/);
  assert.ok(!(await page.locator('#shareContent').textContent()).includes('不应显示的迟到同学'));
}, options()));

test('opening the public page as a file keeps local assessment storage untouched and sends no network', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../share.html')).href + '#share=' + token);
    assert.equal(await page.locator('#shareLoadBtn').isDisabled(), true);
    assert.match(await page.locator('#shareStatus').textContent(), /直接打开|本机/);
    assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});
