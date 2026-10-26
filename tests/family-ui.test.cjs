const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPage } = require('./helpers/browser.cjs');

function snapshot() {
  const now = Math.floor(Date.now() / 1000);
  return { format: 'bic-parent-summary', version: 1, shared_at: now, expires_at: now + 86400,
    report: { name: '<img src=x onerror=1>', grade: '8', year: '2027', batchId: 'AP-FAMILY', date: '2026年10月24日', bankVersion: '2026.10', catalogVersion: '2026.10.24', revision: 1 },
    content: { status: 'draft', direction: '探索方向', personality: '待完成', subjects: ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, name: key, answered: 0, total: 15, pct: null })), sections: Object.fromEntries(['summary', 'academic', 'plan', 'personality'].map(key => [key, '请与老师讨论。'])) } };
}
const fakeClient = `
window.CloudReports={create(){
 let user=null,connected=false;
 const state=window.__familyTest;
 const clone=v=>JSON.parse(JSON.stringify(v));
 return {
 get user(){return user&&clone(user);},get connected(){return connected;},
 async connect(){state.calls.push(['connect']);if(state.flags.disabled)throw Object.assign(new Error('private-server-error'),{code:'DISABLED'});connected=true;return user?{user:clone(user),expires_at:2000000000}:null;},
 async login(username,password){state.calls.push(['login',username]);user={id:username,username,role:'student'};return {user:clone(user),expires_at:2000000000};},
 async listFamilyAccess(){state.calls.push(['list']);return {items:clone(state.flags.listMissing?[]:state.grants)};},
 async familyThread(id){state.calls.push(['thread',id]);if(state.flags.delayRead)await new Promise(resolve=>state.resolveRead=resolve);if(state.flags.readFail){state.flags.readFail=false;throw Object.assign(new Error('private-server-error'),{code:'NETWORK'});}if(state.flags.denied){user=null;throw Object.assign(new Error('private-server-error'),{status:403,code:'CSRF'});}const grant=clone(state.grants.find(g=>g.id===id));return {grant,snapshot:clone(state.snapshot),comments:clone(state.comments),participant:'recipient',can_comment:grant.status==='active'};},
 async addFamilyComment(id,body,key){state.calls.push(['add',id,body,key]);let existing=state.comments.find(c=>c.client_request_id===key);if(!existing){existing={id:'comment-'+(state.comments.length+1),author:'recipient',body,created_at:Math.floor(Date.now()/1000),client_request_id:key};state.comments.push(existing);}if(state.flags.writeFail){state.flags.writeFail=false;throw Object.assign(new Error('private-write-detail'),{code:'NETWORK'});}return clone(existing);},
 async logout(){state.calls.push(['logout']);if(state.flags.delayLogout)await new Promise(resolve=>state.resolveLogout=resolve);user=null;connected=false;},
 disconnect(){state.calls.push(['disconnect']);user=null;connected=false;}
 };
}};`;

function options(extra = {}) {
  const snap = snapshot();
  return { path: '/family.html', ...extra,
    beforeLoad: async page => {
      await page.addInitScript(data => {
        window.__familyTest = { calls: [], flags: {}, snapshot: data, comments: [], grants: [
          {id:'grant-1',report_id:'report-1',report_revision:1,report_name:data.report.name,report_ref:data.report.batchId,recipient_username:'parent.test',created_at:data.shared_at,expires_at:data.expires_at,revoked_at:null,status:'active'},
          {id:'grant-2',report_id:'report-2',report_revision:1,report_name:data.report.name,report_ref:data.report.batchId,recipient_username:'parent.test',created_at:data.shared_at,expires_at:data.expires_at,revoked_at:null,status:'active'}
        ] };
        for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw new Error('Family page must not use browser storage');}});
      }, snap);
      if (extra.beforeLoad) await extra.beforeLoad(page);
    }, prepare: async context => {
      await context.route('**/js/cloud-client.js*', route => route.fulfill({contentType:'application/javascript',body:fakeClient}));
      if (extra.prepare) await extra.prepare(context);
    }
  };
}
function withFamily(fn, extra) {
  assert.ok(fs.existsSync(path.join(__dirname, '../family.html')), '受邀账号批注页面应存在');
  return withPage(fn, options(extra));
}
async function login(page, username='parent.test') {
  await page.locator('#familyConnectBtn').click();
  await page.locator('#familyUsername').fill(username);
  await page.locator('#familyPassword').fill('test-only-family-password');
  await page.locator('#familyLoginForm button[type=submit]').click();
  await page.locator('#familyWorkspace').waitFor({state:'visible'});
}
async function thread(page) {
  await login(page);
  await page.locator('#familyRefreshBtn').click();
  await page.locator('[data-family-thread="grant-1"]').click();
  await page.locator('#familyThread').waitFor({state:'visible'});
}

