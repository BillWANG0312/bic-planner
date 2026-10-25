const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPage } = require('./helpers/browser.cjs');

const fakeClient = `window.CloudReports={create(){
const t=window.__accountTest,copy=v=>JSON.parse(JSON.stringify(v));let user=null,connected=false,generation=0;
const session=()=>user?{user:copy(user),expires_at:t.expires}:null;
t.replaceSession=()=>{generation++;user={id:'account-one',username:'student.test',role:'student'};connected=true};
return {get user(){return user&&copy(user)},get connected(){return connected},get identityGeneration(){return generation},
async connect(){t.calls.push(['connect']);connected=true;generation++;if(t.flags.restore)user={id:'account-one',username:'student.test',role:'student'};return session()},
async login(username,password){t.calls.push(['login',username,password]);generation++;user={id:'account-one',username,role:'student'};return session()},
async changePassword(current,next){t.calls.push(['password',current,next]);const captured=generation;if(t.flags.delay)await new Promise(resolve=>t.resolveChange=resolve);
if(captured!==generation)throw {code:'CANCELLED'};
user=null;connected=false;generation++;if(t.flags.error)throw {code:t.flags.error,status:t.flags.status||0};return null},
async logout(){t.calls.push(['logout']);user=null;connected=false;generation++},disconnect(){t.calls.push(['disconnect']);user=null;connected=false;generation++}}}};`;
function withAccount(fn, extra = {}) {
  return withPage(fn, { path: '/account.html', ...extra,
    beforeLoad: async page => {
      await page.addInitScript(data => { window.__accountTest = data; for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('No storage on account page'); } }); }, { calls: [], flags: {}, expires: Math.floor(Date.now() / 1000) + 86400 });
      if (extra.beforeLoad) await extra.beforeLoad(page);
    },
    prepare: async context => { await context.route('**/js/cloud-client.js', route => route.fulfill({ contentType: 'application/javascript', body: fakeClient })); }
  });
}
async function login(page) {
  await page.locator('#accountConnectBtn').click(); await page.locator('#accountLoginForm').waitFor({ state: 'visible' });
  await page.locator('#accountUsername').fill('student.test'); await page.locator('#accountPassword').fill('old-password-123');
  await page.locator('#accountLoginForm button[type=submit]').click(); await page.locator('#accountWorkspace').waitFor({ state: 'visible' });
}
async function fillChange(page, current = 'old-password-123', next = 'new-password-456', confirm = next) {
  await page.locator('#accountCurrentPassword').fill(current); await page.locator('#accountNewPassword').fill(next); await page.locator('#accountConfirmPassword').fill(confirm);
}
async function values(page) { return page.locator('#accountPasswordForm input').evaluateAll(nodes => nodes.map(node => node.value)); }

test('isolated account page source exists', () => assert.equal(fs.existsSync(path.join(__dirname, '../account.html')), true));

