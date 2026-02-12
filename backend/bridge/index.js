#!/usr/bin/env node

const { createGatewayClient } = require('./gateway-ws-client');
const { mapAgentEvent } = require('./agent-status-mapper');

// Read environment variables
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || 'http://127.0.0.1:3001';
const DASHBOARD_API_TOKEN = process.env.DASHBOARD_API_TOKEN;

// Validate required config
if (!GATEWAY_TOKEN) {
  console.error('[Bridge] FATAL: OPENCLAW_GATEWAY_TOKEN is required');
  process.exit(1);
}

console.log('[Bridge] Starting Dashboard Gateway Bridge');
console.log('[Bridge] Gateway URL:', GATEWAY_URL);
console.log('[Bridge] Dashboard API:', DASHBOARD_API_URL);

// Polling state
let pollingInterval = null;
const POLLING_INTERVAL_MS = 10000; // 10 seconds
const lastAgentStates = new Map(); // Track last known state

/**
 * Update agent status via Dashboard API
 */
async function updateAgentStatus(agentId, state, task, source = 'normal') {
  const url = `${DASHBOARD_API_URL}/api/agents/${agentId}/status`;
  const body = JSON.stringify({ state, task, source });
  
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (DASHBOARD_API_TOKEN) {
    headers['Authorization'] = `Bearer ${DASHBOARD_API_TOKEN}`;
  }

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body
    });
    
    if (!response.ok) {
      console.error(`[Bridge] Failed to update agent ${agentId}: ${response.status} ${response.statusText}`);
    } else {
      console.log(`[Bridge] Updated agent ${agentId}: ${state}${task ? ' - ' + task : ''}`);
    }
  } catch (err) {
    console.error(`[Bridge] Error updating agent ${agentId}:`, err.message);
  }
}

/**
 * HTTP polling fallback when WebSocket is disconnected
 */
