# 萬丹公托待辦

托嬰中心主任和行政共用的待辦提醒網頁。正式網站由 GitHub Pages 從 `main` 分支發布。

目前僅供本園所內部使用，沒有開放授權。

## 測試

```
npm test
```

## 改版前的備份與退回

每次大改前都會先開備份分支，名稱是 `backup-before-…`。

目前最新的備份是 `backup-before-pettycash-20261111`，內容是加入零用金代墊清單之前的版本；排班表改成前一個月 20 號到期之前的是 `backup-before-shift-due20-20261109`；改成底部導覽列和左側選單之前的版本是 `backup-before-nav-20261105`。要退回時，在專案資料夾執行：

```
git fetch origin
git checkout main
git pull
git revert --no-edit origin/backup-before-pettycash-20261111..main
git push origin main
```

這會把備份之後的所有修改一起撤銷，資料庫裡的事項和打勾紀錄不受影響。推上去後等幾分鐘，再到網站按「有新版本」更新。