test('account page is disconnected with exactly three safe scripts and no initial reads or storage', () => withAccount(async page => {
  assert.deepEqual(await page.evaluate(() => __accountTest.calls), []); assert.equal(await page.locator('#accountWorkspace').isHidden(), true);
  assert.deepEqual(await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src'))), ['js/cloud-config.js', 'js/cloud-client.js', 'js/account.js']);
  assert.equal(await page.locator('#accountPassword').getAttribute('maxlength'), '256');
  assert.ok((await page.locator('#accountPasswordForm input').evaluateAll(nodes => nodes.map(node => node.maxLength))).every(value => value === 256));
}));

test('explicit session restore shows only the current account and password form', () => withAccount(async page => {
  await page.evaluate(() => __accountTest.flags.restore = true); await page.locator('#accountConnectBtn').click();
  await page.locator('#accountWorkspace').waitFor({ state: 'visible' }); assert.match(await page.locator('#accountIdentity').textContent(), /student.test/);
  assert.equal(await page.locator('#accountLoginForm').isHidden(), true); assert.deepEqual(await page.evaluate(() => __accountTest.calls), [['connect']]);
}));

test('confirmation cancellation clears all three passwords without requesting a change', () => withAccount(async page => {
  await login(page); await fillChange(page); page.once('dialog', dialog => dialog.dismiss()); await page.locator('#accountChangeBtn').click();
  assert.deepEqual(await values(page), ['', '', '']); assert.equal(await page.evaluate(() => __accountTest.calls.some(call => call[0] === 'password')), false);
  assert.equal(await page.locator('#accountWorkspace').isVisible(), true);
}));

test('successful confirmed change clears inputs before one request and requires explicit login again', () => withAccount(async page => {
  await login(page); await fillChange(page); await page.evaluate(() => __accountTest.flags.delay = true);
  page.once('dialog', dialog => { assert.match(dialog.message(), /所有.*设备|全部.*会话/); return dialog.accept(); }); await page.locator('#accountChangeBtn').click();
  await page.waitForFunction(() => typeof __accountTest.resolveChange === 'function'); assert.deepEqual(await values(page), ['', '', '']); assert.equal(await page.locator('#accountChangeBtn').isDisabled(), true);
  await page.evaluate(() => document.querySelector('#accountPasswordForm').dispatchEvent(new Event('submit', { cancelable: true })));
  assert.equal(await page.evaluate(() => __accountTest.calls.filter(call => call[0] === 'password').length), 1);
  await page.evaluate(() => __accountTest.resolveChange()); await page.locator('#accountWorkspace').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#accountIdentity').textContent(), ''); assert.match(await page.locator('#accountStatus').textContent(), /全部会话.*撤销|所有.*设备.*重新登录/);
  assert.equal(await page.locator('#accountConnectPanel').isVisible(), true); assert.equal(await page.locator('#accountUsername').inputValue(), '');
  assert.equal(await page.evaluate(() => __accountTest.calls.filter(call => call[0] === 'login').length), 1);
}));

test('mismatch same passwords short code-point input and lone surrogates reject locally without a confirmation', () => withAccount(async page => {
  await login(page); let dialogs = 0; page.on('dialog', dialog => { dialogs++; return dialog.dismiss(); });
  for (const [old, next, repeated] of [['old-password-123', 'new-password-456', 'different-pass-456'], ['old-password-123', 'old-password-123', 'old-password-123'], ['old-password-123', '😀'.repeat(6), '😀'.repeat(6)], ['old-password-123', ' '.repeat(12), ' '.repeat(12)]]) {
    await fillChange(page, old, next, repeated); await page.locator('#accountChangeBtn').click(); assert.deepEqual(await values(page), ['', '', '']);
  }
  await fillChange(page); await page.evaluate(() => { for (const id of ['accountNewPassword', 'accountConfirmPassword']) document.getElementById(id).value = String.fromCharCode(0xd800).repeat(12); });
  await page.locator('#accountChangeBtn').click(); assert.deepEqual(await values(page), ['', '', '']);
  assert.equal(dialogs, 0); assert.equal(await page.evaluate(() => __accountTest.calls.some(call => call[0] === 'password')), false);
}));

test('twelve and128 non-BMP code points can be submitted without UTF16 truncation', () => withAccount(async page => {
  await login(page); await fillChange(page, '😀'.repeat(12), '🧪'.repeat(128)); page.once('dialog', dialog => dialog.accept());
  await page.locator('#accountChangeBtn').click(); await page.locator('#accountWorkspace').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => __accountTest.calls.find(call => call[0] === 'password')), ['password', '😀'.repeat(12), '🧪'.repeat(128)]);
}));

for (const action of ['input', 'away-back', 'identity']) test(`a programmatic ${action} change during confirmation cannot submit the captured credentials`, () => withAccount(async page => {
  await login(page); await fillChange(page); await page.evaluate(action => { window.confirm = () => {
    const input = document.querySelector('#accountNewPassword');
    if (action === 'input') input.value = 'changed-password-789';
    else if (action === 'away-back') { const original = input.value; input.value = 'changed-password-789'; input.dispatchEvent(new Event('input')); input.value = original; input.dispatchEvent(new Event('input')); }
    else __accountTest.replaceSession(); return true;
  }; }, action);
  await page.locator('#accountChangeBtn').click(); assert.equal(await page.evaluate(() => __accountTest.calls.some(call => call[0] === 'password')), false); assert.deepEqual(await values(page), ['', '', '']);
}));

for (const code of ['NETWORK', 'TIMEOUT', 'PROTOCOL', 'HTTP']) test(`${code} change result clears private account data and explains manual new-then-old checking`, () => withAccount(async page => {
  await login(page); await fillChange(page); await page.evaluate(code => __accountTest.flags.error = code, code); page.once('dialog', dialog => dialog.accept());
  await page.locator('#accountChangeBtn').click(); await page.locator('#accountWorkspace').waitFor({ state: 'hidden' });
  assert.deepEqual(await values(page), ['', '', '']); assert.match(await page.locator('#accountStatus').textContent(), /尚未确认|无法确认|不确定/);
  assert.match(await page.locator('#accountStatus').textContent(), /新密码.*旧密码/); assert.equal(await page.evaluate(() => __accountTest.calls.filter(call => call[0] === 'password').length), 1);
}));

test('cancel and local expiry clear password inputs without background polling', () => withAccount(async page => {
  await page.evaluate(() => __accountTest.expires = Math.floor(Date.now() / 1000) + 3); await login(page); await fillChange(page);
  await page.locator('#accountCancelBtn').click(); assert.deepEqual(await values(page), ['', '', '']); await fillChange(page);
  await page.locator('#accountWorkspace').waitFor({ state: 'hidden', timeout: 5000 }); assert.deepEqual(await values(page), ['', '', '']);
  assert.match(await page.locator('#accountStatus').textContent(), /到期/); assert.equal(await page.evaluate(() => __accountTest.calls.some(call => call[0] === 'password')), false);
}));

