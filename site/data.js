// 人與社會｜教師社團 · 資料層
// 一個 CATEGORIES 陣列同時驅動：頁面上方的 Tab、每個 Tab 的內容面板、
// 以及 scripts/build-index.js 的 Drive 同步。改分類只改這裡。
//
// 每個分類的欄位：
//   id       穩定識別碼（網址 index.html?tab=<id> 用，永遠不要改）
//   order    Tab 由左到右的固定順序（David 2026-08-27 指定，不再依日期自動排序）
//   kind     'files' = 內容從 Drive 拉 HTML 文章；'links' = 純連結卡片，不碰 Drive
//   folder   對應 Drive 上的子資料夾名（只有 kind:'files' 才有；沒有這個欄位
//            build-index.js 就完全不會拿它去跟 Drive 比對）
//   pageLink 這個分類另有一個獨立頁面時的入口（例：推薦書單 → booklist.html）
//
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
    order: 1,
    id: 'c01',
    kind: 'files',
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
  {
    order: 2,
    id: 'c04',
    kind: 'files',
    folder: '04_工作會議',
    title: '工作會議',
    subtitle: 'Working Sessions',
    note: '社團工作會議的公開版紀錄——每次會議談定的方向、決議，以及接下來各自要做的事。完整紀錄於社團內部流通。',
    accent: 'var(--hs-indigo)',
    items: [
      {
        title: '秋季第一次工作會議紀錄',
        date: '2026-08-19',
        size: '',
        desc: '115 學年秋季第一次工作會議：定出四條可以立刻啟動的工作線——教師會每週十分鐘時事分享、週五下午共學時段、課程本土化的中期推動、文化角與圖書資源活化；並確立「在地生命故事」錄製行動。含決議八條與待辦分派。',
        file: '2026-08-19_秋季第一次工作會議紀錄.html',
      },
    ],
  },
  {
    order: 3,
    id: 'c03',
    kind: 'files',
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
    order: 4,
    id: 'c02',
    kind: 'files',
    folder: '02_推薦書單',
    title: '推薦書單',
    subtitle: 'Reading Together',
    note: '社群共築的書架——每個人都可以為社群薦一本書。書單本體（含搜尋、分類篩選與推薦表單）在下方入口。',
    accent: 'var(--hs-indigo)',
    pageLink: {
      href: 'booklist.html',
      label: '前往推薦書單',
      desc: '社群共同推薦的書籍，附教育者摘要、分類與搜尋；登入後可以推薦你想分享的一本書。',
    },
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
    order: 5,
    id: 'res',
    kind: 'links',
    // 刻意不給 folder：這一類只有連結卡片，build 不會拿它去跟 Drive 比對
    title: '資源連結',
    subtitle: 'Resources',
    note: '備課與查證時用得上的幾個資料庫，都可以直接點進去用。',
    accent: 'var(--hs-indigo)',
    links: [
      {
        title: '臺灣人文藝術資料庫',
        href: 'https://elliot200852-lab.github.io/taiwan-arts-db/',
        desc: '臺灣的美術、音樂、文學、戲劇與工藝——人物、作品與流變，依主題整理，供備課取材。',
      },
      {
        title: '認識臺灣地理資料庫',
        href: 'https://elliot200852-lab.github.io/taiwan-geo-db/',
        desc: '34 個縣市與 19 個主題頁：地形、氣候、產業、族群與交通，用地理的視角認識這座島。',
      },
      {
        title: 'Taiwan.md',
        href: 'https://taiwan.md/',
        desc: '臺灣政府公開文件的全文檢索站——查政策、統計與官方說法時，可以直接回到原文出處。',
      },
    ],
    items: [],
  },
  {
    order: 6,
    id: 'c05',
    kind: 'files',
    folder: '05_週五活動',
    title: '週五活動',
    subtitle: 'Friday Gatherings',
    note: '每週五下午的臺灣議題探討與紀錄片觀賞——一週一場，一場一張卡片。',
    accent: 'var(--hs-indigo)',
    // friday：這一季的季度說明與每週場次卡片。
    // 新增一週＝在 weeks 陣列最前面加一個物件（week／date／title／link／subtitle／
    // lines／closing 都可省略，有才顯示）。文字一律照 David 原稿逐字放，不改寫。
    friday: {
      season: '秋季',
      theme: '百年追求、自治之夢',
      when: '每週五 14:00–15:00',
      where: '紫藤樓 3 樓會議室',
      span: '本季共十週',
      intro: '我們會用短短的時間來認識你最親愛的陌生人-那許許多多以他們的心靈與生命編織成我們現在的人，一起來看，一起來聽，一起來感受，一起來思考與討論，就從了解台灣人的百年追求開始，等你來哦！',
      closing: '讓我們不再作故鄉的異鄉人，WE CARE!',
      weeks: [
        {
          week: '第三週',
          date: '2026-09-04', // 依每週五推算，David 確認後可改
          title: '進步時代－臺中文協百年的美術力 紀錄片',
          link: 'https://youtu.be/ruuZubl8OAg',
          linkLabel: '紀錄片連結',
        },
        {
          week: '第二週',
          date: '2026-08-28',
          title: '文協百年紀錄片 EP1｜臺灣是臺灣人的臺灣',
          link: 'https://youtu.be/7HMLdT9rXqg',
          linkLabel: '紀錄片連結',
          subtitle: '台灣轉大人：文化啟蒙',
          lines: [
            '蓬萊美島真可愛，',
            '祖先基業在。',
            '田園阮開  樹阮栽，',
            '勞苦代過代。',
            '著理解，著理解',
            '阮是開拓者，',
            '毋是憨奴才，',
            '臺灣全島快自治，',
            '公事阮掌正應該！',
          ],
          linesSource: '蔡培火〈臺灣自治歌〉',
          closing: '不再作故鄉的異鄉人',
        },
        {
          week: '第一週',
          date: '2026-08-21',
          status: '輪空',
        },
      ],
    },
    items: [],
  },
];

// ---- Tab 順序＝固定 order（不再依日期自動排序）----
// 依日期排會讓 Tab 左右跳動，David 2026-08-27 指定固定順序。
CATEGORIES.sort((a, b) => (a.order || 99) - (b.order || 99));

// ---- 每個分類內部的文章仍依日期排序（新的在前）----
CATEGORIES.forEach(cat => {
  cat.items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  cat.latestDate = cat.items[0]?.date || '';
});

// ---- 顯示用編號＝Tab 順序 ----
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
