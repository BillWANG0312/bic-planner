const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state } = require('./helpers/report.cjs');

function fixture() {
  const w = loadReportScripts();
  const value = state(w);
  value.info.name = '本机测试同学';
  value.report = w.generateReport(value);
  value.report.meta.batchId = 'AP-CLOUD-UI';
  return value;
}

const fakeClient = `
window.CloudReports = {create() {
  let user = null;
  let connected = false;
  let generation = 0;
  const calls = [];
  window.__cloudTest = {calls, flags: {}, get user() {return user;}};
  const clone = value => JSON.parse(JSON.stringify(value));
  return {
    get user() { return user && clone(user); }, get connected() {return connected;},
    async connect() {calls.push(['connect']); if(window.__cloudTest.flags.disabled) throw Object.assign(new Error('本网站尚未开通账号报告服务，请继续使用本机报告库。'),{code:'DISABLED'}); connected = true; return null;},
    async login(username, password) {calls.push(['login',username]); user={id:'u-1',username,role:'advisor'}; return {user:clone(user),expires_at:2000000000};},
    async list() {calls.push(['list']); return {items:window.__cloudItems.map(item=>({id:item.id,revision:item.revision,archive_id:item.record.id,report_ref:item.record.reportMeta.batchId,name:item.record.state.info.name,grade:item.record.state.info.grade,year:item.record.state.info.year,created_at:item.created_at,updated_at:item.updated_at})),total:window.__cloudItems.length,limit:100,offset:0};},
    async get(id) {calls.push(['get',id]); if(window.__cloudTest.flags.delayRead) await new Promise(resolve=>window.__cloudTest.resolveRead=resolve); if(window.__cloudTest.flags.accessDenied){user=null;throw Object.assign(new Error('会话已变化，请重新连接并登录。'),{status:403,code:'AUTH'});} const item=clone(window.__cloudItems.find(item=>item.id===id)); if(window.__cloudTest.flags.corrupt) item.record.state.academic.answers.ph3=true; return item;},
    async create(record) {calls.push(['create',clone(record)]); const item={id:'server-created',revision:1,created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z',record:clone(record)};window.__cloudItems.push(item);return clone(item);},
    async update(id,revision,record) {calls.push(['update',id,revision,clone(record)]); if(window.__cloudTest.flags.conflict) throw Object.assign(new Error('资料已变化，请刷新名单并重新读取；未自动覆盖。'),{status:409,code:'REVISION'});const item=window.__cloudItems.find(item=>item.id===id);item.record=clone(record);item.revision++;return clone(item);},
    async remove(id,revision) {calls.push(['remove',id,revision]);window.__cloudItems=window.__cloudItems.filter(item=>item.id!==id);},
    async logout() {calls.push(['logout']);const own=generation;if(window.__cloudTest.flags.delayLogout)await new Promise(resolve=>window.__cloudTest.resolveLogout=resolve);if(own===generation){user=null;connected=false;}if(window.__cloudTest.flags.logoutFail)throw Object.assign(new Error('网络连接中断'),{code:'NETWORK'});},
    disconnect() {calls.push(['disconnect']);generation++;user=null;connected=false;}
  };
}};`;

// 替换页面的应用脚本：openState 与真实应用的 openReportState 一致，按当前版本校验并重新生成报告。
// 报告生成器只做替身，报告编号沿用归档的记录元数据。
const fakeApp = `
window.generateReport = () => ({ meta: { batchId: 'AP-REGENERATED' }, academic: {}, plan: {}, mbti: {} });
(function() {
  let current=window.__testState;
  let active='home';
  function show(name) {active=name;document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id==='screen-'+name));}
  function makeRecord() {let raw=null;const store=ReportStore.create({getItem:()=>raw,setItem:(_,v)=>raw=v});return store.save(current).record;}
  window.__cloudItems=[{id:'server-one',revision:4,created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z',record:makeRecord()}];
  window.__cloudItems[0].record.state.info.name='<img src=x onerror=1>';
  const opened=[];
  const client=CloudReports.create();
  const ui=CloudReportUI.init({client,getCurrentRecord:makeRecord,hasProgress:()=>true,getReport:()=>current.report,isActive:()=>active==='cloud',
    showCloud(){show('cloud');},closeCloud(){show('home');},
    openState(next){
      // 与真实应用一致：按当前题库和目录校验并重新生成报告，沿用归档的记录信息与报告元数据；
      // 写入失败（例如存储空间不足）时抛出错误且不替换当前作答。
      if(window.__cloudTest.flags.openFailure)throw new Error('当前作答无法保存，未替换');
      // 与真实应用一致：只校验作答四部分与报告版本，其余包装字段（reportMeta 等）原样保留。
      const source=next.state||next;
      const checked=ReportStore.validateState({info:source.info,academic:source.academic,plan:source.plan,mbti:source.mbti,assessmentProfile:window.AssessmentProfiles.CURRENT},window.AssessmentProfiles.CURRENT,{allowBlankName:true});
      // 本机报告库有同一份归档时传入的是重建好的报告，直接沿用；否则按当前版本生成。
      const report=source.report&&typeof source.report==='object'?JSON.parse(JSON.stringify(source.report)):window.generateReport(checked);
      report.meta={...report.meta,...(next.reportMeta||source.reportMeta)};
      current={...source,...checked,assessmentProfile:window.AssessmentProfiles.CURRENT,report};
      opened.push(current);show('report');}
  });
  window.__cloudApp={opened,get current(){return current;},set current(value){current=value;},ui};
  show('home');
})();`;

