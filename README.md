# 🎸 吉他和弦與六線譜（guitar-chord）

行動裝置優先的純靜態網頁工具：上傳音檔或用麥克風錄音，在瀏覽器中自動偵測**和弦時間軸**並轉成**標準調音六線譜**。沒有後端，音訊不會離開你的裝置。

## 功能

1. **YouTube 參考播放**：貼上 YouTube 網址（支援 `watch?v=`、`youtu.be/`、`shorts/`、`t=` 起始時間）即可嵌入播放器邊聽邊對照。
2. **兩種音訊輸入**
   - 上傳音檔：mp3 / m4a / wav（以及瀏覽器能解碼的其他格式）
   - 麥克風錄音：顯示錄音狀態與已錄秒數
3. **和弦偵測**（Essentia.js）：HPCP 音級輪廓 → `ChordsDetection`，輸出「時間 + 和弦名稱」的時間軸，並為每個出現的和弦畫出吉他和弦圖。點時間軸可跳到該處播放，播放時會標示目前和弦。
4. **音符轉譜**（@spotify/basic-pitch，TensorFlow.js）：把音訊轉成音符，再轉成 EADGBE 六線譜。指法以動態規劃挑選，偏好低把位、空弦、小跨度與較少換把。
5. **進度條**顯示分析各階段；可**一鍵複製**純文字六線譜（或連同和弦時間軸一起複製）。
6. 繁體中文介面、深色模式。

## 使用方式

1. 開啟網站：`https://<你的帳號>.github.io/guitar-chord/`
2. （可選）在「1. YouTube 參考播放」貼上網址並按「載入」。
   > 瀏覽器與 YouTube 規範不允許直接擷取影片音訊，所以影片只用於對照聆聽；要分析請上傳音檔或錄音（例如用另一支手機對著喇叭錄）。
3. 在「2. 音訊來源」：
   - **上傳音檔**：點虛線框選擇檔案；或
   - **麥克風錄音**：按「● 開始錄音」，允許麥克風權限，錄完按「■ 停止錄音」。
4. 在「3. 分析」選擇音符偵測靈敏度，按「開始分析」。第一次會下載模型（約 5 MB），之後會被瀏覽器快取。
5. 在「4. 分析結果」查看和弦時間軸、和弦圖與六線譜，按「複製六線譜」或「複製全部（含和弦）」貼到任何地方。

### 小技巧

- 單把吉他、伴奏乾淨的錄音效果最好；混音完整的歌曲音符會比較雜，可把靈敏度調「低」。
- 六線譜每行前的 `[0:12]` 是該行開始時間；`-` 的數量大致代表音符間的時間間隔。
- 和弦偵測只分辨大三與小三和弦（Essentia `ChordsDetection` 的限制）。
- 為避免手機記憶體不足，單次分析上限為 10 分鐘音訊。
- 麥克風需要 HTTPS（GitHub Pages 預設即為 HTTPS）。

## 部署到 GitHub Pages

本專案不需要建置，`main` 分支根目錄就是網站。

1. 到 GitHub repo 的 **Settings → Pages**。
2. **Source** 選 **Deploy from a branch**，Branch 選 **`main`**、資料夾 **`/ (root)`**，按 Save。
3. 約一分鐘後即可在 `https://<你的帳號>.github.io/guitar-chord/` 使用。

## 本機開發

ES modules 需要透過 HTTP 伺服器開啟（不能直接雙擊 `index.html`）：

```sh
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

手機測試麥克風時需使用 HTTPS 或 `localhost`。

### 專案結構

```
index.html              頁面
css/style.css           深色、行動優先樣式
js/app.js               介面與流程控制
js/audio.js             解碼、重新取樣（22050 Hz 單聲道）、錄音
js/chords.js            Essentia.js 和弦偵測、和弦指法與 SVG 和弦圖
js/transcribe.js        Basic Pitch 音符轉譜
js/tab.js               音符 → 六線譜（指法最佳化與文字排版）
js/youtube.js           YouTube 網址解析
vendor/                 已打包的第三方函式庫與模型（直接提交，免建置）
tools/build-vendor.sh   重新產生 vendor/
```

### 更新第三方函式庫

```sh
npm install
npm run build:vendor
```

## 授權與致謝

- [Essentia.js](https://github.com/MTG/essentia.js)（AGPL-3.0，授權條款見 `vendor/essentia/LICENSE`）
- [Basic Pitch](https://github.com/spotify/basic-pitch-ts)（Apache-2.0）與 [TensorFlow.js](https://github.com/tensorflow/tfjs)（Apache-2.0）

由於使用了 AGPL-3.0 授權的 Essentia.js，公開部署時請一併公開原始碼（本 repo 即是）。自動轉譜結果僅供參考。
