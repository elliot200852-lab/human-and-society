/**
 * build-index.js — 人與社會｜教師社團 · Drive-pull 部署管線
 *
 * 比照 David Showcase（scripts/build-index.js）的 Drive-pull 架構：
 *   1. 載入 site/data.js（curated 中繼資料：分類 folder/title/subtitle/note/accent + 每檔 desc）
 *   2. 掃描 Drive ROOT 資料夾下的分類子資料夾與其 HTML 檔案
 *      （ROOT = 「網站素材」，由 env HUMAN_AND_SOCIETY_DRIVE_FOLDER_ID 提供，不寫死）
 *   3. Merge：以 Drive 為實際真相，更新 date/size；Drive 新檔自動上架；
 *      data.js 有但 Drive 沒有 → 列 missing。
 *   4. 下載 HTML → output/files/<Drive 子夾名>/<檔名>
 *   5. 對每篇文章注入（用 marker 防重複）：
 *        (a) noindex 雙 meta（若 head 尚無 noindex 才補）
 *        (b) 留言 widget 的 css/script（../../css/comments.css、../../js/comments.js）
 *      —— 不注入 back-nav、不注入 sharebar（文章 standalone HTML 已自帶）。
 *   6. 輸出：
 *        output/index.html / category.html / styles.css / robots.txt
 *        output/js/toolbar.js、output/js/comments.js、output/css/comments.css
 *        output/data.js       ← merged 結果（重算 totalItems/totalCategories/updated）
 *        output/build-report.md ← 同步差異報告
 *
 * 無 Drive 憑證 / folder id 時 graceful：印訊息、只 build 版控靜態站、exit 0（不 fail CI）。
 * `--check`：只跑 staticChecks（不碰 Drive），供 `npm run check`。
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const REPO_ROOT  = path.resolve(__dirname, '..');
const SITE_DIR   = path.join(REPO_ROOT, 'site');
const OUTPUT_DIR = path.join(REPO_ROOT, 'output');
const FILES_DIR  = path.join(OUTPUT_DIR, 'files');
const KEY_PATH   = path.join(REPO_ROOT, 'service-account-key.json');

// ROOT 資料夾 id 由 env 提供（deploy.yml 從 vars.HUMAN_AND_SOCIETY_DRIVE_FOLDER_ID 傳入），不寫死。
const ROOT_FOLDER_ID = process.env.HUMAN_AND_SOCIETY_DRIVE_FOLDER_ID;
const CHECK_ONLY     = process.argv.includes('--check');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── 暫時性錯誤重試（比照 Showcase：收斂偶發 OAuth "Premature close"）────
// 根因：google-auth-library 向 token 端點取 SA access token 時，連線偶被
// 「提前關閉」（Premature close），屬 runner→Google 網路路徑的暫時性劣化，
// 與程式碼/套件/Node 版本無關。原本零 retry 時任一 blip 就讓整個 build exit 1，
// 每次瞬斷都浮現成整片紅 deploy。以下對暫時性網路錯誤做指數退避重試；
// 憑證類錯誤不重試。
const TRANSIENT_RE = /premature close|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|fetch failed|terminated|other side closed|request to .* failed|read ECONNRESET|503|502|500/i;

function isTransient(err) {
  const parts = [
    err && err.message, err && err.code,
    err && err.cause && err.cause.message,
    err && err.cause && err.cause.code,
  ].filter(Boolean).join(' ');
  return TRANSIENT_RE.test(parts);
}

async function withRetry(fn, label, attempts = 9) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts || !isTransient(err)) throw err;
      // 指數退避（上限 45s）+ 隨機抖動；累計約 2.5 分鐘以撐過壞時段。
      const base = Math.min(1000 * 2 ** (i - 1), 45000);
      const delay = base + Math.floor(Math.random() * 1000);
      const first = String(err.message || '').split('\n')[0];
      console.warn(`   ⚠️  ${label} 第 ${i}/${attempts} 次暫時性失敗（${first}）—— ${delay}ms 後重試`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── Auth ────────────────────────────────────────────────────
// googleapis 只在真正要拉 Drive 時才 require（--check 與 graceful 靜態路徑
// 不依賴此套件）。
async function getDriveClient() {
  const { google } = require('googleapis');
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else if (fs.existsSync(KEY_PATH)) {
    credentials = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  } else {
    throw new Error('No service account key. Set GOOGLE_SERVICE_ACCOUNT_KEY or provide service-account-key.json');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  // 預熱 token（含 retry）：把偶發的 token 端點 "Premature close" 收斂在此。
  const client = await withRetry(() => auth.getClient(), 'auth.getClient');
  await withRetry(() => client.getAccessToken(), 'OAuth token 取得');
  return google.drive({ version: 'v3', auth });
}

// ─── Drive listing ──────────────────────────────────────────
async function listSubfolders(drive, parentId) {
  const res = await withRetry(() => drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
    pageSize: 100,
  }), 'listSubfolders');
  return res.data.files || [];
}

async function listHtmlFiles(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const res = await withRetry(() => drive.files.list({
      q: `'${folderId}' in parents and mimeType='text/html' and trashed=false`,
      fields: 'nextPageToken, files(id, name, size, modifiedTime)',
      orderBy: 'name',
      pageSize: 100,
      pageToken,
    }), `listHtmlFiles(${folderId})`);
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function downloadFile(drive, fileId, destPath) {
  const res = await withRetry(() => drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  ), `downloadFile(${fileId})`);
  fs.writeFileSync(destPath, Buffer.from(res.data));
}

// ─── Helpers ─────────────────────────────────────────────────
function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatSize(bytes) {
  const n = parseInt(bytes || '0', 10);
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

// 由檔名 fallback 出標題：去 .html、去 V1/校準版 等贅字、去日期前綴、底線/連字號轉空白
function parseTitleFromFilename(filename) {
  let name = filename.replace(/\.html$/i, '');
  name = name.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '');
  name = name.replace(/[-_]*(v\d+(\.\d+)?|完整版|美化版|full|校準版|拷貝)[-_]*/gi, '');
  name = name.replace(/[-_]+/g, ' ').trim();
  return name || filename;
}