test('family page is isolated and neither probes accounts nor treats a readonly fragment as write permission', () => withFamily(async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  assert.equal(await page.evaluate(()=>window.__familyTest.calls.length),0);
  assert.equal(await page.locator('#familyWorkspace').isVisible(),false);
  await login(page);
  assert.equal(await page.locator('#familyPassword').inputValue(),'');
  assert.deepEqual(await page.evaluate(()=>window.__familyTest.calls.map(c=>c[0])),['connect','login']);
  assert.equal(await page.locator('#familyList').textContent(),'');
  assert.deepEqual(errors,[]);
}, {path:'/family.html#share='+'x'.repeat(43)}));

test('explicit thread reads render escaped snapshot and appended comments without changing the report', () => withFamily(async page => {
  await thread(page);
  assert.match(await page.locator('#familySnapshot').textContent(),/<img src=x onerror=1>/);
  assert.equal(await page.locator('#familySnapshot img').count(),0);
  await page.locator('#familyBody').fill('<script>alert(1)</script> 请讨论。');
  await page.locator('#familySubmitBtn').click();
  await page.waitForFunction(()=>document.querySelector('#familyBody').value==='');
  assert.match(await page.locator('#familyComments').textContent(),/<script>alert\(1\)<\/script>/);
  assert.equal(await page.locator('#familyComments script').count(),0);
  assert.equal(await page.evaluate(()=>window.__familyTest.calls.filter(c=>c[0]==='add').length),1);
  assert.equal(await page.locator('[data-edit],[data-delete]').count(),0);
}));

test('an uncertain write keeps its text and reuses the same idempotency key only on explicit retry', () => withFamily(async page => {
  await thread(page);await page.evaluate(()=>window.__familyTest.flags.writeFail=true);
  await page.locator('#familyBody').fill('未确认批注');
  await page.locator('#familySubmitBtn').click();
  await page.waitForFunction(()=>/未确认|尚未确认/.test(document.querySelector('#familyStatus').textContent));
  assert.equal(await page.locator('#familyBody').inputValue(),'未确认批注');
  assert.equal(await page.evaluate(()=>window.__familyTest.calls.filter(c=>c[0]==='add').length),1);
  await page.locator('#familySubmitBtn').click();
  await page.waitForFunction(()=>document.querySelector('#familyBody').value==='');
  const calls=await page.evaluate(()=>window.__familyTest.calls.filter(c=>c[0]==='add'));
  assert.equal(calls.length,2);assert.equal(calls[0][3],calls[1][3]);
  assert.equal(await page.evaluate(()=>window.__familyTest.comments.length),1);
  assert.equal(await page.locator('[data-family-comment]').count(),1);
}));

test('refresh confirms an earlier uncertain write without resending or silently clearing an unconfirmed draft', () => withFamily(async page => {
  await thread(page);await page.evaluate(()=>window.__familyTest.flags.writeFail=true);
  await page.locator('#familyBody').fill('等待确认');await page.locator('#familySubmitBtn').click();
  await page.waitForFunction(()=>/未确认|尚未确认/.test(document.querySelector('#familyStatus').textContent));
  await page.locator('#familyThreadRefreshBtn').click();
  await page.waitForFunction(()=>document.querySelector('#familyBody').value==='');
  assert.equal(await page.evaluate(()=>window.__familyTest.calls.filter(c=>c[0]==='add').length),1);
  assert.equal(await page.locator('[data-family-comment]').count(),1);
}));

test('confirming an earlier uncertain comment preserves a newer unsent draft', () => withFamily(async page => {
  await thread(page);await page.evaluate(()=>window.__familyTest.flags.writeFail=true);
  await page.locator('#familyBody').fill('A 已提交但未知');await page.locator('#familySubmitBtn').click();
  await page.waitForFunction(()=>/未确认|尚未确认/.test(document.querySelector('#familyStatus').textContent));
  await page.locator('#familyBody').fill('B 新文字尚未提交');
  await page.locator('#familyThreadRefreshBtn').click();
  await page.waitForFunction(()=>/已确认/.test(document.querySelector('#familyStatus').textContent));
  assert.equal(await page.locator('#familyBody').inputValue(),'B 新文字尚未提交');
  assert.equal(await page.evaluate(()=>window.__familyTest.calls.filter(c=>c[0]==='add').length),1);
  assert.equal(await page.locator('[data-family-comment]').count(),1);
}));

