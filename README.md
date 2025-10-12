# AvatarKit

批量去背與產出頭像的 Astro + Fastify 範例專案。使用者可一次匯入多張照片，後端串接 remove.bg API 自動去背，前端以 fabric.js 提供畫布編輯、批量控制與一鍵壓縮下載。

## 功能摘要

- 上傳或拖曳最多 50 張圖片（JPEG/PNG/WebP，容量 ≤ 15 MB）。
- 自動呼叫 `/api/remove-bg` 取得透明背景 PNG，失敗自動重試 2 次並可跳過單張。
- 畫布尺寸（512/800/1080/2048 px）、圓形/方形（圓角可調）與背景（透明/純色/漸層/圖樣）設定。
- 批量控制所有素材的縮放、旋轉、X/Y 偏移；單張模式可額外微調，不影響其他圖片。
- 方向鍵每次微移 1 px，Shift + 方向鍵為 10 px。
- 匯出 PNG/WebP、設定品質與 1x/2x 倍率；依命名規則輸出並由 `/api/zip` 打包下載。
- LocalStorage 記住上一次的畫布、批量與匯出設定。
- iPad 等行動裝置友善操作（Tailwind + 自適應排版）。

## 環境需求

- Node.js 18.17 或更新版本。
- remove.bg API Key。

## 安裝與啟動

```bash
npm install
cp .env.example .env  # 設定 remove.bg API Key

# 開發模式：同時啟動 Astro + Fastify
npm run dev

# 建置靜態資源並於本機預覽（需先 build）
npm run build
npm run start
```

Astro 開發伺服器預設執行於 <http://localhost:3000>，Fastify API 在 <http://localhost:4000>。

## 主要腳本

- `npm run dev`: 以 `npm-run-all` 並行啟動 `astro dev` 與 Fastify（`tsx server/index.ts --watch`）。
- `npm run build`: Astro Build（Node adapter `standalone` 模式）。
- `npm run start`: 以 `astro preview` + Fastify 啟動預覽模式。
- `npm run format`: Prettier 自動格式化。

## 環境變數

參考 `.env.example`：

| 變數 | 說明 | 預設值 |
| ---- | ---- | ------ |
| `REMOVE_BG_API_KEY` | remove.bg API 金鑰 | _必填_ |
| `REMOVE_BG_API_URL` | remove.bg API 端點 | `https://api.remove.bg/v1.0/removebg` |
| `REMOVE_BG_MAX_FILES` | 單次處理上限 | `50` |
| `REMOVE_BG_TIMEOUT_MS` | remove.bg 請求逾時（毫秒） | `45000` |
| `PUBLIC_MAX_FILES` | 前端限制上傳上限（需同步後端設定） | `50` |
| `API_PORT` | Fastify 監聽埠號 | `4001` |
| `API_BODY_LIMIT` | 後端允許的最大 body（bytes） | `41943040` |

## 專案結構

```
.
├── astro.config.mjs
├── package.json
├── server
│   ├── index.ts               # Fastify 入口
│   ├── plugins/config.ts      # 環境設定注入
│   └── routes
│       ├── removeBg.ts        # remove.bg 代理 API
│       └── zip.ts             # ZIP 串流打包
└── src
    ├── components/Workspace.tsx  # 主要工作區（React + fabric.js）
    ├── layouts/BaseLayout.astro
    ├── pages/index.astro
    ├── styles/tailwind.css
    └── utils/fabricLoader.ts
```

## 驗收建議

1. 於 `.env` 設定有效的 `REMOVE_BG_API_KEY`，執行 `npm run dev`。
2. 上傳 10 張測試圖片後，批量縮放到 80%、背景設定為 `#F5F5F5`，形狀選擇圓形。
3. 下載 PNG，確認壓縮包內 10 個檔案皆透過 clipPath 真裁切且主體未被裁切。
4. 切換至單張模式，調整任一照片位置，確認不影響其他圖片結果。
5. 切換畫布為方形並再次導出，檢查輸出尺寸與透明背景是否正確。

## 待辦 / 可擴充項目

- 新增後端佇列（防止 remove.bg 429 時過載，或實作等待/重試機制）。
- 引入登入或 API Key 限制，避免未授權濫用。
- 加入 E2E / 單元測試（目前僅手動驗證流程）。
- 國際化與多語系 UI。