// 載入 site/data.js 並取出 META / CATEGORIES / BASE_URL
// 注意：vm context 不暴露 const 宣告，所以跑完後手動把變數推進 globalThis
function loadCuratedData() {
  const code = fs.readFileSync(path.join(SITE_DIR, 'data.js'), 'utf8');
  // 抽掉檔尾的 window.DATA expose（Node 沒有 window）
  const stripped = code.replace(/window\.DATA\s*=[\s\S]*$/, '');
  const exposeTail = `\n;Object.assign(globalThis, { META, CATEGORIES, BASE_URL });`;
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(stripped + exposeTail, sandbox);
  return {
    META: sandbox.META,
    CATEGORIES: sandbox.CATEGORIES,
    BASE_URL: sandbox.BASE_URL,
  };
}

// ─── Merge curated + drive ──────────────────────────────────
function mergeData(curated, driveData) {
  const report = { newFiles: [], missingFiles: [], unknownFolders: [], updatedFiles: 0 };

  const curatedByFolder = new Map();
  for (const cat of curated.CATEGORIES) curatedByFolder.set(cat.folder, cat);

  const driveByFolder = new Map();
  for (const f of driveData) driveByFolder.set(f.name, f.files);

  for (const cat of curated.CATEGORIES) {
    const driveFiles = driveByFolder.get(cat.folder);
    if (!driveFiles) {
      cat.items.forEach(it => report.missingFiles.push(`${cat.folder}/${it.file}`));
      continue;
    }
    const driveByName = new Map(driveFiles.map(f => [f.name, f]));

    for (const item of cat.items) {
      const df = driveByName.get(item.file);
      if (df) {
        item.date = formatDate(df.modifiedTime);
        item.size = formatSize(df.size);
        report.updatedFiles++;
        driveByName.delete(item.file);
      } else {
        report.missingFiles.push(`${cat.folder}/${item.file}`);
      }
    }

    // 剩下的就是 Drive 新增、data.js 還沒寫入的檔案 → 自動上架
    for (const [name, df] of driveByName) {
      cat.items.push({
        title: parseTitleFromFilename(name),
        date: formatDate(df.modifiedTime),
        size: formatSize(df.size),
        desc: '（待補：請至 site/data.js 為此檔案補上一句敘述）',
        file: name,
      });
      report.newFiles.push(`${cat.folder}/${name}`);
    }
  }

  for (const f of driveData) {
    if (!curatedByFolder.has(f.name) && f.files.length > 0) {
      report.unknownFolders.push(f.name);
    }
  }

  return { curated, report };
}

