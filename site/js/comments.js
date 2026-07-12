// comments.js — 人與社會｜教師社團 · 每篇文章留言 widget
// -----------------------------------------------------------------------------
// 掛載於文章 standalone HTML 底部的 <section id="hs-comments" data-article-slug="...">。
// 讀開放（只顯示 status=='visible'）；留言需 Google 登入（存真實 email/uid）；
// 即時顯示（onSnapshot）；David（ADMIN_EMAIL）可事後軟刪（status → 'hidden'）。
// Firestore 子集合路徑：hs-comments/{slug}/messages —— 與 5A posts/.../comments 完全隔離。
//
// 安全模型（前端只是體驗，真正把關在 firestore.rules）：
//   - 未登入不能寫；登入需 google.com provider + email_verified。
//   - 寫入 authorUid 必須 == auth.uid、authorEmail 必須 == token.email。
//   - 只有 ADMIN_EMAIL 能把 status 改成 'hidden'；任何人都不能 delete。
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

function formatTime(ts) {
  // serverTimestamp() 剛送出、伺服器尚未回填時 ts 可能為 null
  const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
  if (!d) return '剛剛';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── mount ──────────────────────────────────────────────────────────────────
const root = document.getElementById('hs-comments');
if (root) initComments(root);

function initComments(mount) {
  const slug = mount.dataset.articleSlug;
  if (!slug) {
    mount.innerHTML = '<p class="hs-c-empty">（留言區設定缺少 data-article-slug）</p>';
    return;
  }

  mount.innerHTML = `
    <div class="hs-c">
      <h2 class="hs-c-title">留言</h2>
      <p class="hs-c-note">留言需 Google 登入（僅供社團同仁交流；你的姓名與 Email 會顯示給版主）。</p>
      <div class="hs-c-auth" id="hs-c-auth"></div>
      <ul class="hs-c-list" id="hs-c-list"><li class="hs-c-empty">載入中…</li></ul>
    </div>`;

  const authBox = mount.querySelector('#hs-c-auth');
  const listBox = mount.querySelector('#hs-c-list');

  let currentUser = null;
  let latestDocs = [];

  const messagesRef = collection(db, 'hs-comments', slug, 'messages');

  // ── auth UI ────────────────────────────────────────────────────────────
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    renderAuth();
    renderList(); // 重畫以更新「隱藏」鈕（admin）
  });

  function renderAuth() {
    if (!currentUser) {
      authBox.innerHTML = `<button type="button" class="hs-c-btn hs-c-signin" id="hs-c-signin">以 Google 帳號登入留言</button>`;
      authBox.querySelector('#hs-c-signin').addEventListener('click', async () => {
        try {
          await signInWithPopup(auth, provider);
        } catch (err) {
          alertInline(`登入失敗：${err.code || err.message}`);
        }
      });
      return;
    }
    const name = currentUser.displayName || currentUser.email || '（未命名）';
    authBox.innerHTML = `
      <div class="hs-c-me">
        <span class="hs-c-me-name">${escapeHtml(name)}</span>
        <button type="button" class="hs-c-link" id="hs-c-signout">登出</button>
      </div>
      <form class="hs-c-form" id="hs-c-form">
        <textarea id="hs-c-body" class="hs-c-textarea" rows="3" maxlength="1000"
          placeholder="寫下你的想法…（1–1000 字）"></textarea>
        <div class="hs-c-form-row">
          <span class="hs-c-count" id="hs-c-count">0 / 1000</span>
          <button type="submit" class="hs-c-btn" id="hs-c-submit">送出留言</button>
        </div>
      </form>`;
    authBox.querySelector('#hs-c-signout').addEventListener('click', () => signOut(auth));

    const form = authBox.querySelector('#hs-c-form');
    const body = authBox.querySelector('#hs-c-body');
    const count = authBox.querySelector('#hs-c-count');
    body.addEventListener('input', () => { count.textContent = `${body.value.length} / 1000`; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = body.value.trim();
      if (text.length < 1 || text.length > 1000) { alertInline('留言長度需為 1–1000 字。'); return; }
      const submit = form.querySelector('#hs-c-submit');
      submit.disabled = true;
      try {
        await addDoc(messagesRef, {
          authorName: (currentUser.displayName || currentUser.email || '匿名').slice(0, 40),
          authorEmail: currentUser.email,
          authorUid: currentUser.uid,
          body: text,
          status: 'visible',
          createdAt: serverTimestamp(),
        });
        body.value = '';
        count.textContent = '0 / 1000';
      } catch (err) {
        alertInline(`送出失敗：${err.code || err.message}`);
      } finally {
        submit.disabled = false;
      }
    });
  }

  function alertInline(msg) {
    let el = authBox.querySelector('.hs-c-alert');
    if (!el) {
      el = document.createElement('p');
      el.className = 'hs-c-alert';
      authBox.appendChild(el);
    }
    el.textContent = msg;
  }

  // ── live list ──────────────────────────────────────────────────────────
  // 只 where(status=='visible')（無 orderBy → 免複合索引）；前端依 createdAt 排序。
  const q = query(messagesRef, where('status', '==', 'visible'));
  onSnapshot(q, (snap) => {
    latestDocs = [];
    snap.forEach((d) => latestDocs.push({ id: d.id, ...d.data() }));
    latestDocs.sort((a, b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return ta - tb; // 舊→新
    });
    renderList();
  }, (err) => {
    listBox.innerHTML = `<li class="hs-c-empty">留言載入失敗：${escapeHtml(err.code || err.message)}</li>`;
  });

  function renderList() {
    if (!latestDocs.length) {
      listBox.innerHTML = '<li class="hs-c-empty">還沒有留言，成為第一個留言的人。</li>';
      return;
    }
    const isAdmin = !!currentUser && currentUser.email === ADMIN_EMAIL;
    listBox.innerHTML = latestDocs.map((c) => `
      <li class="hs-c-item" data-id="${escapeHtml(c.id)}">
        <div class="hs-c-item-head">
          <span class="hs-c-item-name">${escapeHtml(c.authorName || '（未命名）')}</span>
          <span class="hs-c-item-time">${escapeHtml(formatTime(c.createdAt))}</span>
        </div>
        <div class="hs-c-item-body">${escapeHtml(c.body).replace(/\n/g, '<br>')}</div>
        ${isAdmin ? `<button type="button" class="hs-c-link hs-c-hide" data-id="${escapeHtml(c.id)}">隱藏</button>` : ''}
      </li>`).join('');

    if (isAdmin) {
      listBox.querySelectorAll('.hs-c-hide').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await updateDoc(doc(db, 'hs-comments', slug, 'messages', btn.dataset.id), { status: 'hidden' });
          } catch (err) {
            btn.disabled = false;
            alertInline(`隱藏失敗：${err.code || err.message}`);
          }
        });
      });
    }
  }
}
