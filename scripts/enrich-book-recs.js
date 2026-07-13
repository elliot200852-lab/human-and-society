/**
 * enrich-book-recs.js — 人與社會｜推薦書單 · Firestore enrichment 批次腳本
 *
 * 讀 Firestore `hs-book-recs`（使用者前端提交的書單候選），對每一筆「尚未 enrich」的
 * 文件（沒有 enrichedAt 欄位）補上：
 *   - 書目資料（title/author/publisher/publishedDate/isbn13/description）── Google Books API
 *   - 博客來購買連結（用 ISBN 搜尋頁抓第一個實體書商品 id；抓不到降階用書名搜尋頁）
 *   - 宜蘭縣立圖書館借閱連結（用「清乾淨」的主書名查詢，絕不用 ISBN）
 * 寫回：`enriched` map + `enrichStatus`('ok'|'partial'|'failed') + `enrichNotes`(string[]) + `enrichedAt`。
 * 用 Firestore REST API 的 PATCH + updateMask，只 patch 這 4 個欄位，不覆蓋使用者原始欄位。
 *
 * 認證：沿用 build-index.js 同一套（googleapis 的 google.auth.GoogleAuth），
 * 不加新依賴。憑證來自 env FIRESTORE_SA_KEY（SA key JSON 字串）。
 *
 * 無 FIRESTORE_SA_KEY → console.log 說明後 exit 0（graceful，跟 build-index 同哲學，不擋 CI）。
 * 單筆處理失敗不中斷整批（try/catch per doc；失敗也寫回 enrichStatus='failed' 免得每天重抓）。
 * 每筆之間 sleep 1s（禮貌限速，避免對 books.com.tw / 圖書館 / Google Books 太密集）。
 */

const PROJECT_ID = 'mywork-teaching-tools';
const FIRESTORE_DOCS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Firestore REST value 轉換 ─────────────────────────────────
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

function jsToFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(jsToFsValue) } };
  if (typeof v === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, vv]) => [k, jsToFsValue(vv)])) } };
  }
  return { stringValue: String(v) };
}

// ─── Auth（沿用 build-index.js 同一套 googleapis GoogleAuth，不加新依賴）──
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

// ─── Firestore REST：list + patch ─────────────────────────────
// 用「撈全部再在程式裡過濾沒 enrichedAt 的」而非 missing-field 查詢——量小，這樣最穩。
async function listAllDocs(token) {
  const docs = [];
  let pageToken;
  do {
    const url = new URL(`${FIRESTORE_DOCS_BASE}/hs-book-recs`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Firestore 讀取 hs-book-recs 失敗：${res.status} ${await res.text()}`);
    const json = await res.json();
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return docs;
}

async function patchDoc(token, docName, patchFields, maskPaths) {
  const url = new URL(`https://firestore.googleapis.com/v1/${docName}`);
  for (const p of maskPaths) url.searchParams.append('updateMask.fieldPaths', p);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: patchFields }),
  });
  if (!res.ok) throw new Error(`Firestore patch 失敗：${res.status} ${await res.text()}`);
  return res.json();
}

// ─── HTTP fetch 小工具（帶瀏覽器 UA + timeout）──────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      ...(options.headers || {}),
    },
  });
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// 從 HTML 抽 <title> 或 og:title 當查詢詞；並去掉常見「｜站名」「| 站名」尾綴
function extractPageTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  let raw = og ? og[1] : null;
  if (!raw) {
    const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    raw = t ? t[1] : null;
  }
  if (!raw) return null;
  let title = decodeEntities(raw);
  // 站名分隔常見符號：｜ | - – — ，取第一段（保守：只切一次）
  const sepMatch = title.match(/^(.*?)\s*[｜|–—]\s*.+$/);
  if (sepMatch && sepMatch[1].trim().length >= 2) title = sepMatch[1].trim();
  return title || null;
}

// ─── Google Books 查詢（一定帶 country=TW，否則 GH Actions 美國機房 IP 會 403）──
function buildIntitleAuthorQ(title, author) {
  const titlePart = encodeURIComponent(`intitle:"${title}"`);
  if (!author) return titlePart;
  const authorPart = encodeURIComponent(`inauthor:"${author}"`);
  return `${titlePart}+${authorPart}`;
}

