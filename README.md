# 人與社會｜教師社團

「人與社會」教師社團的公開文章網站。全站 **unlisted**（`noindex` + `robots.txt` 全擋），只有取得連結的人能進入。

- 預定網址：<https://elliot200852-lab.github.io/human-and-society/>
- 架構：`site/` 靜態殼與可版本控公開文字；`scripts/` Drive-pull 建置；`output/` 為建置產物。
- 導覽是主頁上方一排分頁（Tab），每個分頁有自己的網址 `index.html?tab=<id>`，可以單獨分享。
  分頁清單、順序與內容全部由 `site/data.js` 的 `CATEGORIES` 一份資料驅動（`js/tabs.js` 產生分頁列）；
  新增／調整分類只改 `data.js`。`category.html` 已改為轉址殼，只為了讓先前流出的舊連結仍打得開。
- 圖片、PDF、影音、簡報、字型等二進位全部存 Google Drive，不進 repo。
- Drive 根資料夾 ID 由 `HUMAN_AND_SOCIETY_DRIVE_FOLDER_ID` 提供；service account 使用 GitHub secret `GOOGLE_DRIVE_SA_KEY`。

本機可執行 `npm ci && npm run check` 做不需 Drive 憑證的靜態檢查；有憑證與 Drive folder ID 時，`npm run build` 會同步 Drive 中的公開 HTML。
