/* tabs.js — 人與社會｜教師社團 · 共用分頁列（Tab bar）
 *
 * 一份 CATEGORIES（site/data.js）驅動全站的 Tab：順序、標題、網址都從那裡來，
 * HTML 裡不重複寫一份 Tab 清單（兩個真相源必定漂移）。
 *
 * 用法：頁面放一個 <nav id="hsTabs" data-mode="…" data-active="…"></nav>
 *   data-mode="inline"  首頁：點 Tab 不換頁，就地切換面板；
 *                       會 history.pushState 成 ?tab=<id> 並派發 'hs:tabchange' 事件。
 *   data-mode="link"    其他頁（如 booklist.html）：Tab 是連回 index.html?tab=<id> 的連結，
 *                       只有 data-active 指定的那個維持選取樣式。
 *
 * 需在 data.js 之後載入。
 */
(function () {
  var mount = document.getElementById('hsTabs');
  if (!mount || !window.DATA) return;

  var CATEGORIES = window.DATA.CATEGORIES;
  var mode = mount.getAttribute('data-mode') || 'link';

  function currentId() {
    var q = new URLSearchParams(location.search).get('tab');
    if (q && CATEGORIES.some(function (c) { return c.id === q; })) return q;
    var a = mount.getAttribute('data-active');
    if (a && CATEGORIES.some(function (c) { return c.id === a; })) return a;
    return CATEGORIES[0].id;
  }

  var active = currentId();

  function paint() {
    Array.prototype.forEach.call(mount.querySelectorAll('.hs-tab'), function (el) {
      var on = el.getAttribute('data-tab') === active;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.setAttribute('tabindex', on ? '0' : '-1');
    });
  }

  function select(id, push) {
    if (!CATEGORIES.some(function (c) { return c.id === id; })) return;
    active = id;
    paint();
    if (push !== false) {
      // file:// 本機預覽時 pushState 會丟 SecurityError —— 包起來，讓預覽照常可用
      try {
        var url = location.pathname + '?tab=' + encodeURIComponent(id);
        history.pushState({ tab: id }, '', url);
      } catch (err) { /* 本機預覽，忽略 */ }
    }
    document.dispatchEvent(new CustomEvent('hs:tabchange', { detail: { id: id } }));
  }

  mount.setAttribute('role', 'tablist');
  mount.innerHTML = CATEGORIES.map(function (cat) {
    var tag = mode === 'inline' ? 'button' : 'a';
    var attrs = mode === 'inline'
      ? 'type="button"'
      : 'href="index.html?tab=' + encodeURIComponent(cat.id) + '"';
    return '<' + tag + ' class="hs-tab" role="tab" data-tab="' + cat.id + '" ' + attrs + '>' +
             '<span class="hs-tab-label">' + escapeHtml(cat.title) + '</span>' +
             '<span class="hs-tab-sub">' + escapeHtml(cat.subtitle) + '</span>' +
           '</' + tag + '>';
  }).join('');

  if (mode === 'inline') {
    mount.addEventListener('click', function (e) {
      var btn = e.target.closest('.hs-tab');
      if (!btn) return;
      select(btn.getAttribute('data-tab'));
    });
    // 左右鍵在 Tab 之間移動（鍵盤可用性）
    mount.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var i = CATEGORIES.findIndex(function (c) { return c.id === active; });
      var n = e.key === 'ArrowRight' ? i + 1 : i - 1;
      if (n < 0) n = CATEGORIES.length - 1;
      if (n >= CATEGORIES.length) n = 0;
      select(CATEGORIES[n].id);
      var el = mount.querySelector('.hs-tab[data-tab="' + CATEGORIES[n].id + '"]');
      if (el) el.focus();
      e.preventDefault();
    });
    window.addEventListener('popstate', function () { select(currentId(), false); });
  }

  paint();
  // 首頁初次載入也要讓面板知道該畫哪一個
  if (mode === 'inline') {
    document.dispatchEvent(new CustomEvent('hs:tabchange', { detail: { id: active } }));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.HSTabs = { select: select, get active() { return active; } };
})();
