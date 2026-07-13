// booklist-data.js — 人與社會｜教師社團 · 推薦書單資料（placeholder）
// 這份是版控內的空 placeholder，只為了本機預覽 booklist.html 不會因缺檔而壞掉。
// 正式資料由 build 產出並覆蓋 output/js/booklist-data.js（讀 Firestore
// hs-book-recs 內 status=='approved' 的文件，整理成下列陣列 schema）：
//
//   window.HS_BOOKLIST = [{
//     id, title, author, publisher, publishedDate, isbn13,
//     description, booksUrl, libraryUrl, submitterName, approvedAt,
//   }, ...]

window.HS_BOOKLIST = [];
