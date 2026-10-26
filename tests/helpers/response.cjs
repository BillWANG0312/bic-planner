'use strict';
// Headless Chromium occasionally drops the CDP network stream for a response that already arrived (the
// page's own fetch reads it fine), so neither page.waitForResponse(...).json() nor a page.on('response')
// read is reliable there. The status does arrive with the event, so the status is taken from the page
// and the body is read again through a request context -- the same session-cookie connection a reload
// would use.
// The reread is the same request when it targets the same path (the status must then agree); a reread
// that follows a list to the record it links answers 200 by design, so only the page's status is kept.
async function actionResponse(page, predicate, action, reread) {
  const pending = page.waitForResponse(predicate);
  await action();
  const actual = await pending;
  const response = await reread();
  if (new URL(response.url()).pathname === new URL(actual.url()).pathname && response.status() !== actual.status())
    throw new Error(`The page saw ${actual.status()} but the reread saw ${response.status()}.`);
  return { status: actual.status(), value: response.ok() ? await response.json() : null };
}
// The body of a creation response read from the page's own session instead: once the status is known,
// the record that was just created is the newest one on its list.
async function readNewest(context, listPath, itemPath, headers = {}) {
  const listed = await context.request.get(listPath, { headers });
  if (listed.status() !== 200) return listed;
  const id = (await listed.json()).items[0].id;
  return context.request.get(typeof itemPath === 'string' ? itemPath + id : itemPath(id), { headers });
}
module.exports = { actionResponse, readNewest };
