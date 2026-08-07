// icons.js — meteocons Lottie 天气图标播放器。
// render.js 输出 <span class="weather-lottie" data-lottie="clear-day"> 容器，
// 本文件扫描容器并用 lottie-web（vendor/lottie.min.js，全局 lottie）加载动画；
// MutationObserver 处理查询结果重渲染后的新容器与已移除容器的销毁。
// prefers-reduced-motion：显示动画第一帧（静态）。
(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const registry = new Map(); // Element → animation 实例

  function loadIcon(el) {
    const name = el.dataset.lottie;
    if (!name || registry.has(el)) return;
    const anim = lottie.loadAnimation({
      container: el,
      path: `assets/lottie/${name}.json`,
      renderer: 'svg',
      loop: true,
      autoplay: !reduced,
    });
    if (reduced) {
      anim.addEventListener('DOMLoaded', () => { anim.goToAndStop(0, true); });
    }
    registry.set(el, anim);
  }

  function refresh() {
    // 销毁已不在文档中的实例
    registry.forEach((anim, el) => {
      if (!el.isConnected) {
        anim.destroy();
        registry.delete(el);
      }
    });
    document.querySelectorAll('.weather-lottie[data-lottie]').forEach(loadIcon);
  }

  function init() {
    if (typeof lottie === 'undefined') return; // lottie.min.js 未加载则保持空容器
    refresh();
    const mo = new MutationObserver(() => refresh());
    mo.observe(document.body, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