function setup(extra = {}) {
  return {
    ...extra,
    beforeLoad: page => page.addInitScript(value => { window.__testState = value; }, fixture()),
    prepare: async context => {
      await context.route('**/js/cloud-client.js*', route => route.fulfill({contentType:'application/javascript',body:fakeClient}));
      await context.route('**/js/app.js*', route => route.fulfill({contentType:'application/javascript',body:fakeApp}));
    }
  };
}

async function signIn(page) {
  await page.locator('#cloudBtn').click();
  // 连接按钮始终隐藏：登录框直接提交时会先连接账号服务，连接在这一步发生。
  assert.equal(await page.locator('#cloudConnectBtn').isHidden(), true);
  await page.locator('#cloudUsername').fill('advisor.local');
  await page.locator('#cloudPassword').fill('private-test-password');
  await page.locator('#cloudLoginForm button[type=submit]').click();
  await page.locator('#cloudWorkspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-cloud-read]').length===1);
}

test('cloud panel makes no request before explicit connection and clears submitted passwords', () => withPage(async page => {
  assert.equal(await page.locator('#cloudBtn').count(), 1);
  assert.deepEqual(await page.evaluate(()=>window.__cloudTest.calls), []);
  await page.locator('#cloudBtn').click();
  assert.equal(await page.locator('#screen-cloud.active').isVisible(), true);
  assert.equal(await page.locator('#cloudHeading').evaluate(el=>el===document.activeElement), true);
  assert.deepEqual(await page.evaluate(()=>window.__cloudTest.calls), []);
  await page.locator('#cloudUsername').fill('advisor.local');
  await page.locator('#cloudPassword').fill('private-test-password');
  await page.locator('#cloudLoginForm button[type=submit]').click();
  await page.locator('#cloudWorkspace').waitFor({state:'visible'});
  assert.ok((await page.evaluate(()=>window.__cloudTest.calls)).some(call=>call[0]==='login'));
  assert.equal(await page.locator('#cloudPassword').inputValue(), '');
  assert.doesNotMatch(await page.evaluate(()=>JSON.stringify({...localStorage})), /private-test-password|csrf|token/);
  assert.equal(await page.locator('#cloudUsername').getAttribute('autocomplete'), 'username');
  assert.equal(await page.locator('#cloudPassword').getAttribute('autocomplete'), 'current-password');
}, setup()));

test('metadata uses text and reading details alone never replaces current work', () => withPage(async page => {
  await signIn(page);
  assert.match(await page.locator('#cloudList').innerText(), /<img src=x onerror=1>/);
  assert.equal(await page.locator('#cloudList img').count(), 0);
  await page.locator('[data-cloud-read]').click();
  await page.locator('#cloudDetail').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.__cloudApp.opened.length), 0);
  assert.match(await page.locator('#cloudDetail').innerText(), /AP-CLOUD-UI/);
  assert.match(await page.locator('#cloudDetail').innerText(), /4/);
}, setup()));

test('upload is one explicit confirmed record and cancellation leaves service and local archive unchanged', () => withPage(async page => {
  await signIn(page);
  page.once('dialog', dialog=>dialog.dismiss());
  await page.locator('#cloudUploadBtn').click();
  assert.equal(await page.evaluate(()=>window.__cloudTest.calls.filter(c=>c[0]==='create').length), 0);
  page.once('dialog', async dialog=>{assert.match(dialog.message(), /本机测试同学/);assert.match(dialog.message(), /作答/);await dialog.accept();});
  await page.locator('#cloudUploadBtn').click();
  await page.waitForFunction(()=>window.__cloudTest.calls.some(c=>c[0]==='create'));
  const calls=await page.evaluate(()=>window.__cloudTest.calls.filter(c=>c[0]==='create'));
  assert.equal(calls.length,1);
  assert.equal(calls[0][1].reportMeta.batchId,'AP-CLOUD-UI');
  assert.equal(await page.evaluate(()=>localStorage.getItem('bic.report-library.v1')),null);
}, setup()));