// ─── Output writers ─────────────────────────────────────────
function writeDataJs(curated) {
  // META 總數依實際內容重算，避免 curated data.js 的數字過期
  curated.META.totalCategories = curated.CATEGORIES.length;
  curated.META.totalItems = curated.CATEGORIES.reduce((s, c) => s + c.items.length, 0);
  const out = `// 人與社會｜教師社團 · 資料層（由 scripts/build-index.js 自動生成）
// curated 中繼資料在 site/data.js；Drive 上的 date/size 由 build 同步寫入
// 新增檔案會自動帶入（title 由檔名 parse、desc 留空待補）

const BASE_URL = ${JSON.stringify(curated.BASE_URL)};

const META = ${JSON.stringify(curated.META, null, 2)};

const CATEGORIES = ${JSON.stringify(curated.CATEGORIES, null, 2)};

// ---- Sort items within each category by date (newest first) ----
CATEGORIES.forEach(cat => {
  cat.items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  cat.latestDate = cat.items[0]?.date || '';
});

// ---- Sort categories by their most recent upload, newest first ----
CATEGORIES.sort((a, b) => {
  const d = (b.latestDate || '').localeCompare(a.latestDate || '');
  if (d !== 0) return d;
  return a.folder.localeCompare(b.folder);
});

// ---- Reassign display numerals 01..NN based on new sort order ----
CATEGORIES.forEach((cat, i) => {
  cat.num = String(i + 1).padStart(2, '0');
});

// ---- Update META.updated with the freshest item date across all categories ----
const _allDates = CATEGORIES.flatMap(c => c.items.map(i => i.date)).filter(Boolean).sort();
if (_allDates.length) {
  META.updated = _allDates[_allDates.length - 1];
}

// Helper: build encoded URL for a file
function urlFor(category, item) {
  return BASE_URL + encodeURI(category.folder + '/' + item.file);
}

// Expose to window
window.DATA = { META, CATEGORIES, urlFor };
`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'data.js'), out);
}

function writeBuildReport(report, totalCategories, totalFiles) {
  const lines = [
    '# build-index 部署報告',
    '',
    `產生於 ${new Date().toISOString()}`,
    '',
    `## 摘要`,
    `- 分類數：${totalCategories}`,
    `- 素材數：${totalFiles}`,
    `- 同步檔案數：${report.updatedFiles}`,
    `- 新增（Drive 有、curated 沒）：${report.newFiles.length}`,
    `- 缺漏（curated 有、Drive 沒）：${report.missingFiles.length}`,
    `- 未知資料夾（Drive 有、未在 data.js）：${report.unknownFolders.length}`,
    '',
  ];
  if (report.newFiles.length) {
    lines.push('## 🆕 自動加入（請至 site/data.js 補 desc）');
    report.newFiles.forEach(p => lines.push(`- \`${p}\``));
    lines.push('');
  }
  if (report.missingFiles.length) {
    lines.push('## ⚠️ 缺漏（curated 有、Drive 沒）');
    report.missingFiles.forEach(p => lines.push(`- \`${p}\``));
    lines.push('');
  }
  if (report.unknownFolders.length) {
    lines.push('## 🚫 未知資料夾（須先在 site/data.js 建中繼資料）');
    report.unknownFolders.forEach(p => lines.push(`- \`${p}\``));
    lines.push('');
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'build-report.md'), lines.join('\n'));
}

function copyStaticAssets() {
  for (const f of ['index.html', 'category.html', 'booklist.html', 'styles.css', 'robots.txt']) {
    fs.copyFileSync(path.join(SITE_DIR, f), path.join(OUTPUT_DIR, f));
  }
  // js/toolbar.js（index/category 以 <script src> 引用）＋ js/comments.js（文章頁注入）
  // ＋ js/booklist.js（推薦書單頁）＋ js/booklist-data.js（placeholder；CI 由 build-booklist.js 以 Firestore 資料覆蓋）
  fs.mkdirSync(path.join(OUTPUT_DIR, 'js'), { recursive: true });
  for (const f of ['toolbar.js', 'comments.js', 'booklist.js', 'booklist-data.js']) {
    fs.copyFileSync(path.join(SITE_DIR, 'js', f), path.join(OUTPUT_DIR, 'js', f));
  }
  // css/comments.css（文章頁注入）＋ css/booklist.css（推薦書單頁）
  fs.mkdirSync(path.join(OUTPUT_DIR, 'css'), { recursive: true });
  for (const f of ['comments.css', 'booklist.css']) {
    fs.copyFileSync(path.join(SITE_DIR, 'css', f), path.join(OUTPUT_DIR, 'css', f));
  }
}

