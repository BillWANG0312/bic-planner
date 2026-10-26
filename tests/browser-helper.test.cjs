const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const helper = path.join(__dirname, 'helpers/browser.cjs');
// Real HTTP listeners run in a subprocess: leaked listeners keep that process
// alive, so a timeout observes the worker hang rather than masking it with unref.
const child = `
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const filename = process.argv[1], stage = process.argv[2], closeThrows = process.argv[3] === 'true';
const original = new Error('fixture failure: ' + stage);
let server, serverCloses = 0, contextCloses = 0;
const instrumentedHttp = { createServer(...args) { server = http.createServer(...args); server.on('close', () => serverCloses++); return server; } };
const context = { async newPage() { return { setDefaultTimeout() {}, async goto() { if (stage === 'goto') throw original; } }; },
  async close() { contextCloses++; if (closeThrows) throw new Error('secondary close failure'); } };
const browser = { async newContext() { if (stage === 'newContext') throw original; return context; } };
const moduleObject = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { __dirname: path.dirname(filename), module: moduleObject, process,
  require(name) { if (name === 'node:http') return instrumentedHttp; if (name === 'playwright') return { chromium: {} }; return require(name); } }, { filename });
(async () => {
  try {
    await moduleObject.exports.openApp(browser, {
      async prepare() { if (stage === 'prepare') throw original; },
      async beforeLoad() { if (stage === 'beforeLoad') throw original; }
    });
    throw new Error('Expected fixture failure');
  } catch (error) {
    console.log(JSON.stringify({ sameError: error === original, message: error.message, contextCloses, serverCloses, listening: server?.listening }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

function failsWithoutLeaking(stage, closeThrows = false) {
  assert.equal(fs.existsSync(helper), true);
  const result = spawnSync(process.execPath, ['-e', child, helper, stage, String(closeThrows)], { encoding: 'utf8', timeout: 2000, windowsHide: true });
  assert.equal(result.error, undefined, `${stage} child must exit naturally after cleanup; ${result.error?.code || ''} ${result.stdout.trim()}`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { sameError: true, message: 'fixture failure: ' + stage,
    contextCloses: stage === 'newContext' ? 0 : 1, serverCloses: 1, listening: false });
}

for (const stage of ['prepare', 'beforeLoad', 'goto', 'newContext']) test(`openApp preserves ${stage} failure and closes its context and real HTTP server`, () => failsWithoutLeaking(stage));
test('a context cleanup failure still closes the HTTP server and preserves the original setup error', () => failsWithoutLeaking('beforeLoad', true));