test('local archive can be selected for one upload without changing the current student', () => withPage(async page => {
  await page.evaluate(()=>{
    const value=JSON.parse(JSON.stringify(window.__cloudApp.current));value.info.name='选择的归档同学';value.report.meta.batchId='AP-SELECTED';
    ReportStore.create(localStorage).save(value);
  });
  await signIn(page);
  const option=page.locator('#cloudUploadSource option').filter({hasText:'选择的归档同学'});
  const id=await option.getAttribute('value');
  await page.locator('#cloudUploadSource').selectOption(id);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#cloudUploadBtn').click();
  await page.waitForFunction(()=>window.__cloudTest.calls.some(c=>c[0]==='create'));
  assert.equal(await page.evaluate(()=>window.__cloudTest.calls.find(c=>c[0]==='create')[1].state.info.name),'选择的归档同学');
  assert.equal(await page.evaluate(()=>window.__cloudApp.current.info.name),'本机测试同学');
}, setup()));

test('invalid remote record is rejected before opening and storage failure preserves current progress', () => withPage(async page => {
  await signIn(page);
  await page.evaluate(()=>window.__cloudTest.flags.corrupt=true);
  await page.locator('[data-cloud-read]').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  assert.equal(await page.locator('#cloudDetail').isVisible(),false);
  await page.evaluate(()=>{window.__cloudTest.flags.corrupt=false;window.__cloudTest.flags.openFailure=true;});
  await page.locator('[data-cloud-read]').click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#cloudOpenBtn').click();
  // 账号报告不经本机报告库：打开时直接使用本次读取并校验过的报告，保存失败由应用就地提示且不替换作答。
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('当前作答无法保存'));
  assert.equal(await page.evaluate(()=>window.__cloudApp.opened.length),0);
  assert.equal(await page.evaluate(()=>window.__cloudApp.current.info.name),'本机测试同学');
}, setup()));

