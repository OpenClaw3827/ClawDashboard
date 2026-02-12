# Dashboard Gateway Bridge

OpenClaw Gateway 與 ClawDashboard 之間的即時同步橋接服務。

## 功能

- **WebSocket 即時監聯**：連接 OpenClaw Gateway WS，接收 agent lifecycle events（start/end/error），毫秒級更新 Dashboard agent 狀態
- **HTTP Polling 備援**：WS 斷線時自動切換為每 10 秒 polling Gateway sessions API
- **Stale 狀態清理**：每 1 分鐘交叉比對 Gateway 與 Dashboard，自動清理幽靈狀態
- **斷線恢復通知**：偵測到 agent 斷線且有未完成任務時，自動叫醒華安進行任務恢復
- **launchd 自動啟動**：macOS 開機自動運行，崩潰自動重啟

## 架構

```
OpenClaw Gateway (ws://127.0.0.1:18789)
  │
  │  event: agent (lifecycle: start/end/error)
  ▼
Dashboard Bridge (本服務)
  │
  │  PUT /api/agents/:name/status
  ▼
Dashboard Backend (port 3001)
  │
  │  SSE broadcast
  ▼
Dashboard Frontend (port 5173)
```

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `index.js` | 主程式入口，組合 WS client + mapper + API caller + stale cleanup |
| `gateway-ws-client.js` | Gateway WebSocket 連線模組，含 challenge/connect 握手 + 指數退避重連 |
| `agent-status-mapper.js` | 將 Gateway lifecycle events 映射為 Dashboard 狀態 (thinking/standby/error) |
| `run-bridge.sh` | 啟動 wrapper，從 `~/.openclaw/openclaw.json` 讀取 Gateway token |
| `com.clawdashboard.bridge.plist` | macOS launchd 服務配置 |
| `bridge-control.sh` | 服務管理工具（status/logs/restart） |

## 狀態映射規則

| Gateway Event | → Dashboard State |
|---|---|
| lifecycle start | `thinking` |
| lifecycle end | `standby` |
| lifecycle error | `error` |

## 安裝

```bash
# 1. 安裝依賴
cd ClawDashboard/backend
npm install ws

# 2. 確保 .env 有設定（Bridge 會自動讀取）
# DASHBOARD_API_TOKEN=your-token-here

# 3. 安裝 launchd 服務
cp backend/bridge/com.clawdashboard.bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.clawdashboard.bridge.plist

# 4. 確認運行
./bridge-control.sh status
```

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | (從 openclaw.json 讀取) | Gateway 認證 token |
| `DASHBOARD_API_URL` | `http://127.0.0.1:3001` | Dashboard Backend URL |
| `DASHBOARD_API_TOKEN` | (從 .env 讀取) | Dashboard API 認證 token |

## 管理

```bash
# 查看狀態
./bridge-control.sh status

# 查看日誌
./bridge-control.sh logs

# 重啟
./bridge-control.sh restart

# 或用 launchctl
launchctl kickstart -k gui/$(id -u)/com.clawdashboard.bridge
```
