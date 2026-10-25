const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');

function fixture() {
  const w = loadReportScripts(); vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/report-store.js'),'utf8'), {window:w,Date});
  let raw=null; const store=w.ReportStore.create({getItem:()=>raw,setItem:(_,v)=>raw=v});
  const value=state(w,false);value.info.name='<img src=x>同学';value.report=w.generateReport(value);value.report.meta.batchId='AP-EDIT';
  w.reportEditing.applyEdit(value.report,'summary','<script>原建议</script>','原顾问');const record=store.save(value).record,now=Math.floor(Date.now()/1000);
  return {calls:[],flags:{},grant:{id:'grant-one',report_id:'report-one',report_revision:4,report_name:record.state.info.name,report_ref:record.reportMeta.batchId,owner_username:'owner.test',recipient_username:'teacher.test',scope:'full_report_advice_edit',created_at:now,expires_at:now+86400,revoked_at:null,status:'active'},report:{id:'report-one',revision:4,created_at:record.createdAt,updated_at:record.updatedAt,record},baseline:Object.fromEntries(Object.keys(w.reportEditing.sections).map(k=>[k,w.reportEditing.getText(value.report,k)]))};
}
const client=`window.CloudReports={create(){let user=null,connected=false;const t=window.__editTest,c=v=>JSON.parse(JSON.stringify(v));return {
get user(){return user&&c(user)},get connected(){return connected},async connect(){t.calls.push(['connect']);connected=true},async login(username){t.calls.push(['login',username]);user={id:username,username,role:t.flags.student?'student':'advisor'}},
async listAdvisorEditable(){t.calls.push(['list']);if(t.flags.denied){user=null;throw {status:403}}return {items:c(t.flags.missing?[]:[t.grant])}},
async readAdvisorEditable(id){t.calls.push(['read',id]);if(t.flags.delay)await new Promise(r=>t.resolveRead=r);if(t.flags.network)throw {code:'NETWORK'};if(t.flags.closed)throw {status:404};const r={grant:c(t.grant),report:c(t.report),baseline:c(t.baseline)};if(t.flags.old)r.report.record.bankVersion='old';return r},
async applyAdvisorEdit(...args){t.calls.push(['apply',...args]);if(t.flags.applyDelay)await new Promise(r=>t.resolveApply=r);if(t.flags.applyNetwork)throw {code:'NETWORK'};if(t.flags.conflict)throw {status:409};return {report:{...c(t.report),revision:t.report.revision+1},changed_sections:Object.keys(args[2]),audit_id:'audit-one'}},
async logout(){t.calls.push(['logout']);user=null;connected=false},disconnect(){t.calls.push(['disconnect']);user=null;connected=false}}}};`;
function options(extra={}){return {path:'/advisor-edit.html',...extra,beforeLoad:async page=>{await page.addInitScript(data=>{window.__editTest=data;for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw new Error('Editor must not access storage')}});},fixture());if(extra.beforeLoad)await extra.beforeLoad(page)},prepare:async context=>{await context.route('**/js/cloud-client.js',r=>r.fulfill({contentType:'application/javascript',body:client}));if(extra.prepare)await extra.prepare(context)}};}
function withEditor(fn,extra){assert.ok(fs.existsSync(path.join(__dirname,'../advisor-edit.html')),'Independent advisor edit portal must exist');return withPage(fn,options(extra));}
async function login(page){await page.locator('#editConnectBtn').click();await page.locator('#editUsername').fill('teacher.test');await page.locator('#editPassword').fill('test-only-editor-password');await page.locator('#editLoginForm button[type=submit]').click();await page.locator('#editWorkspace').waitFor({state:'visible'});}
async function read(page){await login(page);await page.locator('#editRefreshBtn').click();await page.locator('[data-edit-read="grant-one"]').click();await page.locator('#editReport .paper').waitFor();}
async function change(page,text='新的顾问建议'){await page.locator('[data-edit-select="summary"]').check();await page.locator('[data-edit-section="summary"]').fill(text);await page.locator('#editPreviewChangesBtn').click();await page.locator('#editChangesPreview').waitFor({state:'visible'});}