// ─── Noindex injection ──────────────────────────────────────
// 全站 unlisted：每支文章 HTML 在 <head> 注入 robots/googlebot noindex meta，
// 搭配 robots.txt 全站 Disallow。文章 standalone HTML 通常已自帶 noindex，
// 故僅在「head 尚無 noindex」時才補（避免重複）。
const NOINDEX_MARKER = 'data-hs-noindex';
const NOINDEX_META = `
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" ${NOINDEX_MARKER}>
<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet, noimageindex" ${NOINDEX_MARKER}>`;

function injectNoindexPerFolder(folderDir) {
  let filesChanged = 0, skipped = 0, missingHead = 0;
  for (const fname of fs.readdirSync(folderDir)) {
    if (!fname.toLowerCase().endsWith('.html')) continue;
    const fp = path.join(folderDir, fname);
    const html = fs.readFileSync(fp, 'utf8');
    // 文章已自帶 noindex（或已注入過）→ 略過
    if (html.includes(NOINDEX_MARKER) || /noindex/i.test(html)) { skipped++; continue; }
    const newHtml = html.replace(/<head([^>]*)>/i, (m) => m + NOINDEX_META);
    if (newHtml === html) { missingHead++; continue; }
    fs.writeFileSync(fp, newHtml);
    filesChanged++;
  }
  return { filesChanged, skipped, missingHead };
}

// ─── Comments widget injection ──────────────────────────────
// 文章 standalone HTML 底部自帶掛載點 <section id="hs-comments" ...>；
// build 只需注入留言 widget 的 css/script（其餘 UI 由 comments.js 建）。
// 文章位於 output/files/<夾>/ 下，故用 ../../ 回到 output 根。
// 不注入 back-nav、不注入 sharebar（文章已自帶，重複會壞版）。
const COMMENTS_MARKER = 'data-hs-comments-injected';
const COMMENTS_SNIPPET = `
<link rel="stylesheet" href="../../css/comments.css" ${COMMENTS_MARKER}>
<script type="module" src="../../js/comments.js" ${COMMENTS_MARKER}></script>`;

function injectCommentsPerFolder(folderDir) {
  let filesChanged = 0, skipped = 0, missingBody = 0;
  for (const fname of fs.readdirSync(folderDir)) {
    if (!fname.toLowerCase().endsWith('.html')) continue;
    const fp = path.join(folderDir, fname);
    const html = fs.readFileSync(fp, 'utf8');
    if (html.includes(COMMENTS_MARKER)) { skipped++; continue; }
    let newHtml;
    if (/<\/body>/i.test(html)) {
      newHtml = html.replace(/<\/body>/i, (m) => COMMENTS_SNIPPET + '\n' + m);
    } else {
      newHtml = html + COMMENTS_SNIPPET;
    }
    if (newHtml === html) { missingBody++; continue; }
    fs.writeFileSync(fp, newHtml);
    filesChanged++;
  }
  return { filesChanged, skipped, missingBody };
}

