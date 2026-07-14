// booklist.js — 人與社會｜教師社團 · 推薦書單頁面邏輯
// -----------------------------------------------------------------------------
// 三件事：
//   1. 讀 window.HS_BOOKLIST（已審核書單；build 時由排程寫入 output/js/booklist-data.js，
//      本機預覽讀 site/js/booklist-data.js 的空陣列 placeholder）→ 畫書卡列表。
//   2. 推薦表單：需 Google 登入才能送出，寫入 Firestore collection 'hs-book-recs'
//      （status:'pending'，欄位嚴格對齊資料合約：title/author/url + uid/
//      submitterName/submitterEmail/createdAt/status，交由排程整理 + David 審核）。
//   3. 管理待審區：僅 currentUser.email === ADMIN_EMAIL 時渲染與查詢
//      （非 admin 完全不對 Firestore 發這條查詢 —— 規則本來就會擋，前端也不用
//      浪費一次 permission-denied 噪音）。
//
// Firebase 專案與 comments.js 完全共用同一份 config（同一個 mywork-teaching-tools
// 專案、同一套 modular SDK 用法）。本檔獨立呼叫 initializeApp —— booklist.html
// 與文章頁不會同時載入同一個 document，不需要 named app，也不動 comments.js
// 既有邏輯一行。
// -----------------------------------------------------------------------------

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore, collection, query, where, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDCAi341wAX0lBcx7Q0lic08C7IocPeovE',
  authDomain: 'mywork-teaching-tools.firebaseapp.com',
  projectId: 'mywork-teaching-tools',
  storageBucket: 'mywork-teaching-tools.firebasestorage.app',
  messagingSenderId: '768576565127',
  appId: '1:768576565127:web:0ab0d9387df786f0f3ed22',
};

const ADMIN_EMAIL = 'elliot200852@gmail.com';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── helpers ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── 1. 公開書單列表 ──────────────────────────────────────────────────────────
renderBookList();

function renderBookList() {
  const mount = document.getElementById('hs-bl-list');
  if (!mount) return;
  const books = Array.isArray(window.HS_BOOKLIST) ? window.HS_BOOKLIST : [];

  if (!books.length) {
    mount.innerHTML = '<p class="hs-bl-empty">目前還沒有審核通過的推薦書，歡迎在下方推薦第一本。</p>';
    return;
  }

  mount.innerHTML = books.map(bookCardHtml).join('');
}

function bookCardHtml(b) {
  const metaParts = [b.author, b.publisher, b.isbn13 ? `ISBN ${b.isbn13}` : ''].filter(Boolean);
  const meta = metaParts.map(escapeHtml).join(' · ');
  const desc = b.description
    ? `<p class="hs-bl-card-desc">${escapeHtml(b.description)}</p>`
    : '<p class="hs-bl-card-desc hs-bl-card-desc--empty">摘要整理中</p>';
  const title = b.title || '（未命名書籍）';
  const chips = [
    b.booksUrl
      ? `<a class="hs-bl-chip hs-bl-chip--buy" href="${escapeHtml(b.booksUrl)}" target="_blank" rel="noopener nofollow" aria-label="博客來購買：${escapeHtml(title)}">博客來購買 ›</a>`
      : '',
    b.libraryUrl
      ? `<a class="hs-bl-chip hs-bl-chip--lib" href="${escapeHtml(b.libraryUrl)}" target="_blank" rel="noopener nofollow" aria-label="宜蘭圖書館借閱：${escapeHtml(title)}">宜蘭圖書館借閱 ›</a>`
      : '',
  ].filter(Boolean).join('');

  return `
    <article class="hs-bl-card">
      <h3 class="hs-bl-card-title">${escapeHtml(title)}</h3>
      ${meta ? `<p class="hs-bl-card-meta">${meta}</p>` : ''}
      ${desc}
      ${chips ? `<div class="hs-bl-card-chips">${chips}</div>` : ''}
      <p class="hs-bl-card-submitter">由 ${escapeHtml(b.submitterName || '匿名')} 推薦</p>
    </article>`;
}

// ─── 2 + 3. 登入態、推薦表單、管理待審區 ─────────────────────────────────────
const authMount   = document.getElementById('hs-bl-auth');
const adminMount  = document.getElementById('hs-bl-admin');
const pendingList = document.getElementById('hs-bl-pending-list');

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

let currentUser  = null;
let unsubPending = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  renderAuthBox();
  toggleAdminPanel();
});