async function pollGatewayStatus() {
  const httpUrl = GATEWAY_URL.replace(/^ws/, 'http');
  const url = `${httpUrl}/tools/invoke`;
  
  const body = JSON.stringify({
    tool: 'sessions_list',
    action: 'json',
    args: {}
  });
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`
      },
      body
    });
    
    if (!response.ok) {
      console.error(`[Bridge] Polling failed: ${response.status} ${response.statusText}`);
      return;
    }
    
    const data = await response.json();
    const sessions = data.result?.details?.sessions || [];
    
    const now = Date.now();
    const ACTIVITY_THRESHOLD_MS = 30000; // 30 seconds - recently active
    const IDLE_THRESHOLD_MS = 120000; // 2 minutes - consider idle
    
    const currentActiveAgents = new Set();
    
    // Process active sessions
    for (const session of sessions) {
      if (session.key && session.key.startsWith('agent:')) {
        const match = session.key.match(/^agent:([^:]+):/);
        if (match) {
          const agentId = match[1];
          const updatedAt = session.updatedAt || 0;
          const timeSinceUpdate = now - updatedAt;
          
          currentActiveAgents.add(agentId);
          
          let newState = null;
          if (timeSinceUpdate < ACTIVITY_THRESHOLD_MS) {
            newState = 'thinking';
          } else if (timeSinceUpdate < IDLE_THRESHOLD_MS) {
            newState = 'standby';
          }
          
          if (newState) {
            const lastState = lastAgentStates.get(agentId);
            if (lastState !== newState) {
              console.log(`[Bridge] Agent ${agentId} state changed: ${lastState || 'unknown'} -> ${newState}`);
              await updateAgentStatus(agentId, newState, '');
              lastAgentStates.set(agentId, newState);
            }
          }
        }
      }
    }
    
    // Mark agents that disappeared as standby
    for (const [agentId, lastState] of lastAgentStates.entries()) {
      if (!currentActiveAgents.has(agentId) && lastState !== 'standby') {
        console.log(`[Bridge] Agent ${agentId} no longer active, marking as standby`);
        await updateAgentStatus(agentId, 'standby', '');
        lastAgentStates.set(agentId, 'standby');
      }
    }
    
    console.log(`[Bridge] Polling complete: ${currentActiveAgents.size} active agents`);
  } catch (err) {
    console.error('[Bridge] Polling error:', err.message);
  }
}

/**
 * Start HTTP polling (fallback mode)
 */
function startPolling() {
  if (pollingInterval) return;
  
  console.log('[Bridge] Starting HTTP polling fallback');
  pollingInterval = setInterval(pollGatewayStatus, POLLING_INTERVAL_MS);
  
  // Do immediate poll
  pollGatewayStatus();
}

/**
 * Stop HTTP polling
 */
function stopPolling() {
  if (pollingInterval) {
    console.log('[Bridge] Stopping HTTP polling');
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Start with WebSocket (primary) + polling as fallback
console.log('[Bridge] Starting with WebSocket mode (polling fallback on disconnect)');

let client = null;
try {
  client = createGatewayClient({
    url: GATEWAY_URL,
    token: GATEWAY_TOKEN,
    
    onEvent: (frame) => {
      if (frame.event === 'agent' && frame.payload) {
        const mapping = mapAgentEvent(frame.payload);
        if (mapping) {
          const { agentId, state, task } = mapping;
          updateAgentStatus(agentId, state, task);
        }
      }
    },
    
    onConnected: () => {
      console.log('[Bridge] WebSocket connected - stopping polling fallback');
      stopPolling();
    },
    
    onDisconnected: () => {
      console.log('[Bridge] WebSocket disconnected - starting polling fallback');
      startPolling();
    }
  });
} catch (err) {
  console.error('[Bridge] WebSocket client failed, falling back to polling:', err.message);
  startPolling();
}

// Stale state cleanup: every 5 minutes, check Dashboard for agents stuck in acting/thinking
// If Gateway sessions_list shows them as idle, reset to standby
const STALE_CHECK_INTERVAL_MS = 60000; // 1 minute
setInterval(async () => {
  try {
    const httpUrl = GATEWAY_URL.replace(/^ws/, 'http');
    
    // Get active sessions from Gateway
    const gwRes = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_TOKEN}` },
      body: JSON.stringify({ tool: 'sessions_list', action: 'json', args: {} })
    });
    if (!gwRes.ok) return;
    const gwData = await gwRes.json();
    const sessions = gwData.result?.details?.sessions || [];
    
    // Find which agents are truly active (updated in last 60s)
    const now = Date.now();
    const activeAgents = new Set();
    for (const s of sessions) {
      if (s.key?.startsWith('agent:') && (now - (s.updatedAt || 0)) < 60000) {
        const m = s.key.match(/^agent:([^:]+):/);
        if (m) activeAgents.add(m[1]);
      }
    }
    
    // Get Dashboard agent statuses
    const dashHeaders = { 'Content-Type': 'application/json' };
    if (DASHBOARD_API_TOKEN) dashHeaders['Authorization'] = `Bearer ${DASHBOARD_API_TOKEN}`;
    const dashRes = await fetch(`${DASHBOARD_API_URL}/api/agents/status`);
    if (!dashRes.ok) return;
    const dashData = await dashRes.json();
    const agentStatuses = dashData.data || {};
    
    // Reset stale agents (showing acting/thinking on Dashboard but not active on Gateway)
    let staleFound = false;
    for (const [agentId, info] of Object.entries(agentStatuses)) {
      if ((info.state === 'acting' || info.state === 'thinking') && !activeAgents.has(agentId)) {
        console.log(`[Bridge] Stale cleanup: ${agentId} is ${info.state} on Dashboard but idle on Gateway → standby`);
        await updateAgentStatus(agentId, 'standby', '', 'stale');
        staleFound = true;
      }
    }
    
    // If stale agents found, check if any tasks need recovery and wake 華安
    if (staleFound) {
      try {
        const recRes = await fetch(`${DASHBOARD_API_URL}/api/tasks/recovery`);
        if (recRes.ok) {
          const recData = await recRes.json();
          if (recData.data && recData.data.length > 0) {
            console.log(`[Bridge] ${recData.data.length} tasks need recovery, waking 華安...`);
            // Wake 華安 via Gateway
            const httpUrl = GATEWAY_URL.replace(/^ws/, 'http');
            await fetch(`${httpUrl}/tools/invoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_TOKEN}` },
              body: JSON.stringify({
                tool: 'cron',
                action: 'json',
                args: { action: 'wake', text: `⚠️ ${recData.data.length} 個任務需要恢復！Agent 斷線/被 kill，請檢查 /api/tasks/recovery 並重新派工。`, mode: 'now' }
              })
            });
          }
        }
      } catch (wakeErr) {
        console.error('[Bridge] Wake error:', wakeErr.message);
      }
    }
  } catch (err) {
    console.error('[Bridge] Stale check error:', err.message);
  }
}, STALE_CHECK_INTERVAL_MS);

// Graceful shutdown
function shutdown() {
  console.log('[Bridge] Shutting down...');
  stopPolling();
  if (client) client.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[Bridge] Bridge daemon running');
