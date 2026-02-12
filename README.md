# 🦞 Claw Dashboard

一個簡潔、高效的本地 AI Agent 儀表板，整合了任務管理、狀態追蹤與自動化文件同步功能。

核心理念：**所有 Agent 行為都必須可視化、可追蹤、可回放**，形成 `Agent` → `Status` → `Task` → `Docs` → `UI` 的完整閉環系統。


## 🚀 快速開始

### 📥 安裝與 Clone

將專案 Clone 到 `.openclaw/workspace` 目錄下：
務必要存到這個資料夾底下，否則系統文檔就會因為路徑不同而無法看到。

```bash
mkdir -p .openclaw/workspace
cd .openclaw/workspace
git clone git@github.com:Ry7no/ClawDashboard.git
cd ClawDashboard
```


### ⚡ 一行啟動

專案內建自動化啟動腳本，首次運行會自動安裝依賴：

```bash
chmod +x start.sh && ./start.sh
```

啟動後會自動開啟瀏覽器，訪問 `http://localhost:5173`。


## 🏗️ 系統架構

```
OpenClaw Gateway (ws://127.0.0.1:18789)
  │
  │  WebSocket: agent lifecycle events
  ▼
Dashboard Bridge (backend/bridge/)
  │  即時同步 agent 狀態 + 斷線恢復偵測
  │
  │  PUT /api/agents/:name/status
  ▼
Dashboard Backend (Express + SQLite, port 3001)
  │  API 認證 (Bearer Token) + SSE 即時廣播
  │
  │  SSE: agentStatusUpdated / statusUpdated / tasksUpdated
  ▼
Dashboard Frontend (React + Vite, port 5173)
    即時更新 agent 狀態面板 + 任務看板
```

### 三個服務（launchd 自動啟動）

| 服務 | Label | Port | 說明 |
|------|-------|------|------|
| Backend | `com.clawdashboard.backend` | 3001 | Express API + SQLite + SSE |
| Frontend | `com.clawdashboard.frontend` | 5173 | React + Vite dev server |
| Bridge | `com.clawdashboard.bridge` | — | Gateway WS → Dashboard 同步 |


## 🔄 自動同步功能

### Agent 狀態自動同步

Bridge daemon 連接 OpenClaw Gateway WebSocket，即時接收 agent lifecycle events：

| Gateway Event | → Dashboard State | 說明 |
|---|---|---|
| lifecycle start | `thinking` | Agent 開始處理任務 |
| lifecycle end | `standby` | Agent 完成任務 |
| lifecycle error | `error` | Agent 發生錯誤 |

**三層防護**：
1. **WebSocket 即時**（毫秒級）：lifecycle events 直接推送
2. **HTTP Polling 備援**（10 秒）：WS 斷線時自動切換
3. **Stale 清理**（1 分鐘）：交叉比對 Gateway 與 Dashboard，清理幽靈狀態

### 任務自動完成

- Agent 正常歸隊（standby）→ 其 `in_progress` 任務自動標記 `done`
- Agent 異常斷線（stale cleanup）→ 任務保持 `in_progress`，不會誤判完成
- 任務需要 `assigned_agent` 欄位才會觸發自動完成

### 斷線恢復機制

當 Bridge 偵測到 agent 異常斷線且有未完成任務時：
1. 任務標記 `⚠️ Agent stale/disconnected`
2. 自動叫醒主 agent（華安）進行恢復
3. 主 agent 讀取舊 session 紀錄，重新派工並附上進度摘要

恢復 API：`GET /api/tasks/recovery`（回傳所有需要恢復的任務）


## 🔒 安全機制

### API 認證

所有寫入端點（PUT/POST/DELETE）需要 Bearer Token 認證：

```bash
curl -X PUT http://localhost:3001/api/agents/main/status \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state":"acting","task":"工作中"}'
```

Token 設定在 `backend/.env`：
```
DASHBOARD_API_TOKEN=your-token-here
```

若不設 token（空值），則跳過認證（開發模式）。

### 路徑安全

Docs API 有路徑遍歷保護（`../` 攻擊會被 403 擋下）。


## 🧩 核心概念

### Status Flow（狀態燈）

- **`idle`**：閒置中（綠色）
- **`thinking`**：思考中（黃色）
- **`acting`**：執行中（紅色）
- **`error`**：錯誤（紅色閃爍）

全局狀態由所有 agent 狀態自動聚合：任一 acting → acting；任一 thinking → thinking；否則 idle。

### Task Flow（任務看板）

```
todo → in_progress → done
              ↑          ↑
        手動/派工    agent standby（自動）
```

任務欄位：
- `title`：任務標題
- `status`：todo / in_progress / done
- `assigned_agent`：指派的 agent（自動完成用）
- `session_key`：對應的 OpenClaw session（斷線恢復用）

### Frontend 即時更新

前端優先使用 SSE（Server-Sent Events）接收即時更新，15 秒 polling 作為 fallback：
- `agentStatusUpdated`：單一 agent 狀態變更
- `statusUpdated`：全局狀態變更
- `tasksUpdated`：任務看板變更


## 🔌 API 參考

### Status API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/status` | — | 獲取全局狀態 |
| `PUT` | `/api/status` | ✅ | 更新全局狀態 |

### Agent API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/agents` | — | 從 openclaw.json 讀取 agent 列表 |
| `GET` | `/api/agents/status` | — | 所有 agent 即時狀態 |
| `PUT` | `/api/agents/:name/status` | ✅ | 更新 agent 狀態（支援 `source` 參數） |

### Task API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/tasks` | — | 任務列表 |
| `POST` | `/api/tasks` | ✅ | 建立任務（支援 `assigned_agent`, `session_key`） |
| `PUT` | `/api/tasks/:id` | ✅ | 更新任務 |
| `DELETE` | `/api/tasks/:id` | ✅ | 刪除任務 |
| `GET` | `/api/tasks/recovery` | — | 需要恢復的任務列表 |

### Webhook API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/webhook/message` | ✅ | 外部觸發任務流轉 |

### SSE Events

| Event | Endpoint | Description |
|-------|----------|-------------|
| `GET` | `/api/events` | SSE 事件流 |

事件類型：`agentStatusUpdated`、`statusUpdated`、`tasksUpdated`、`docsUpdated`


## ⚙️ 環境變數

設定檔：`backend/.env`

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `PORT` | `3001` | Backend 端口 |
| `DB_PATH` | `bot.db` | SQLite 資料庫路徑 |
| `DOCS_DIR` | `docs` | 文件存放目錄 |
| `DASHBOARD_API_TOKEN` | (空) | API 認證 token（空=跳過認證） |
| `OPENCLAW_CONFIG` | `~/.openclaw/openclaw.json` | OpenClaw 配置檔路徑 |

Bridge 額外環境變數（由 `run-bridge.sh` 自動設定）：

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | (從 openclaw.json 讀取) | Gateway token |
| `DASHBOARD_API_URL` | `http://127.0.0.1:3001` | Dashboard Backend URL |


## 🛠️ 開發

```bash
# Backend（熱重載）
cd backend && npm run dev

# Frontend（Vite HMR）
cd frontend && npm run dev

# Bridge（手動測試）
cd backend && bash bridge/run-bridge.sh
```


## 📝 License

MIT