// ── 推薦表單 ───────────────────────────────────────────────────────────────
function renderAuthBox() {
  if (!authMount) return;

  if (!currentUser) {
    authMount.innerHTML = `<button type="button" class="hs-bl-signin" id="hs-bl-signin">以 Google 帳號登入推薦</button>`;
    authMount.querySelector('#hs-bl-signin').addEventListener('click', async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        showTopLevelMsg(`登入失敗：${err.code || err.message}`, true);
      }
    });
    return;
  }

  const name = currentUser.displayName || currentUser.email || '（未命名）';
  authMount.innerHTML = `
    <div class="hs-bl-me">
      <span class="hs-bl-me-name">${escapeHtml(name)}</span>
      <button type="button" class="hs-bl-signout" id="hs-bl-signout">登出</button>
    </div>
    <form class="hs-bl-form" id="hs-bl-form" novalidate>
      <div class="hs-bl-field">
        <label for="hs-bl-title">書名</label>
        <input type="text" id="hs-bl-title" name="title" maxlength="200" placeholder="例如：橡皮擦計畫" />
      </div>
      <div class="hs-bl-field">
        <label for="hs-bl-author">作者</label>
        <input type="text" id="hs-bl-author" name="author" maxlength="100" placeholder="例如：吳曉樂" />
      </div>
      <div class="hs-bl-field">
        <label for="hs-bl-url">網路連結</label>
        <input type="url" id="hs-bl-url" name="url" maxlength="500" placeholder="貼上書店／出版社頁面連結（選填）" />
      </div>
      <div class="hs-bl-form-row">
        <button type="submit" class="hs-bl-submit-btn" id="hs-bl-submit">送出推薦</button>
      </div>
      <p class="hs-bl-msg" id="hs-bl-form-msg" role="status"></p>
    </form>`;

  authMount.querySelector('#hs-bl-signout').addEventListener('click', () => signOut(auth));

  const form = authMount.querySelector('#hs-bl-form');
  form.addEventListener('submit', handleSubmit);
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const title  = form.title.value.trim();
  const author = form.author.value.trim();
  const url    = form.url.value.trim();
  const msgEl  = form.querySelector('#hs-bl-form-msg');
  const submitBtn = form.querySelector('#hs-bl-submit');

  if (!title && !url) {
    setMsg(msgEl, '請至少填寫書名或網路連結。', true);
    return;
  }
  if (!currentUser) {
    setMsg(msgEl, '請先登入才能推薦。', true);
    return;
  }

  submitBtn.disabled = true;
  try {
    await addDoc(collection(db, 'hs-book-recs'), {
      title: title.slice(0, 200),
      author: author.slice(0, 100),
      url: url.slice(0, 500),
      uid: currentUser.uid,
      submitterName: (currentUser.displayName || currentUser.email || '匿名').slice(0, 100),
      submitterEmail: (currentUser.email || '').slice(0, 200),
      createdAt: serverTimestamp(),
      status: 'pending',
    });
    form.reset();
    setMsg(msgEl, '已收到你的推薦！整理與審核後就會出現在書單上。', false);
  } catch (err) {
    setMsg(msgEl, `送出失敗：${err.code || err.message}`, true);
  } finally {
    submitBtn.disabled = false;
  }
}

function setMsg(el, text, isErr) {
  if (!el) return;
  el.textContent = text;
  el.className = 'hs-bl-msg ' + (isErr ? 'hs-bl-msg--err' : 'hs-bl-msg--ok');
}

function showTopLevelMsg(text, isErr) {
  if (!authMount) return;
  let el = authMount.querySelector('.hs-bl-msg');
  if (!el) {
    el = document.createElement('p');
    el.className = 'hs-bl-msg';
    el.setAttribute('role', 'status');
    authMount.appendChild(el);
  }
  setMsg(el, text, isErr);
}

// ── 管理待審區（僅 admin） ────────────────────────────────────────────────
function toggleAdminPanel() {
  if (!adminMount) return;
  const isAdmin = !!currentUser && currentUser.email === ADMIN_EMAIL;

  if (!isAdmin) {
    adminMount.hidden = true;
    if (unsubPending) { unsubPending(); unsubPending = null; }
    if (pendingList) pendingList.innerHTML = '';
    return;
  }

  adminMount.hidden = false;
  if (unsubPending) return; // 已在監聽，不重複訂閱

  const q = query(collection(db, 'hs-book-recs'), where('status', '==', 'pending'));
  unsubPending = onSnapshot(q, (snap) => {
    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, data: d.data() }));
    docs.sort((a, b) => {
      const ta = a.data.createdAt && a.data.createdAt.toMillis ? a.data.createdAt.toMillis() : 0;
      const tb = b.data.createdAt && b.data.createdAt.toMillis ? b.data.createdAt.toMillis() : 0;
      return tb - ta; // 新 → 舊
    });
    renderPendingList(docs);
  }, (err) => {
    if (pendingList) {
      pendingList.innerHTML = `<li class="hs-bl-pending-empty">待審清單載入失敗：${escapeHtml(err.code || err.message)}</li>`;
    }
  });
}