function pickBestVolume(items) {
  let best = null;
  let bestScore = -1;
  for (const it of items) {
    const vi = it.volumeInfo || {};
    let score = 0;
    const ids = vi.industryIdentifiers || [];
    if (ids.some((x) => x.type === 'ISBN_13')) score += 2;
    if (vi.language === 'zh-TW') score += 2;
    else if (vi.language && vi.language.startsWith('zh')) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best;
}

async function searchGoogleBooks(title, author, notes) {
  const attempts = [];
  if (author) attempts.push({ label: 'intitle+inauthor', qEncoded: buildIntitleAuthorQ(title, author) });
  attempts.push({ label: 'intitle only', qEncoded: buildIntitleAuthorQ(title, '') });
  attempts.push({ label: '純 q（純書名，無 intitle）', qEncoded: encodeURIComponent(title) });

  for (const attempt of attempts) {
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${attempt.qEncoded}&country=TW&maxResults=5`;
      const res = await fetchWithTimeout(url, {}, 10000);
      if (!res.ok) {
        notes.push(`Google Books（${attempt.label}）HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      if (json.items && json.items.length) {
        const best = pickBestVolume(json.items);
        if (best) return best;
      }
    } catch (e) {
      notes.push(`Google Books（${attempt.label}）例外：${e.message}`);
    }
  }
  return null;
}

// ─── 博客來購買連結：搜尋頁不擋 curl，商品頁才擋——只 fetch 搜尋頁 ──────
// item id 規則：10 碼數字、開頭 0（排除 E 開頭的電子書 id，數字 regex 天然排除）。
async function findBooksComTwUrl(isbn13, title, notes) {
  if (isbn13) {
    try {
      const res = await fetchWithTimeout(`https://search.books.com.tw/search/query/key/${isbn13}/`, {}, 10000);
      if (res.ok) {
        const html = await res.text();
        const m = html.match(/item\/(0\d{9})/);
        if (m) return { url: `https://www.books.com.tw/products/${m[1]}`, fallback: false };
        notes.push('博客來 ISBN 搜尋頁未抓到商品 id，改用書名搜尋頁');
      } else {
        notes.push(`博客來 ISBN 搜尋頁 HTTP ${res.status}，改用書名搜尋頁`);
      }
    } catch (e) {
      notes.push(`博客來 ISBN 搜尋失敗（${e.message}），改用書名搜尋頁`);
    }
  }
  if (title) {
    return {
      url: `https://search.books.com.tw/search/query/key/${encodeURIComponent(title)}/`,
      fallback: true,
    };
  }
  notes.push('無書名可用於博客來搜尋');
  return { url: '', fallback: true };
}

