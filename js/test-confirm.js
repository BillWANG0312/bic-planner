/* A browser confirmation that a test page can answer without a native dialog. Pages load it before their own
   scripts; it changes nothing unless BIC_TEST_HOOKS is set, and the questions it asks are the same ones
   shown to people. An answer queued with __BIC_CONFIRM.confirmAt applies to the next confirmation only, and
   an empty queue declines, so nothing is ever approved by accident. */
(function () {
  'use strict';
  if (window.BIC_TEST_HOOKS !== 1) return;
  const answers = [], asked = [];
  window.__BIC_CONFIRM = {
    asked,
    // Queues an answer for the next confirmation, and that one only.
    confirmAt: (answer, count = 1) => { for (let i = 0; i < count; i++) answers[answer ? 'push' : 'unshift'](answer); }
  };
  window.confirm = message => {
    asked.push(String(message));
    return answers.length ? answers.shift() : false;
  };
})();