test('a confirmation crossing local session expiry never sends old credentials', () => withAccount(async page => {
  await page.evaluate(() => __accountTest.expires = Math.floor(Date.now() / 1000) + 3); await login(page); await fillChange(page);
  page.once('dialog', async dialog => { await new Promise(resolve => setTimeout(resolve, 3300)); await dialog.accept(); });
  await page.locator('#accountChangeBtn').click(); await page.locator('#accountWorkspace').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => __accountTest.calls.some(call => call[0] === 'password')), false); assert.deepEqual(await values(page), ['', '', '']);
}));

test('disconnect and late results cannot clear a newly connected same-name identity', () => withAccount(async page => {
  await login(page); await fillChange(page); await page.evaluate(() => __accountTest.flags.delay = true); page.once('dialog', dialog => dialog.accept()); await page.locator('#accountChangeBtn').click();
  await page.waitForFunction(() => typeof __accountTest.resolveChange === 'function'); await page.locator('#accountDisconnectBtn').click(); assert.deepEqual(await values(page), ['', '', '']);
  await page.evaluate(() => { __accountTest.flags.restore = true; __accountTest.flags.delay = false; }); await page.locator('#accountConnectBtn').click(); await page.locator('#accountWorkspace').waitFor({ state: 'visible' });
  await fillChange(page); await page.evaluate(() => __accountTest.resolveChange());
  assert.equal(await page.locator('#accountWorkspace').isVisible(), true); assert.match(await page.locator('#accountIdentity').textContent(), /student.test/); assert.deepEqual(await values(page), ['old-password-123', 'new-password-456', 'new-password-456']);
}));

for (const reason of ['disconnect', 'expiry']) test(`an unconfirmed sent change preserves manual verification instructions after ${reason}`, () => withAccount(async page => {
  if (reason === 'expiry') await page.evaluate(() => __accountTest.expires = Math.floor(Date.now() / 1000) + 3);
  await login(page); await fillChange(page); await page.evaluate(() => __accountTest.flags.delay = true);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#accountChangeBtn').click(); await page.waitForFunction(() => typeof __accountTest.resolveChange === 'function');
  if (reason === 'disconnect') await page.locator('#accountDisconnectBtn').click();
  else await page.locator('#accountWorkspace').waitFor({ state: 'hidden', timeout: 5000 });
  const status = await page.locator('#accountStatus').textContent(); assert.match(status, /改密结果.*尚未确认|改密结果.*未知/);
  assert.match(status, /新密码.*旧密码/); assert.match(status, /没有自动重试|未自动重试/); assert.doesNotMatch(status, /服务器会话未主动注销/);
  if (reason === 'expiry') assert.match(status, /到期/);
  assert.deepEqual(await values(page), ['', '', '']); await page.evaluate(() => __accountTest.resolveChange());
  assert.equal(await page.locator('#accountStatus').textContent(), status); assert.equal(await page.evaluate(() => __accountTest.calls.filter(call => call[0] === 'password').length), 1);
}));

test('restoring a cookie session after an uncertain change gives a manual logout and new-password verification path', () => withAccount(async page => {
  await login(page); await fillChange(page); await page.evaluate(() => __accountTest.flags.delay = true); page.once('dialog', dialog => dialog.accept()); await page.locator('#accountChangeBtn').click();
  await page.waitForFunction(() => typeof __accountTest.resolveChange === 'function'); await page.locator('#accountDisconnectBtn').click();
  await page.evaluate(() => __accountTest.flags.restore = true); await page.locator('#accountConnectBtn').click(); await page.locator('#accountWorkspace').waitFor({ state: 'visible' });
  assert.match(await page.locator('#accountStatus').textContent(), /退出当前会话.*新密码.*登录核对/);
  assert.equal(await page.evaluate(() => __accountTest.calls.filter(call => call[0] === 'login').length), 1); await page.evaluate(() => __accountTest.resolveChange());
  assert.equal(await page.locator('#accountWorkspace').isVisible(), true);
}));

test('pagehide destroys captured credentials and a late response cannot restore the form', () => withAccount(async page => {
  await login(page); await fillChange(page); await page.evaluate(() => __accountTest.flags.delay = true); page.once('dialog', dialog => dialog.accept()); await page.locator('#accountChangeBtn').click();
  await page.waitForFunction(() => typeof __accountTest.resolveChange === 'function'); await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); __accountTest.resolveChange(); window.dispatchEvent(new Event('pageshow')); });
  assert.deepEqual(await values(page), ['', '', '']); assert.equal(await page.locator('#accountWorkspace').isHidden(), true); assert.equal(await page.locator('#accountIdentity').textContent(), '');
  assert.match(await page.locator('#accountStatus').textContent(), /改密结果.*尚未确认|改密结果.*未知/); assert.match(await page.locator('#accountStatus').textContent(), /新密码.*旧密码/);
}));

test('the isolated account form fits375px and keeps all passwords masked', () => withAccount(async page => {
  await login(page); await fillChange(page); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok((await page.locator('input[type=password]').count()) === 4); assert.match(await page.locator('main').textContent(), /全部会话|所有设备/);
}, { viewport: { width: 375, height: 812 } }));
