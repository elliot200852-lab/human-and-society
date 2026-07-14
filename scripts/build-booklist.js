/**
 * build-booklist.js — 人與社會｜推薦書單 → output/js/booklist-data.js
 *
 * 讀 Firestore `hs-book-recs` 中 `status == 'approved'` 的文件，產出靜態資料檔
 * `window.HS_BOOKLIST = [...]`，供書單頁面直接 <script> 讀取（公開頁不現場讀 Firestore）。
 *
 * 認證：沿用 build-index.js / enrich-book-recs.js 同一套 googleapis GoogleAuth，不加新依賴。
 * 無 FIRESTORE_SA_KEY → 輸出空陣列檔＋exit 0（graceful，本地 build 可跑，不擋 CI）。
 *
 * 注意執行順序（見 .github/workflows/deploy.yml）：必須排在 `npm run build`（build-index.js）
 * **之後**——build-index.js 每次都會整個重建 output/（含 rmSync），若本腳本先跑會被清掉。
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'output');
const OUTPUT_JS_DIR = path.join(OUTPUT_DIR, 'js');
const OUTPUT_FILE = path.join(OUTPUT_JS_DIR, 'booklist-data.js');

const PROJECT_ID = 'mywork-teaching-tools';

// ─── Firestore REST value 轉換（與 enrich-book-recs.js 邏輯相同，各自獨立檔案避免耦合）──
function fsValueToJs(v) {
  if (v == null) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  if (v.mapValue !== undefined) return fsToJs(v.mapValue.fields || {});
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fsValueToJs);
  return null;
}

function fsToJs(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fsValueToJs(v);
  return out;
}

async function getAccessToken(credentials) {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  return typeof tokenResp === 'string' ? tokenResp : tokenResp.token;
}

async function queryApproved(token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'hs-book-recs' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'approved' },
        },
      },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore runQuery 失敗：${res.status} ${await res.text()}`);
  const json = await res.json();
  return (Array.isArray(json) ? json : []).filter((x) => x.document).map((x) => x.document);
}

function writeEmpty(reason) {
  fs.mkdirSync(OUTPUT_JS_DIR, { recursive: true });
  const out = `// 人與社會｜推薦書單資料（由 scripts/build-booklist.js 自動生成，勿手動編輯）\n// ${reason}\nwindow.HS_BOOKLIST = [];\n`;
  fs.writeFileSync(OUTPUT_FILE, out);
  console.log(`✓ 書單輸出（空陣列）：${reason}`);
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const raw = process.env.FIRESTORE_SA_KEY;
  if (!raw) {
    writeEmpty('未提供 FIRESTORE_SA_KEY（graceful skip，不擋 CI）');
    return;
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    writeEmpty(`FIRESTORE_SA_KEY 不是合法 JSON：${e.message}`);
    return;
  }

  console.log('☁️  連線 Firestore（mywork-teaching-tools）...');
  const token = await getAccessToken(credentials);

  console.log('📚 查詢 hs-book-recs（status == approved）...');
  const docs = await queryApproved(token);

  const items = docs.map((doc) => {
    const data = fsToJs(doc.fields);
    const enriched = data.enriched || {};
    const id = doc.name.split('/').pop();
    return {
      id,
      title: enriched.title || data.title || '',
      author: enriched.author || data.author || '',
      publisher: enriched.publisher || '',
      publishedDate: enriched.publishedDate || '',
      isbn13: enriched.isbn13 || '',
      // 公開頁只放 David 審過的教育者摘要（doc 頂層 eduSummary，開工爬梳流程回寫）。
      // 出版商宣傳文（enriched.description）僅供審核參考與摘要起草素材，不上頁面；
      // eduSummary 未就緒時留空 → 前端顯示「摘要整理中」。
      description: data.eduSummary || '',
      // 分類標籤（doc 頂層 category，爬梳流程與 David 一起定；前端據此生成篩選 chips）
      category: data.category || '',
      booksUrl: enriched.booksUrl || data.url || '',
      libraryUrl: enriched.libraryUrl || '',
      submitterName: data.submitterName || '',
      approvedAt: data.approvedAt || '',
    };
  });

  // approvedAt 為 Firestore timestamp（ISO 字串），字串比較即可新→舊排序
  items.sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));

  fs.mkdirSync(OUTPUT_JS_DIR, { recursive: true });
  const out = `// 人與社會｜推薦書單資料（由 scripts/build-booklist.js 自動生成，勿手動編輯）\nwindow.HS_BOOKLIST = ${JSON.stringify(items, null, 2)};\n`;
  fs.writeFileSync(OUTPUT_FILE, out);

  console.log(`✓ 書單輸出完成：${items.length} 筆 → output/js/booklist-data.js`);
}

main().catch((err) => {
  console.error('build-booklist failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