// ─── Static checks（不需 Drive；供 `npm run check`）──────────
function staticChecks() {
  for (const file of ['index.html', 'category.html']) {
    const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
    assert(/noindex/.test(html), `${file} 缺少 noindex`);
    const legacyNames = ['David ' + '素材展示', ['david', 'showcase'].join('-')];
    assert(!legacyNames.some(name => html.includes(name)), `${file} 殘留舊站名稱`);
  }
  const robots = fs.readFileSync(path.join(SITE_DIR, 'robots.txt'), 'utf8');
  assert(/User-agent: \*[\s\S]*Disallow: \//.test(robots), 'robots.txt 未封鎖全站');
  // 留言 widget 靜態資產存在
  assert(fs.existsSync(path.join(SITE_DIR, 'js', 'comments.js')), 'site/js/comments.js 不存在');
  assert(fs.existsSync(path.join(SITE_DIR, 'css', 'comments.css')), 'site/css/comments.css 不存在');
  console.log('Static checks passed.');
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  staticChecks();
  if (CHECK_ONLY) return;

  // 每次都乾淨重建 output/（output/ 已 gitignore；避免舊產物殘留）
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });

  console.log('📦 載入 site/data.js（curated 中繼資料）...');
  const curated = loadCuratedData();
  console.log(`   ${curated.CATEGORIES.length} 個分類, ${curated.CATEGORIES.reduce((s,c) => s+c.items.length, 0)} 件素材`);

  const hasKey = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || fs.existsSync(KEY_PATH);
  if (!ROOT_FOLDER_ID || !hasKey) {
    // graceful：只 build 版控靜態站，不 fail CI
    console.log('ℹ️  未提供 Drive folder id（HUMAN_AND_SOCIETY_DRIVE_FOLDER_ID）或 service account key，');
    console.log('   只建置版控靜態站（不拉 Drive 文章）。');
    writeDataJs(curated);
    copyStaticAssets();
    writeBuildReport({ newFiles: [], missingFiles: [], unknownFolders: [], updatedFiles: 0 },
      curated.CATEGORIES.length, curated.CATEGORIES.reduce((s, c) => s + c.items.length, 0));
    console.log('✓ 靜態站建置完成（未含 Drive 文章）。');
    return;
  }

  console.log('☁️  連線 Google Drive...');
  const drive = await getDriveClient();

  console.log('📁 列出分類子資料夾...');
  const subfolders = await listSubfolders(drive, ROOT_FOLDER_ID);
  console.log(`   發現 ${subfolders.length} 個子資料夾`);

  console.log('📋 列出每個資料夾的 HTML 檔案...');
  const driveData = [];
  for (const folder of subfolders) {
    const files = await listHtmlFiles(drive, folder.id);
    driveData.push({ id: folder.id, name: folder.name, files });
    console.log(`   [${folder.name}] ${files.length} 檔`);
  }

  console.log('🔄 合併 curated + Drive...');
  const { curated: merged, report } = mergeData(curated, driveData);

  console.log('⬇️  下載 HTML 檔案到 output/files/...');
  for (const f of driveData) {
    const folderDir = path.join(FILES_DIR, f.name);
    fs.mkdirSync(folderDir, { recursive: true });
    for (const file of f.files) {
      const destPath = path.join(folderDir, file.name);
      const sizeMB = (parseInt(file.size || '0', 10) / 1024 / 1024).toFixed(2);
      console.log(`   ↓ ${f.name}/${file.name} (${sizeMB} MB)`);
      await downloadFile(drive, file.id, destPath);
    }
  }

  console.log('🔒 注入 noindex meta（若文章尚無）...');
  let nIdx = 0, nIdxSkip = 0;
  for (const f of driveData) {
    const r = injectNoindexPerFolder(path.join(FILES_DIR, f.name));
    nIdx += r.filesChanged; nIdxSkip += r.skipped;
  }
  console.log(`   完成：注入 ${nIdx} 檔（已有 noindex 略過 ${nIdxSkip}）`);

  console.log('💬 注入留言 widget（css/comments.css + js/comments.js）...');
  let nCmt = 0, nCmtSkip = 0, nCmtNoBody = 0;
  for (const f of driveData) {
    const r = injectCommentsPerFolder(path.join(FILES_DIR, f.name));
    nCmt += r.filesChanged; nCmtSkip += r.skipped; nCmtNoBody += r.missingBody;
  }
  console.log(`   完成：注入 ${nCmt} 檔（已存在略過 ${nCmtSkip}、無 <body> ${nCmtNoBody}）`);

  console.log('📝 產出 output/data.js + 複製靜態檔案...');
  writeDataJs(merged);
  copyStaticAssets();

  const totalFiles = merged.CATEGORIES.reduce((s, c) => s + c.items.length, 0);
  writeBuildReport(report, merged.CATEGORIES.length, totalFiles);

  console.log(`\n✓ Build 完成`);
  console.log(`   ${merged.CATEGORIES.length} 分類, ${totalFiles} 件素材`);
  if (report.newFiles.length)      console.log(`   🆕 ${report.newFiles.length} 個新檔自動上架（請補 desc）`);
  if (report.missingFiles.length)  console.log(`   ⚠️  ${report.missingFiles.length} 個檔案在 Drive 找不到`);
  if (report.unknownFolders.length) console.log(`   🚫 ${report.unknownFolders.length} 個未知資料夾被跳過`);
}

main().catch(err => {
  console.error('build-index failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