test('independent editor waits for explicit connection/list/read and uses no browser progress or storage',()=>withEditor(async page=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));assert.deepEqual(await page.evaluate(()=>__editTest.calls),[]);assert.equal(await page.evaluate(()=>location.hash),'');
  await login(page);assert.equal(await page.locator('#editPassword').inputValue(),'');assert.deepEqual(await page.evaluate(()=>__editTest.calls.map(v=>v[0])),['connect','login']);
  await page.locator('#editRefreshBtn').click();await page.locator('[data-edit-read="grant-one"]').click();await page.locator('#editReport .paper').waitFor();
  assert.match(await page.locator('#editReport').textContent(),/<img src=x>同学/);assert.equal(await page.locator('#editReport img[src=x],#editReport script').count(),0);
  assert.equal(await page.locator('#cloudUploadBtn,#archiveReportBtn,#printBtn,script[src*="app.js"],script[src*="statistics"]').count(),0);assert.deepEqual(errors,[]);
},{path:'/advisor-edit.html#share=not-a-permission'}));

test('editor previews selected before/after text and cancellation does not write; one confirmed revision clears its grant',()=>withEditor(async page=>{
  await read(page);assert.equal(await page.locator('#editSubmitBtn').isDisabled(),true);await change(page,'<script>新建议</script>');assert.match(await page.locator('#editChangesPreview').textContent(),/<script>原建议<\/script>/);
  assert.equal(await page.locator('#editChangesPreview script').count(),0);page.once('dialog',d=>d.dismiss());await page.locator('#editSubmitBtn').click();assert.equal(await page.evaluate(()=>__editTest.calls.filter(v=>v[0]==='apply').length),0);
  page.once('dialog',d=>d.accept());await page.locator('#editSubmitBtn').click();await page.waitForFunction(()=>__editTest.calls.some(v=>v[0]==='apply'));
  assert.deepEqual(await page.evaluate(()=>__editTest.calls.find(v=>v[0]==='apply')),['apply','grant-one',4,{summary:'<script>新建议</script>'}]);assert.equal(await page.locator('#editReport').textContent(),'');assert.equal(await page.locator('#editFields').textContent(),'');assert.match(await page.locator('#editStatus').textContent(),/重新授权|重授/);
}));

test('changing text or checked sections invalidates the old preview and blank or oversized edits cannot submit',()=>withEditor(async page=>{
  await read(page);await change(page);await page.locator('[data-edit-section="summary"]').fill('不同的新建议');assert.equal(await page.locator('#editSubmitBtn').isDisabled(),true);assert.equal(await page.locator('#editChangesPreview').isHidden(),true);
  await page.locator('[data-edit-section="summary"]').fill(' '.repeat(3));await page.locator('#editPreviewChangesBtn').click();assert.equal(await page.locator('#editSubmitBtn').isDisabled(),true);
  await page.locator('[data-edit-section="summary"]').evaluate(e=>{e.value='x'.repeat(4001);e.dispatchEvent(new Event('input',{bubbles:true}))});await page.locator('#editPreviewChangesBtn').click();assert.equal(await page.locator('#editSubmitBtn').isDisabled(),true);
  await change(page);await page.locator('[data-edit-select="summary"]').uncheck();assert.equal(await page.locator('#editSubmitBtn').isDisabled(),true);assert.equal(await page.evaluate(()=>__editTest.calls.some(v=>v[0]==='apply')),false);
}));

test('uncertain write response retains only typed copyable drafts and cannot retry without a new explicit read',()=>withEditor(async page=>{
  await read(page);await change(page,'本人未确认是否保存的文字');await page.evaluate(()=>__editTest.flags.applyNetwork=true);page.once('dialog',d=>d.accept());await page.locator('#editSubmitBtn').click();
  await page.waitForFunction(()=>/未确认|不能确认|无法确认/.test(document.querySelector('#editStatus').textContent));assert.equal(await page.locator('#editReport').textContent(),'');
  assert.equal(await page.locator('[data-edit-section="summary"]').inputValue(),'本人未确认是否保存的文字');assert.equal(await page.locator('[data-edit-section="summary"]').getAttribute('readonly'),'');
  assert.equal(await page.locator('#editSubmitBtn').isDisabled(),true);assert.equal(await page.locator('[data-edit-section="academic"]').count(),0);assert.equal(await page.evaluate(()=>__editTest.calls.filter(v=>v[0]==='apply').length),1);
}));

test('fresh revocation clears uncertain copy drafts as well as the original report',()=>withEditor(async page=>{
  await read(page);await change(page,'只应短暂保留的本人草稿');await page.evaluate(()=>__editTest.flags.applyNetwork=true);page.once('dialog',d=>d.accept());await page.locator('#editSubmitBtn').click();
  await page.waitForFunction(()=>/无法确认/.test(document.querySelector('#editStatus').textContent));await page.evaluate(()=>__editTest.flags.missing=true);await page.locator('#editRefreshBtn').click();
  assert.equal(await page.locator('#editFields').textContent(),'');assert.equal(await page.locator('#editReport').textContent(),'');
}));