test('open requires confirmation and warns when regenerating another catalog version', () => withPage(async page => {
  await signIn(page);
  await page.evaluate(()=>window.__cloudItems[0].record.catalogVersion='old');
  await page.locator('[data-cloud-read]').click();
  const first=[];
  page.once('dialog', dialog => { first.push(dialog.message()); dialog.dismiss(); });
  await page.locator('#cloudOpenBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('已取消打开'));
  assert.match(first[0], /版本|重新生成/);
  assert.equal(await page.evaluate(()=>window.__cloudApp.opened.length),0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#cloudOpenBtn').click();
  await page.waitForFunction(()=>window.__cloudApp.opened.length===1);
  assert.equal(await page.evaluate(()=>window.__cloudApp.current.report.meta.batchId),'AP-CLOUD-UI');
}, setup()));

test('cached detail cannot open after its session identity becomes invalid', () => withPage(async page => {
  await signIn(page);
  await page.locator('[data-cloud-read]').click();
  await page.locator('#cloudDetail').waitFor({state:'visible'});
  await page.evaluate(()=>window.__cloudTest.flags.accessDenied=true);
  let dialogs=0;
  page.on('dialog',dialog=>{dialogs++;return dialog.accept();});
  await page.locator('#cloudOpenBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  assert.equal(await page.evaluate(()=>window.__cloudApp.opened.length),0);
  assert.equal(dialogs,0);
  assert.equal(await page.locator('#cloudDetail').isVisible(),false);
  assert.equal(await page.locator('#cloudList').innerText(),'');
}, setup()));

test('opening cached detail requires its original revision and never upgrades silently', () => withPage(async page => {
  await signIn(page);
  await page.locator('[data-cloud-read]').click();
  await page.locator('#cloudDetail').waitFor({state:'visible'});
  await page.evaluate(()=>{window.__cloudItems[0].revision=5;window.__cloudItems[0].record.state.info.name='已在别处修改';});
  let dialogs=0;
  page.on('dialog',dialog=>{dialogs++;return dialog.accept();});
  await page.locator('#cloudOpenBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  assert.equal(await page.evaluate(()=>window.__cloudApp.opened.length),0);
  assert.equal(dialogs,0);
  assert.match(await page.locator('#cloudStatus').innerText(),/变化|重新读取/);
  assert.match(await page.locator('#cloudDetailSummary').innerText(),/修订 4/);
  assert.doesNotMatch(await page.locator('#cloudDetailSummary').innerText(),/已在别处修改/);
}, setup()));

test('update uses the read revision and conflict never silently rereads or overwrites', () => withPage(async page => {
  await signIn(page);
  await page.locator('[data-cloud-read]').click();
  await page.evaluate(()=>window.__cloudTest.flags.conflict=true);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#cloudUpdateBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  const calls=await page.evaluate(()=>window.__cloudTest.calls);
  assert.equal(calls.filter(c=>c[0]==='update').length,1);
  assert.equal(calls.find(c=>c[0]==='update')[2],4);
  assert.equal(calls.filter(c=>c[0]==='get').length,1);
  assert.match(await page.locator('#cloudStatus').innerText(),/变化|冲突|重新读取/);
  await page.evaluate(()=>window.__cloudApp.current.report.meta.batchId='AP-DIFFERENT');
  await page.locator('#cloudUploadSource').dispatchEvent('change');
  assert.equal(await page.locator('#cloudUpdateBtn').isDisabled(),true);
}, setup()));

test('delete confirms server metadata revision and never deletes local archives', () => withPage(async page => {
  await signIn(page);
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('[data-cloud-delete]').click();
  assert.equal(await page.evaluate(()=>window.__cloudTest.calls.filter(c=>c[0]==='remove').length),0);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-cloud-delete]').click();
  await page.waitForFunction(()=>window.__cloudTest.calls.some(c=>c[0]==='remove'));
  assert.deepEqual(await page.evaluate(()=>window.__cloudTest.calls.find(c=>c[0]==='remove')),['remove','server-one',4]);
  assert.equal(await page.evaluate(()=>window.__cloudApp.current.info.name),'本机测试同学');
}, setup()));

test('logout clears names and details even when server logout is unconfirmed', () => withPage(async page => {
  await signIn(page);
  await page.locator('[data-cloud-read]').click();
  await page.evaluate(()=>window.__cloudTest.flags.logoutFail=true);
  await page.locator('#cloudLogoutBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudWorkspace').hidden);
  assert.equal(await page.locator('#cloudList').innerText(),'');
  assert.equal(await page.locator('#cloudDetail').isVisible(),false);
  assert.match(await page.locator('#cloudStatus').innerText(),/注销.*未确认|服务器.*确认/);
}, setup()));

test('successful logout reports confirmed session revocation', () => withPage(async page => {
  await signIn(page);
  await page.locator('#cloudLogoutBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudWorkspace').hidden);
  assert.match(await page.locator('#cloudStatus').innerText(),/已退出账号.*已撤销/);
  assert.equal(await page.locator('#cloudStatus').evaluate(el=>el.classList.contains('is-error')),false);
}, setup()));

test('late logout after leaving cannot disconnect a newly signed-in account', () => withPage(async page => {
  await signIn(page);
  await page.evaluate(()=>window.__cloudTest.flags.delayLogout=true);
  await page.locator('#cloudLogoutBtn').click();
  await page.waitForFunction(()=>typeof window.__cloudTest.resolveLogout==='function');
  await page.locator('#cloudBackBtn').click();
  await page.locator('#cloudBtn').click();
  await page.locator('#cloudUsername').fill('another.advisor');
  await page.locator('#cloudPassword').fill('private-test-password');
  await page.locator('#cloudLoginForm button[type=submit]').click();
  await page.locator('#cloudWorkspace').waitFor({state:'visible'});
  await page.evaluate(()=>window.__cloudTest.resolveLogout());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__cloudTest.user?.username),'another.advisor');
  assert.equal(await page.locator('#cloudWorkspace').isVisible(),true);
}, setup()));

test('returning while a detail read is pending prevents late state replacement', () => withPage(async page => {
  await signIn(page);
  await page.evaluate(()=>window.__cloudTest.flags.delayRead=true);
  await page.locator('[data-cloud-read]').click();
  await page.waitForFunction(()=>typeof window.__cloudTest.resolveRead==='function');
  await page.locator('#cloudBackBtn').click();
  await page.evaluate(()=>window.__cloudTest.resolveRead());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#screen-home.active').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__cloudApp.opened.length),0);
}, setup()));

test('cloud controls remain within 375px and disabled service leaves local mode available', () => withPage(async page => {
  await page.locator('#cloudBtn').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.evaluate(()=>window.__cloudTest.flags.disabled=true);
  await page.locator('#cloudUsername').fill('advisor.local');
  await page.locator('#cloudPassword').fill('private-test-password');
  await page.locator('#cloudLoginForm button[type=submit]').click();
  await page.waitForFunction(()=>/尚未开通|本机/.test(document.querySelector('#cloudStatus').textContent));
  assert.match(await page.locator('#cloudStatus').innerText(),/尚未开通|本机/);
  // 服务未开通时仍是未登录状态，登录框保留以便改用本机报告库。
  assert.equal(await page.locator('#cloudLoginForm').isVisible(),true);
  assert.equal(await page.locator('#cloudWorkspace').isVisible(),false);
  await page.locator('#cloudBackBtn').click();
  assert.equal(await page.locator('#cloudBtn').evaluate(el=>el===document.activeElement),true);
}, setup({viewport:{width:375,height:812}})));
