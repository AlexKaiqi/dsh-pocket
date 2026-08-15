// dsh-pocket 移动端适配（经代理注入，只影响手机端；电脑端 3080 直连保持桌面版）
//
// 原理（借鉴 MIT 项目 mexiaosqwq/dsh-web-mobile，CSS 思路同源）：
// 官方 DSH 前端在 <1024px 会自动折叠侧栏（AppFrame 带 data-sidebar-collapsed）。
// 我们注入的 JS 给 AppFrame 打上 data-mobile-nav="frame" 标记，注入的 CSS 把
// 折叠态改造成「左侧抽屉」：会话区全宽、抽屉滑入、状态栏安全区适配、触控优化。
// 开关按钮（FAB）+ 遮罩由注入的 JS 动态添加，展开=移除 data-sidebar-collapsed。

export const MOBILE_CSS = `
/* ---------- 触控与安全区（手机全局） ---------- */
html, body {
  touch-action: manipulation !important;
}

/* ---------- AppFrame：抽屉布局 ---------- */
@media (max-width: 1023px) {
  [data-mobile-nav="frame"] {
    position: relative !important;
    grid-template-columns: minmax(0, 1fr) 0 0 !important;
    padding-top: env(safe-area-inset-top, 0px) !important;
  }
  /* 侧栏列 → 左侧抽屉（默认收起：移出视口） */
  [data-mobile-nav="frame"] > :first-child {
    position: absolute !important;
    inset: 0 auto 0 0 !important;
    width: max-content !important;
    max-width: 92vw !important;
    z-index: 40 !important;
    transform: translateX(-110%);
    transition: transform .28s var(--ds-ease-in-out, ease-in-out);
    background: var(--dsw-alias-bg-base, #ffffff);
    padding-top: env(safe-area-inset-top, 0px) !important;
    border-right: none !important;
  }
  /* 展开（官方移除 data-sidebar-collapsed 即抽屉滑入） */
  [data-mobile-nav="frame"]:not([data-sidebar-collapsed]) > :first-child {
    transform: none !important;
  }
  /* 桌面拖拽把手在触屏上无用 */
  [data-side="sidebar"],
  [data-side="details"] {
    display: none !important;
  }

  /* ---------- 会话正文：字号与留白 ---------- */
  [data-phase] [class$="_scrollBody"] {
    scrollbar-gutter: auto !important;
    scrollbar-width: none !important;
  }
  [data-phase] [class$="_scrollBody"]::-webkit-scrollbar {
    display: none !important;
  }
  [data-phase] [class$="_scroll"]:has(p) {
    padding-left: 20px !important;
    padding-right: 20px !important;
    font-size: 15px !important;
  }
  [data-phase] [class$="_scroll"]:has(p) p,
  [data-phase] [class$="_scroll"]:has(p) li,
  [data-phase] [class$="_scroll"]:has(p) [class*="_text_"] {
    font-size: 15px !important;
  }
  [data-phase] [class$="_actions"] {
    overflow: hidden !important;
  }

  /* ---------- 输入框底行防重叠 ---------- */
  [data-phase] [class*="_card"]:has(textarea) > :last-child {
    gap: 8px !important;
  }
  [data-phase] [class*="_card"]:has(textarea) > :last-child > :first-child > :nth-child(2) {
    flex: 0 0 auto !important;
  }
  [data-phase] [class*="_card"]:has(textarea) > :last-child > :last-child {
    flex: 1 1 auto !important;
    min-width: 0 !important;
  }

  /* ---------- 抽屉开关按钮（左上角，避开刘海） ---------- */
  [data-mobile-nav="fab"] {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 72px);
    left: 10px;
    z-index: 21;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .12));
    border-radius: 50%;
    background: var(--dsw-alias-button-floating-fill, #ffffff);
    color: var(--dsw-alias-label-primary, inherit);
    cursor: pointer;
    box-shadow: 0 2px 12px rgba(0, 0, 0, .18);
    -webkit-tap-highlight-color: transparent;
  }
  [data-mobile-nav="backdrop"] {
    position: absolute;
    inset: 0;
    z-index: 30;
    background: rgba(0, 0, 0, .45);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
}
`;

/** 注入的引导脚本：打标记 + 加开关按钮/遮罩 + 修 viewport。 */
export const MOBILE_JS = `
(function () {
  try {
    // viewport-fit=cover：让 env(safe-area-inset-*) 生效（刘海屏安全区）
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && vp.content && vp.content.indexOf('viewport-fit') === -1) {
      vp.content = vp.content + ', viewport-fit=cover';
    }
    var frame = null;
    function findFrame() {
      if (frame && document.contains(frame)) return frame;
      frame = document.querySelector('[data-shell-overlay]') ||
              document.querySelector('[data-mobile-nav="frame"]');
      if (frame && !frame.hasAttribute('data-mobile-nav')) {
        frame.setAttribute('data-mobile-nav', 'frame');
      }
      return frame;
    }
    function narrow() {
      return window.matchMedia('(max-width: 1023px)').matches;
    }
    var fab = null, backdrop = null;
    function ensureControls() {
      findFrame();
      if (!frame) return;
      if (!document.querySelector('[data-mobile-nav="fab"]')) {
        fab = document.createElement('button');
        fab.setAttribute('data-mobile-nav', 'fab');
        fab.setAttribute('aria-label', '打开目录');
        fab.innerHTML = '☰';
        frame.appendChild(fab);
        fab.addEventListener('click', function () {
          frame.removeAttribute('data-sidebar-collapsed');
          ensureBackdrop();
        });
      }
      if (narrow() && frame.hasAttribute('data-sidebar-collapsed') && !fab.dataset.shown) {
        fab.style.display = 'inline-flex';
      }
    }
    function ensureBackdrop() {
      if (backdrop && document.contains(backdrop)) return;
      backdrop = document.createElement('div');
      backdrop.setAttribute('data-mobile-nav', 'backdrop');
      frame.appendChild(backdrop);
      backdrop.addEventListener('click', function () {
        frame.setAttribute('data-sidebar-collapsed', '');
        if (backdrop) backdrop.remove();
        backdrop = null;
      });
    }
    function sync() {
      ensureControls();
      if (!frame) return;
      var open = !frame.hasAttribute('data-sidebar-collapsed') && narrow();
      if (fab) fab.style.display = open ? 'none' : (narrow() ? 'inline-flex' : 'none');
      if (open) ensureBackdrop(); else if (backdrop) { backdrop.remove(); backdrop = null; }
    }
    var mq = window.matchMedia('(max-width: 1023px)');
    mq.addEventListener('change', sync);
    // AppFrame 挂载是异步的，轮询等它出现
    var tries = 0;
    var timer = setInterval(function () {
      sync();
      if (frame && ++tries > 50) clearInterval(timer);
      if (++tries > 200) clearInterval(timer);
    }, 300);
    sync();
  } catch (e) { /* 适配失败不影响页面 */ }
})();
`;

/** 组合成注入 HTML 的片段（style + script）。 */
export function mobileInjection() {
  return `<style id="dsh-pocket-mobile">${MOBILE_CSS}</style><script>${MOBILE_JS}</script>`;
}
