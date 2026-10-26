'use strict';
// A native window.confirm opened from a click's own task cannot be answered reliably in headless Chromium:
// until it is answered every later page call waits behind it, and Playwright's answer is itself queued
// behind the click, so no test can tell an answered confirmation from an open one without hanging. Pages
// therefore load js/test-confirm.js in place of the native dialog when BIC_TEST_HOOKS is set. It asks the
// same questions and decides them from a queue the test fills beforehand.
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../../js/test-confirm.js');

// Every page of this context loads the test confirmation instead of the native dialog. Without it the
// pages keep window.confirm, so a context that must show a real dialog simply does not call this.
async function useConfirmHooks(context) {
  const body = await fs.promises.readFile(file, 'utf8');
  await context.addInitScript(() => { window.BIC_TEST_HOOKS = 1; });
  // A context route sees every API response too, so it must hand all of them back untouched.
  await context.route(url => url.pathname === '/js/test-confirm.js', route => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body }));
  await context.route(url => url.pathname.startsWith('/api/'), route => route.continue());
}
// Polls a page function until it says so. The polling happens within the page: every message sent from Node can
// queue behind an open question, and the page is what answers it.
async function until(page, check, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(source => eval('(' + source + ')()'), check.toString())) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('The page never showed ' + what);
}
// confirmAt queues answers for the next confirmations of this page; call it before the click that asks, or while
// its question is open. A page that waits on an answer still serves the calls that come after the question was
// shown; one sent before it is queued behind the click and is read only once the page has moved on.
function useConfirm(page) {
  return {
    confirmAt: (value, count = 1) => page.evaluate(([value, times]) => window.__BIC_CONFIRM.confirmAt(value, times), [value, count]),
    // The questions this page has shown so far.
    asked: () => page.evaluate(() => window.__BIC_CONFIRM.asked.slice())
  };
}
module.exports = { useConfirmHooks, useConfirm, until };