test('local authorization expiry also removes quarantined copy drafts without polling',()=>withEditor(async page=>{
  await page.evaluate(()=>__editTest.grant.expires_at=Math.floor(Date.now()/1000)+4);await read(page);await change(page,'到期必须清除的本人草稿');await page.evaluate(()=>__editTest.flags.applyNetwork=true);page.once('dialog',d=>d.accept());await page.locator('#editSubmitBtn').click();
  await page.waitForFunction(()=>/无法确认/.test(document.querySelector('#editStatus').textContent));const calls=await page.evaluate(()=>__editTest.calls.length);
  await page.waitForFunction(()=>document.querySelector('#editFields').textContent==='',undefined,{timeout:5000});assert.equal(await page.evaluate(()=>__editTest.calls.length),calls);
}));

test('revoked list, source conflict and old versions clear all original and typed private content',()=>withEditor(async page=>{
  await read(page);await change(page);await page.evaluate(()=>__editTest.flags.conflict=true);page.once('dialog',d=>d.accept());await page.locator('#editSubmitBtn').click();
  await page.waitForFunction(()=>document.querySelector('#editReport').textContent==='');assert.equal(await page.locator('#editFields').textContent(),'');
  await page.evaluate(()=>{__editTest.flags.conflict=false;__editTest.flags.old=true});await page.locator('[data-edit-read="grant-one"]').click();assert.match(await page.locator('#editStatus').textContent(),/版本|复核/);assert.equal(await page.locator('#editReport').textContent(),'');
  await page.evaluate(()=>__editTest.flags.old=false);await page.locator('[data-edit-read="grant-one"]').click();await page.locator('#editReport .paper').waitFor();await change(page);await page.evaluate(()=>__editTest.flags.missing=true);await page.locator('#editRefreshBtn').click();assert.equal(await page.locator('#editFields').textContent(),'');
}));

test('refreshing lists never cancels local expiry and no background requests occur on expiration',()=>withEditor(async page=>{
  await page.evaluate(()=>__editTest.grant.expires_at=Math.floor(Date.now()/1000)+4);await read(page);await change(page);await page.locator('#editRefreshBtn').click();const calls=await page.evaluate(()=>__editTest.calls.length);
  await page.waitForFunction(()=>document.querySelector('#editReport').textContent==='',undefined,{timeout:5000});assert.equal(await page.locator('#editFields').textContent(),'');assert.equal(await page.evaluate(()=>__editTest.calls.length),calls);
}));

test('disconnect or pagehide prevents late reads and writes from reviving another account',()=>withEditor(async page=>{
  await login(page);await page.locator('#editRefreshBtn').click();await page.evaluate(()=>__editTest.flags.delay=true);await page.locator('[data-edit-read="grant-one"]').click();await page.waitForFunction(()=>typeof __editTest.resolveRead==='function');
  await page.locator('#editDisconnectBtn').click();await page.evaluate(()=>__editTest.resolveRead());assert.equal(await page.locator('#editReport').textContent(),'');assert.equal(await page.locator('#editFields').textContent(),'');
  await page.evaluate(()=>__editTest.flags.delay=false);await read(page);await change(page);await page.evaluate(()=>__editTest.flags.applyDelay=true);page.once('dialog',d=>d.accept());await page.locator('#editSubmitBtn').click();await page.waitForFunction(()=>typeof __editTest.resolveApply==='function');
  await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));__editTest.resolveApply();window.dispatchEvent(new Event('pageshow'))});assert.equal(await page.locator('#editFields').textContent(),'');assert.equal(await page.locator('#editWorkspace').isHidden(),true);
}));

test('student roles and cookie identity changes cannot show an editable student report',()=>withEditor(async page=>{
  await page.evaluate(()=>__editTest.flags.student=true);await login(page);await page.locator('#editRefreshBtn').click();assert.equal(await page.locator('#editReport').textContent(),'');await page.locator('#editDisconnectBtn').click();
  await page.evaluate(()=>{__editTest.flags.student=false;__editTest.flags.denied=true});await login(page);await page.locator('#editRefreshBtn').click();assert.equal(await page.locator('#editFields').textContent(),'');assert.equal(await page.locator('#editWorkspace').isHidden(),true);
}));

test('four-section editor and preview fit a 375px viewport',()=>withEditor(async page=>{
  await read(page);await change(page,'x'.repeat(4000));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
},{viewport:{width:375,height:812}}));