function renderPendingList(docs) {
  if (!pendingList) return;
  if (!docs.length) {
    pendingList.innerHTML = '<li class="hs-bl-pending-empty">目前沒有待審的推薦。</li>';
    return;
  }
  pendingList.innerHTML = docs.map(({ id, data }) => renderPendingItem(id, data)).join('');

  pendingList.querySelectorAll('[data-action="approve"]').forEach((btn) => {
    btn.addEventListener('click', () => handleReview(btn.dataset.id, 'approved'));
  });
  pendingList.querySelectorAll('[data-action="reject"]').forEach((btn) => {
    btn.addEventListener('click', () => handleReview(btn.dataset.id, 'rejected'));
  });
}

function renderPendingItem(id, d) {
  const warn = d.enrichStatus === 'partial' || d.enrichStatus === 'failed';
  const enriched = d.enriched || {};
  const label = d.title || d.url || '此書';
  const descPreview = enriched.description
    ? escapeHtml(enriched.description).slice(0, 100) + (enriched.description.length > 100 ? '…' : '')
    : '（無）';
  const enrichedLinks = [
    enriched.booksUrl ? `<a href="${escapeHtml(enriched.booksUrl)}" target="_blank" rel="noopener nofollow">博客來 ›</a>` : '',
    enriched.libraryUrl ? `<a href="${escapeHtml(enriched.libraryUrl)}" target="_blank" rel="noopener nofollow">圖書館 ›</a>` : '',
  ].filter(Boolean).join(' ');

  return `
    <li class="hs-bl-pending-item ${warn ? 'hs-bl-pending-item--warn' : ''}" data-id="${escapeHtml(id)}">
      <div class="hs-bl-pending-col">
        <p class="hs-bl-pending-label">使用者提交</p>
        <p class="hs-bl-pending-field"><strong>書名</strong>：${escapeHtml(d.title || '（未填）')}</p>
        <p class="hs-bl-pending-field"><strong>作者</strong>：${escapeHtml(d.author || '（未填）')}</p>
        <p class="hs-bl-pending-field"><strong>連結</strong>：${d.url ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(d.url)}</a>` : '（未填）'}</p>
        <p class="hs-bl-pending-field hs-bl-pending-meta">由 ${escapeHtml(d.submitterName || '匿名')} 推薦 · ${escapeHtml(d.submitterEmail || '')}</p>
      </div>
      <div class="hs-bl-pending-col">
        <p class="hs-bl-pending-label">系統整理預覽${d.enrichStatus ? `（${escapeHtml(d.enrichStatus)}）` : ''}</p>
        <p class="hs-bl-pending-field"><strong>書名</strong>：${escapeHtml(enriched.title || '（無）')}</p>
        <p class="hs-bl-pending-field"><strong>作者</strong>：${escapeHtml(enriched.author || '（無）')}</p>
        <p class="hs-bl-pending-field"><strong>出版社</strong>：${escapeHtml(enriched.publisher || '（無）')}</p>
        <p class="hs-bl-pending-field"><strong>ISBN</strong>：${escapeHtml(enriched.isbn13 || '（無）')}</p>
        <p class="hs-bl-pending-field"><strong>摘要</strong>：${descPreview}</p>
        ${enrichedLinks ? `<p class="hs-bl-pending-field">${enrichedLinks}</p>` : ''}
        ${d.enrichNotes ? `<p class="hs-bl-pending-notes">${escapeHtml(d.enrichNotes)}</p>` : ''}
      </div>
      <div class="hs-bl-pending-actions">
        <button type="button" class="hs-bl-chip--approve" data-action="approve" data-id="${escapeHtml(id)}" aria-label="核准《${escapeHtml(label)}》">核准</button>
        <button type="button" class="hs-bl-chip--reject" data-action="reject" data-id="${escapeHtml(id)}" aria-label="退回《${escapeHtml(label)}》">退回</button>
        <p class="hs-bl-pending-status" data-status-for="${escapeHtml(id)}" role="status"></p>
      </div>
    </li>`;
}

async function handleReview(id, nextStatus) {
  const statusEl = pendingList && pendingList.querySelector(`[data-status-for="${cssEscape(id)}"]`);
  try {
    const payload = { status: nextStatus };
    if (nextStatus === 'approved') payload.approvedAt = serverTimestamp();
    await updateDoc(doc(db, 'hs-book-recs', id), payload);
    if (statusEl) {
      statusEl.textContent = nextStatus === 'approved'
        ? '已核准，明早 9:00 自動發布；要立即發布可手動跑 GitHub Actions。'
        : '已退回。';
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `操作失敗：${err.code || err.message}`;
  }
}

function cssEscape(id) {
  return (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
