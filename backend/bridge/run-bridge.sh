#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
TOKEN=$(node -e "const j=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.openclaw/openclaw.json','utf8'));process.stdout.write(j.gateway.auth.token);")
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"
export DASHBOARD_API_URL="http://127.0.0.1:3001"
DASH_TOKEN=$(grep -s '^DASHBOARD_API_TOKEN=' "$(dirname "$0")/../.env" 2>/dev/null | cut -d= -f2)
export DASHBOARD_API_TOKEN="${DASH_TOKEN:-}"
export OPENCLAW_GATEWAY_URL="ws://127.0.0.1:18789"
exec /opt/homebrew/bin/node "$(dirname "$0")/index.js"