test('a failed refresh retains the current discussion and permits checking the same pending draft again', () => withFamily(async page => {
  await thread(page);await page.evaluate(()=>window.__familyTest.flags.writeFail=true);
  await page.locator('#familyBody').fill('等待刷新确认');await page.locator('#familySubmitBtn').click();
  await page.waitForFunction(()=>/未确认|尚未确认/.test(document.querySelector('#familyStatus').textContent));
  await page.evaluate(()=>window.__familyTest.flags.readFail=true);
  await page.locator('#familyThreadRefreshBtn').click();
  await page.locator('#familyThreadRefreshBtn:enabled').waitFor();
  assert.equal(await page.locator('#familyThread').isVisible(),true);
  assert.equal(await page.locator('#familyBody').inputValue(),'等待刷新确认');
  await page.locator('#familyThreadRefreshBtn').click();
  await page.waitForFunction(()=>document.querySelector('#familyBody').value==='');
  assert.equal(await page.evaluate(()=>window.__familyTest.calls.filter(c=>c[0]==='add').length),1);
}));

test('switching threads or logging out asks before discarding unsent text', () => withFamily(async page => {
  await thread(page);await page.locator('#familyBody').fill('请保留草稿');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-family-thread="grant-2"]').click();
  assert.equal(await page.locator('#familyBody').inputValue(),'请保留草稿');
  assert.equal(await page.evaluate(()=>window.__familyTest.calls.filter(c=>c[0]==='thread').length),1);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#familyLogoutBtn').click();
  assert.equal(await page.locator('#familyBody').inputValue(),'请保留草稿');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#familyLogoutBtn').click();
  await page.locator('#familyConnectBtn').waitFor({state:'visible'});
  assert.equal(await page.locator('#familyThread').isVisible(),false);
  assert.equal(await page.locator('#familyComments').textContent(),'');
  assert.match(await page.locator('#familyStatus').textContent(),/已退出/);
}));

test('lost permission clears private thread content and cannot post a cached response', () => withFamily(async page => {
  await thread(page);await page.evaluate(()=>window.__familyTest.flags.denied=true);
  await page.locator('#familyThreadRefreshBtn').click();
  await page.locator('#familyLoginForm').waitFor({state:'visible'});
  assert.equal(await page.locator('#familyThread').isVisible(),false);
  assert.equal(await page.locator('#familyComments').textContent(),'');
  assert.equal(await page.locator('#familySnapshot').textContent(),'');
  assert.ok(!(await page.locator('#familyStatus').textContent()).includes('private-server-error'));
}));

test('a list refresh that removes the selected invitation clears private data but preserves an unsent draft for copying', () => withFamily(async page => {
  await thread(page);await page.locator('#familyBody').fill('只留在本页的新草稿');
  await page.evaluate(()=>window.__familyTest.flags.listMissing=true);
  await page.locator('#familyRefreshBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-family-thread]').length===0);
  assert.equal(await page.locator('#familySnapshot').textContent(),'');
  assert.equal(await page.locator('#familyComments').textContent(),'');
  assert.equal(await page.locator('#familyBody').inputValue(),'只留在本页的新草稿');
  assert.equal(await page.locator('#familyBody').evaluate(element=>element.readOnly),true);
  assert.equal(await page.locator('#familyBody').isDisabled(),false);
  assert.equal(await page.locator('#familySubmitBtn').isDisabled(),true);
  assert.ok(!(await page.locator('#familyThreadHeading').textContent()).includes('<img'));
  assert.match(await page.locator('#familyStatus').textContent(),/未提交|复制/);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#familyLogoutBtn').click();
  assert.equal(await page.locator('#familyBody').inputValue(),'只留在本页的新草稿');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#familyDiscardBtn').click();
  assert.equal(await page.locator('#familyThread').isVisible(),false);
}));

test('returning from a pending old thread cannot replace a newly connected account', () => withFamily(async page => {
  await login(page);await page.locator('#familyRefreshBtn').click();
  await page.evaluate(()=>window.__familyTest.flags.delayRead=true);
  await page.locator('[data-family-thread="grant-1"]').click();
  await page.waitForFunction(()=>typeof window.__familyTest.resolveRead==='function');
  await page.locator('#familyDisconnectBtn').click();
  await login(page,'second.parent');
  await page.evaluate(()=>window.__familyTest.resolveRead());
  assert.match(await page.locator('#familyAccount').textContent(),/second.parent/);
  assert.equal(await page.locator('#familyThread').isVisible(),false);
}));

test('inactive threads have no write control and mobile layout fits 375px', () => withFamily(async page => {
  await page.evaluate(()=>window.__familyTest.grants[0].status='expired');
  await thread(page);
  assert.equal(await page.locator('#familySubmitBtn').isDisabled(),true);
  assert.equal(await page.locator('#familyBody').isDisabled(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}, {viewport:{width:375,height:812}}));
