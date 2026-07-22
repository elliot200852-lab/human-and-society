// 人與社會｜教師社團 · 資料層
// mirror of David Showcase data.js schema
// 檔案實際 URL 以 BASE + folder + file 組成；renderer 會 encodeURI
// META.totalItems / totalCategories 由 build 依實際內容重算，
// 此處數字僅為本地預覽參考，不需手動維護

const BASE_URL = 'https://elliot200852-lab.github.io/human-and-society/files/';

const META = {
  author: '人與社會教師社團',
  authorEn: 'Human & Society · Teacher Circle',
  school: '慈心華德福高中',
  schoolEn: 'Ci-Xin Waldorf School, Yilan',
  updated: '2026-07-12',
  totalItems: 1,
  totalCategories: 1,
  tagline: '從台灣出發，與世界建立連結',
  taglineEn: 'Human & Society',
};

const CATEGORIES = [
  {
    num: '03',
    id: 'c03',
    folder: '03_時代閱讀',
    title: '時代閱讀',
    subtitle: 'Reading the Times',
    note: '社群共讀的時事與觀點文章——讀完之後的自問自答、討論筆記與課堂延伸。接住時代的脈動，再帶回教室。',
    accent: 'var(--hs-indigo)',
    items: [
      {
        title: '我們是否變得更懂得，一起生活——讀唐鳳〈AI 與民主：拒絕被最佳化的權利〉的八個問題',
        date: '2026-07-23',
        size: '',
        desc: '從唐鳳文章中挑出八個核心問題逐題自問自答：威脅從何時開始、表達與承擔的界線、教育該培養什麼、資訊流的節奏、可課責的中介、系統的分際與可中斷、未被最佳化的生活，以及檢驗一項工具的標準。文末附原文連結。',
        file: '2026-07-23_讀唐鳳AI與民主的八個問題.html',
      },
    ],
  },
  {
    num: '02',
    id: 'c02',
    folder: '02_推薦書單',
    title: '推薦書單',
    subtitle: 'Reading Together',
    note: '社群共築的書架——推薦流程、使用方式與相關文章。書單本體在「推薦書單」頁。',
    accent: 'var(--hs-indigo)',
    items: [
      {
        title: '推薦書單，這樣用——每個人都能為社群薦一本書',
        date: '2026-07-14',
        size: '',
        desc: '推薦書單的製作流程與使用指南：怎麼推薦一本書、送出後系統與人各做了什麼、怎麼閱讀書卡與使用搜尋篩選。',
        file: '2026-07-14_推薦書單使用指南.html',
      },
    ],
  },
  {
    num: '01',
    id: 'c01',
    folder: '01_社團緣起',
    title: '社團緣起',
    subtitle: 'Where We Begin',
    note: '人與社會工作小組的成立緣起與工作願景——由台灣社會出發，與世界建立連結，並把時代的脈動帶回教室課堂。',
    accent: 'var(--hs-indigo)',
    items: [
      {
        title: '從台灣出發，與世界建立連結——「人與社會」教師社團的成立願景',
        date: '2026-07-12',
        size: '',
        desc: '人與社會工作小組的成立願景與 115–116 學年工作計畫。',
        file: '2026-07-12_人與社會教師社團成立願景.html',
      },
    ],
  },
];

// ---- Sort categories by their most recent upload, newest first ----
// When a new item is added, its category jumps to position 01.
// Tiebreaker: original folder order (deterministic).
CATEGORIES.forEach(cat => {
  const dates = cat.items.map(i => i.date).filter(Boolean).sort();
  cat.latestDate = dates.length ? dates[dates.length - 1] : '';
});
CATEGORIES.sort((a, b) => {
  const d = (b.latestDate || '').localeCompare(a.latestDate || '');
  if (d !== 0) return d;
  return a.folder.localeCompare(b.folder);
});

// ---- Reassign display numerals 01..NN based on new sort order ----
// cat.id and cat.folder stay stable (URL + file-path stability);
// only the displayed numeral updates.
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
