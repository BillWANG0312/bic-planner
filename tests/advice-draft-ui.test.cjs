const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');

function fixture() {
  const w = loadReportScripts(), value = state(w);
  value.info.name = '不得发送的姓名'; value.report = w.generateReport(value);
  value.report.meta.batchId = 'PRIVATE-BATCH'; return value;
}
const fakeApp = `
(function(){
  let raw=null,epoch=0,busy=false;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const store=ReportStore.create({getItem:()=>raw,setItem:(_,v)=>raw=v});
  const record=store.save(window.__draftState).record;
  const full={id:'server-one',revision:4,record};
  const calls=[],saved=[],flags={};
  const client={user:{username:'advisor.local'},async createAdviceDraft(id,revision,context,fallback){
    calls.push(['generate',id,revision,clone(context),clone(fallback)]);
    if(flags.delay)await new Promise(resolve=>window.__adviceTest.resolve=resolve);
    if(flags.failGenerate)throw new Error('草稿服务不可用');
    const now=Math.floor(Date.now()/1000);
    return {id:'11111111-1111-4111-8111-111111111111',report_id:id,source_revision:revision,created_at:now-1,expires_at:flags.expired?now-1:now+899,
      kind:flags.fallback?'rule':'local_mock',generator:'local-demo-v1',reason:flags.fallback?'disabled':'generated',before:clone(fallback),sections:flags.whitespaceOnly?Object.fromEntries(Object.entries(fallback).map(([key,value])=>[key,' \\n'+value+'\\u00a0'])):flags.fallback?clone(fallback):{...clone(fallback),summary:'<img src=x onerror=alert(1)>待核对结论'}};
  },async applyAdviceDraft(id,draftId,sections,reviewer){calls.push(['apply',id,draftId,clone(sections),reviewer]);
    if(flags.conflict)throw Object.assign(new Error('源修订已变化'),{status:409,code:'REVISION'});
    if(flags.network)throw Object.assign(new Error('连接中断'),{code:'NETWORK'});
    return {...clone(full),revision:flags.wrongRevision?4:5};
  }};
  const message=(text,error=false)=>{document.querySelector('#cloudStatus').textContent=text;document.querySelector('#cloudStatus').classList.toggle('is-error',error);};
  let ui;
  async function run(label,fn){if(busy)return;busy=true;ui.setBusy(true);const own=epoch;message(label);
    try{await fn(()=>own===epoch);}catch(error){if(own===epoch)message(error.message,true);}
    finally{busy=false;ui.setBusy(false);}}
  ui=AdviceDraft.init({client,run,message,onSaved(result){saved.push(clone(result));epoch++;ui.setReport(result);}});
  window.__adviceTest={calls,saved,flags,full,ui,leave(){epoch++;ui.clear();},reset(){epoch++;ui.setReport(full);}};
  document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id==='screen-cloud'));
  document.querySelector('#cloudWorkspace').hidden=false;document.querySelector('#cloudDetail').hidden=false;ui.setReport(full);
})();`;
function setup(extra={}) { return {...extra,beforeLoad:page=>page.addInitScript(value=>{window.__draftState=value;},fixture()),
  prepare:context=>context.route('**/js/app.js',route=>route.fulfill({contentType:'application/javascript',body:fakeApp}))}; }
async function generate(page) {page.once('dialog',dialog=>dialog.accept());await page.locator('#adviceGenerateBtn').click();await page.locator('#advicePreview').waitFor({state:'visible'});}

test('draft input validates archive and versions while sending only numeric and enum context',()=>withPage(async page=>{
  assert.deepEqual(await page.evaluate(()=>window.__adviceTest.calls),[]);
  const value=await page.evaluate(()=>AdviceDraft.input(window.__adviceTest.full.record));
  assert.deepEqual(Object.keys(value.context).sort(),['direction_id','personality_code','personality_complete','status','subjects']);
  assert.deepEqual(Object.keys(value.context.subjects[0]).sort(),['answered','key','pct','total']);
  assert.doesNotMatch(JSON.stringify(value.context),/不得发送|PRIVATE-BATCH|answers|summary|name/);
  assert.equal(value.context.subjects.every(v=>Number.isInteger(v.answered)&&v.total===15&&(v.answered===15?Number.isInteger(v.pct):v.pct===null)),true);
  assert.equal(await page.evaluate(()=>{const r=structuredClone(window.__adviceTest.full.record);r.state.academic.answers.ph3=true;try{AdviceDraft.input(r);return false;}catch(_){return true;}}),true);
  assert.equal(await page.evaluate(()=>{const r=structuredClone(window.__adviceTest.full.record);r.bankVersion='older';try{AdviceDraft.input(r);return false;}catch(_){return true;}}),true);
},setup()));

test('generation requires confirmation and unchanged rule fallback cannot be applied',()=>withPage(async page=>{
  page.once('dialog',dialog=>{assert.match(dialog.message(),/数值|匿名/);assert.match(dialog.message(),/本校|学校/);dialog.dismiss();});
  await page.locator('#adviceGenerateBtn').click();assert.deepEqual(await page.evaluate(()=>window.__adviceTest.calls),[]);
  await page.evaluate(()=>window.__adviceTest.flags.fallback=true);await generate(page);
  assert.match(await page.locator('#draftSource').innerText(),/规则回退/);
  assert.equal(await page.locator('[data-advice-section]:checked').count(),0);
  await page.locator('#adviceReviewer').fill('核对老师');assert.equal(await page.locator('#adviceApplyBtn').isDisabled(),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('bic.report-library.v1')),null);
},setup()));

