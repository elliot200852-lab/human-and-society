/* toolbar.js — 人與社會｜教師社團 · 右下角浮動「分享 / 重新整理」小工具列
 *
 * 為什麼存在：截圖那排（分享/重新整理/羅盤）是「瀏覽器自己的原生工具列」
 * （LINE 內建瀏覽器 / Safari），網站無法直接叫它出來、每支瀏覽器也不一定跑得出來。
 * 本工具列由網站自己畫，所有瀏覽器（含 LINE 內建）都穩定可用。
 *
 * - 分享：navigator.share()（iOS / LINE 內建瀏覽器會跳出原生分享面板）；
 *         不支援時退回「複製連結」並顯示小提示。
 * - 重新整理：location.reload()。
 *
 * 自帶 <style>，可獨立運作 —— 每篇文章頁不載入 styles.css 也能用
 * （故文章 standalone HTML 會把本檔內容 inline 注入）。
 *
 * 行為：閒置時淡到半透明（仍可點，分享鈕隨時在）、捲動/觸碰時全亮，永不消失。
 * 位置固定右下。
 */
(function () {
  if (window.__hsShareBar) return;
  window.__hsShareBar = true;

  var MARKER = 'data-hs-sharebar';

  function injectStyle() {
    if (document.querySelector('style[' + MARKER + ']')) return;
    var css =
      '.hs-sharebar{position:fixed;z-index:99998;right:16px;' +
      'bottom:calc(env(safe-area-inset-bottom,0px) + 16px);' +
      'display:flex;align-items:center;' +
      'background:rgba(245,240,230,.82);border:1px solid rgba(61,77,104,.20);' +
      'border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.08);' +
      '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
      'opacity:.5;transition:opacity .3s ease;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","PingFang TC",sans-serif;}' +
      '.hs-sharebar.is-active,.hs-sharebar:hover{opacity:1;}' +
      '.hs-sharebar button{-webkit-appearance:none;appearance:none;border:0;background:none;' +
      'cursor:pointer;width:46px;height:46px;display:flex;align-items:center;justify-content:center;' +
      'color:#3d4d68;padding:0;border-radius:999px;transition:color .15s ease,background .15s ease;}' +
      '.hs-sharebar button:hover{color:#2c3a52;background:rgba(61,77,104,.08);}' +
      '.hs-sharebar button:active{background:rgba(61,77,104,.16);}' +
      '.hs-sharebar .sb-div{width:1px;height:22px;background:rgba(61,77,104,.24);}' +
      '.hs-sharebar svg{width:21px;height:21px;display:block;}' +
      '.hs-sharebar .sb-toast{position:absolute;bottom:54px;right:0;max-width:70vw;white-space:nowrap;' +
      'overflow:hidden;text-overflow:ellipsis;' +
      'background:rgba(44,58,82,.94);color:#fdfcf7;font-size:12.5px;padding:6px 11px;border-radius:7px;' +
      'opacity:0;transform:translateY(4px);transition:opacity .2s ease,transform .2s ease;pointer-events:none;}' +
      '.hs-sharebar .sb-toast.show{opacity:1;transform:translateY(0);}' +
      '@media print{.hs-sharebar{display:none !important;}}';
    var st = document.createElement('style');
    st.setAttribute(MARKER, '');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // iOS 風格分享圖示（方框＋向上箭頭）
  var SHARE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>';
  // 重新整理圖示（環狀箭頭）
  var REFRESH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';

  function build() {
    if (document.querySelector('.hs-sharebar')) return;
    injectStyle();

    var bar = document.createElement('div');
    bar.className = 'hs-sharebar';
    bar.setAttribute(MARKER, '');

    var shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.setAttribute('aria-label', '分享這一頁');
    shareBtn.title = '分享';
    shareBtn.innerHTML = SHARE_SVG;

    var divider = document.createElement('div');
    divider.className = 'sb-div';

    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.setAttribute('aria-label', '重新整理');
    refreshBtn.title = '重新整理';
    refreshBtn.innerHTML = REFRESH_SVG;

    var toast = document.createElement('div');
    toast.className = 'sb-toast';

    bar.appendChild(shareBtn);
    bar.appendChild(divider);
    bar.appendChild(refreshBtn);
    bar.appendChild(toast);
    document.body.appendChild(bar);

    var toastTimer = null;
    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1800);
    }

    shareBtn.addEventListener('click', function () {
      var data = { title: document.title || '人與社會｜教師社團', url: location.href };
      if (navigator.share) {
        navigator.share(data).catch(function () { /* 使用者取消，忽略 */ });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(location.href)
          .then(function () { showToast('已複製連結'); })
          .catch(function () { showToast(location.href); });
      } else {
        showToast(location.href);
      }
    });

    refreshBtn.addEventListener('click', function () { location.reload(); });

    // 閒置半透明、捲動/觸碰時全亮（永不消失，分享鈕隨時可點）
    var idleTimer = null;
    function activate() {
      bar.classList.add('is-active');
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { bar.classList.remove('is-active'); }, 2200);
    }
    // capture:true → 連文章頁裡 overflow:auto 的內層容器捲動也算
    document.addEventListener('scroll', activate, { passive: true, capture: true });
    document.addEventListener('touchstart', activate, { passive: true });
    activate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