// ─── 宜蘭縣立圖書館借閱連結：只用書名查，絕不用 ISBN（既有 playbook 實測結論）──
// 乾淨主書名：去掉【】內容、（）內容、冒號後副標——保守只切第一個【或（或冒號之前。
function cleanMainTitle(title) {
  if (!title) return '';
  const markers = ['【', '（', '(', '：', ':'];
  let idx = -1;
  for (const m of markers) {
    const i = title.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  const cut = idx === -1 ? title : title.slice(0, idx);
  return cut.trim();
}

function buildLibraryUrl(title) {
  const clean = cleanMainTitle(title);
  if (!clean) return '';
  return `https://webpac.ilccb.gov.tw/search?searchField=FullText&searchInput=${encodeURIComponent(clean)}`;
}

// ─── 單筆 enrichment ────────────────────────────────────────────
async function enrichOne(data) {
  const notes = [];
  let queryTitle = String(data.title || '').trim();
  const userAuthor = String(data.author || '').trim();

  if (data.url) {
    try {
      const res = await fetchWithTimeout(data.url, {}, 10000);
      if (res.ok) {
        const html = await res.text();
        const pageTitle = extractPageTitle(html);
        if (pageTitle) {
          queryTitle = pageTitle;
        } else {
          notes.push('URL 頁面無法擷取標題（無 <title>/og:title），改用使用者填寫欄位');
        }
      } else {
        notes.push(`URL 抓取失敗（HTTP ${res.status}，可能被擋如 403），改用使用者填寫欄位`);
      }
    } catch (e) {
      notes.push(`URL 抓取例外（${e.message}），改用使用者填寫欄位`);
    }
  }

  if (!queryTitle) {
    notes.push('缺少可用書名，無法 enrichment');
    return {
      status: 'failed',
      notes,
      enriched: {
        title: '', author: userAuthor, publisher: '', publishedDate: '',
        isbn13: '', description: '', booksUrl: '', libraryUrl: '',
      },
    };
  }

  const volume = await searchGoogleBooks(queryTitle, userAuthor, notes);
  if (!volume) notes.push('Google Books 查無符合結果（含降階重試）');
  const vi = volume ? (volume.volumeInfo || {}) : {};
  const isbnEntry = (vi.industryIdentifiers || []).find((x) => x.type === 'ISBN_13');

  const enriched = {
    title: vi.title || queryTitle,
    author: (vi.authors && vi.authors.length ? vi.authors.join('、') : userAuthor) || '',
    publisher: vi.publisher || '',
    publishedDate: vi.publishedDate || '',
    isbn13: isbnEntry ? isbnEntry.identifier : '',
    description: vi.description || '',
    booksUrl: '',
    libraryUrl: '',
  };

  const booksResult = await findBooksComTwUrl(enriched.isbn13, enriched.title, notes);
  enriched.booksUrl = booksResult.url;

  enriched.libraryUrl = buildLibraryUrl(enriched.title);
  if (!enriched.libraryUrl) notes.push('無法組出圖書館查詢連結');

  // ok = 全齊；description 缺或博客來 fallback（或完全查無 Google Books 結果）= partial
  let status = 'ok';
  if (!volume || !enriched.publisher || !enriched.publishedDate || !enriched.isbn13
    || !enriched.description || booksResult.fallback) {
    status = 'partial';
  }

  return { status, notes, enriched };
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const raw = process.env.FIRESTORE_SA_KEY;
  if (!raw) {
    console.log('ℹ️  未提供 FIRESTORE_SA_KEY，略過書單 enrichment（graceful skip，不擋 CI）。');
    process.exit(0);
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    console.log(`ℹ️  FIRESTORE_SA_KEY 不是合法 JSON，略過書單 enrichment：${e.message}`);
    process.exit(0);
  }

  console.log('☁️  連線 Firestore（mywork-teaching-tools）...');
  const token = await getAccessToken(credentials);

  console.log('📚 讀取 hs-book-recs...');
  const docs = await listAllDocs(token);
  const pending = docs.filter((d) => !(d.fields && d.fields.enrichedAt));
  console.log(`   共 ${docs.length} 筆，待 enrich ${pending.length} 筆`);

  let ok = 0, partial = 0, failed = 0;
  for (const doc of pending) {
    const data = fsToJs(doc.fields);
    const label = data.title || data.url || doc.name;
    try {
      const result = await enrichOne(data);
      await patchDoc(token, doc.name, {
        enriched: jsToFsValue(result.enriched),
        enrichStatus: jsToFsValue(result.status),
        enrichNotes: jsToFsValue(result.notes),
        enrichedAt: jsToFsValue(new Date()),
      }, ['enriched', 'enrichStatus', 'enrichNotes', 'enrichedAt']);
      if (result.status === 'ok') ok++;
      else if (result.status === 'partial') partial++;
      else failed++;
      console.log(`   [${result.status}] ${label}`);
    } catch (e) {
      failed++;
      console.error(`   ⚠️  處理失敗：${label} — ${e.message}`);
      try {
        await patchDoc(token, doc.name, {
          enriched: jsToFsValue({
            title: '', author: '', publisher: '', publishedDate: '',
            isbn13: '', description: '', booksUrl: '', libraryUrl: '',
          }),
          enrichStatus: jsToFsValue('failed'),
          enrichNotes: jsToFsValue([`處理例外：${e.message}`]),
          enrichedAt: jsToFsValue(new Date()),
        }, ['enriched', 'enrichStatus', 'enrichNotes', 'enrichedAt']);
      } catch (e2) {
        console.error(`   ⚠️  寫回 failed 狀態也失敗：${label} — ${e2.message}`);
      }
    }
    await sleep(1000);
  }

  console.log(`\n✓ Enrichment 完成：處理 ${pending.length} 筆（ok ${ok} / partial ${partial} / failed ${failed}）`);
}

main().catch((err) => {
  console.error('enrich-book-recs failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
