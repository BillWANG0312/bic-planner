/* 打印时包含逐题解析；关闭或取消打印后恢复阅读时的折叠状态。 */
(function () {
  'use strict';
  let folded = null;
  window.addEventListener('beforeprint', () => {
    if (folded) return;
    folded = Array.from(document.querySelectorAll('#reportRoot details'), element => ({ element, open: element.open }));
    folded.forEach(({ element }) => { element.open = true; });
    document.querySelectorAll('#reportRoot .score-fill').forEach(element => {
      element.style.width = (Number(element.dataset.w) || 0) + '%';
    });
  });
  window.addEventListener('afterprint', () => {
    if (!folded) return;
    folded.forEach(({ element, open }) => { element.open = open; });
    folded = null;
  });
})();