test('plain-text before/after choices need reviewer and a second revision-bound confirmation',()=>withPage(async page=>{
  await generate(page);assert.equal(await page.locator('#advicePreview img').count(),0);
  assert.match(await page.locator('[data-advice-new="summary"]').innerText(),/<img src=x/);
  assert.equal(await page.locator('[data-advice-section]:checked').count(),1);
  assert.equal(await page.locator('#adviceApplyBtn').isDisabled(),true);
  await page.locator('#adviceReviewer').fill('核对老师');
  page.once('dialog',dialog=>{assert.match(dialog.message(),/本地模拟/);assert.match(dialog.message(),/修订 4/);dialog.dismiss();});
  await page.locator('#adviceApplyBtn').click();assert.equal(await page.evaluate(()=>window.__adviceTest.saved.length),0);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#adviceApplyBtn').click();
  await page.waitForFunction(()=>window.__adviceTest.saved.length===1);
  assert.deepEqual(await page.evaluate(()=>window.__adviceTest.calls.find(c=>c[0]==='apply').slice(3)),[['summary'],'核对老师']);
  assert.equal(await page.locator('#advicePreview').isVisible(),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('bic.report-library.v1')),null);
},setup()));

test('leaving or selecting another report clears identity and delayed generation cannot revive it',()=>withPage(async page=>{
  await page.evaluate(()=>window.__adviceTest.flags.delay=true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#adviceGenerateBtn').click();
  await page.waitForFunction(()=>typeof window.__adviceTest.resolve==='function');
  await page.evaluate(()=>{window.__adviceTest.leave();window.__adviceTest.resolve();});
  await page.waitForFunction(()=>document.querySelector('#adviceGenerateBtn').disabled);
  assert.equal(await page.locator('#advicePreview').isVisible(),false);
  assert.equal(await page.locator('#adviceReviewer').inputValue(),'');
  assert.equal(await page.locator('#adviceChoices').innerText(),'');
},setup()));

test('expiry, revision conflicts and uncertain application preserve the original and require re-reading',()=>withPage(async page=>{
  await page.evaluate(()=>window.__adviceTest.flags.expired=true);await generate(page);
  assert.equal(await page.locator('#adviceReviewer').isDisabled(),true);assert.equal(await page.locator('#adviceApplyBtn').isDisabled(),true);
  assert.match(await page.locator('#cloudStatus').innerText(),/过期|失效/);
  await page.evaluate(()=>{window.__adviceTest.flags.expired=false;window.__adviceTest.flags.conflict=true;});await generate(page);
  await page.locator('#adviceReviewer').fill('核对老师');page.once('dialog',d=>d.accept());await page.locator('#adviceApplyBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  assert.match(await page.locator('#cloudStatus').innerText(),/重新读取|重读/);
  await page.evaluate(()=>{window.__adviceTest.flags.conflict=false;window.__adviceTest.flags.network=true;});await generate(page);
  await page.locator('#adviceReviewer').fill('核对老师');page.once('dialog',d=>d.accept());await page.locator('#adviceApplyBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  assert.match(await page.locator('#cloudStatus').innerText(),/历史/);
  assert.equal(await page.locator('#adviceApplyBtn').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.__adviceTest.calls.filter(c=>c[0]==='apply').length),2);
  assert.equal(await page.evaluate(()=>window.__adviceTest.saved.length),0);
},setup()));

test('draft review remains within a 375px viewport with readable old and new text',()=>withPage(async page=>{
  await generate(page);
  assert.equal(await page.locator('[data-advice-old]').count(),4);
  assert.equal(await page.locator('[data-advice-new]').count(),4);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
},setup({viewport:{width:375,height:812}})));

test('discarding a preview or a failed generation preserves all original advice without another request',()=>withPage(async page=>{
  await generate(page);
  await page.locator('#adviceReviewer').fill('核对老师');await page.locator('#adviceDiscardBtn').click();
  assert.equal(await page.locator('#advicePreview').isVisible(),false);
  assert.equal(await page.locator('#adviceReviewer').inputValue(),'');
  assert.equal(await page.evaluate(()=>window.__adviceTest.calls.length),1);
  await page.evaluate(()=>window.__adviceTest.flags.failGenerate=true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#adviceGenerateBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  assert.equal(await page.locator('#advicePreview').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__adviceTest.saved.length),0);
},setup()));

test('an application reply must advance exactly the reviewed source revision before it is displayed as saved',()=>withPage(async page=>{
  await page.evaluate(()=>window.__adviceTest.flags.wrongRevision=true);await generate(page);
  await page.locator('#adviceReviewer').fill('核对老师');page.once('dialog',dialog=>dialog.accept());await page.locator('#adviceApplyBtn').click();
  await page.waitForFunction(()=>document.querySelector('#cloudStatus').classList.contains('is-error'));
  assert.equal(await page.evaluate(()=>window.__adviceTest.saved.length),0);
  assert.match(await page.locator('#cloudStatus').innerText(),/重新读取.*历史/);
  assert.equal(await page.locator('#adviceApplyBtn').isDisabled(),true);
},setup()));

test('surrounding whitespace alone is unchanged advice and cannot be applied',()=>withPage(async page=>{
  await page.evaluate(()=>window.__adviceTest.flags.whitespaceOnly=true);await generate(page);
  assert.equal(await page.locator('[data-advice-section]:checked').count(),0);
  assert.equal(await page.locator('[data-advice-section]:disabled').count(),4);
  assert.match(await page.locator('#adviceChoices').innerText(),/内容未变/);
  assert.match(await page.locator('#cloudStatus').innerText(),/没有可应用的变更/);
  await page.locator('#adviceReviewer').fill('核对老师');assert.equal(await page.locator('#adviceApplyBtn').isDisabled(),true);
  const texts=await page.locator('[data-advice-new="summary"]').textContent();
  assert.equal(texts.startsWith(' \n'),true);assert.equal(texts.endsWith('\u00a0'),true);
},setup()));
