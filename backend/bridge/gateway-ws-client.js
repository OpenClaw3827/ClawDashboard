const WebSocket = require('ws');

/**
 * Create Gateway WebSocket client with auto-reconnect
 * @param {Object} options
 * @param {string} options.url - Gateway WebSocket URL
 * @param {string} options.token - Gateway auth token
 * @param {Function} options.onEvent - Called for {type:"event"} frames
 * @param {Function} options.onConnected - Called when connection established
 * @param {Function} options.onDisconnected - Called when connection lost
 * @returns {Object} client with close() method
 */
function createGatewayClient({ url, token, onEvent, onConnected, onDisconnected }) {
  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000; // Start at 1s
  const MAX_RECONNECT_DELAY = 30000; // Cap at 30s
  let isClosing = false;
  let isConnected = false;

  function connect() {
    if (isClosing) return;

    console.log('[Bridge] Connecting to Gateway:', url);
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log('[Bridge] WebSocket opened, waiting for challenge...');
    });

    ws.on('message', (data) => {
      try {
        const frame = JSON.parse(data.toString());
        console.log('[Bridge] Received frame:', JSON.stringify(frame).substring(0, 200));
        
        // Handle connection challenge
        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          console.log('[Bridge] Received challenge, sending connect request...');
          const connectReq = {
            type: 'req',
            id: String(Date.now()),
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'webchat',
                version: '1.0.0',
                platform: 'macos',
                mode: 'backend',
                displayName: 'Dashboard Bridge'
              },
              role: 'operator',
              scopes: ['operator.read'],
              caps: [],
              commands: [],
              permissions: {},
              auth: {
                token: token
              },
              locale: 'en-US',
              userAgent: 'claw-dashboard-bridge/1.0.0'
            }
          };
          console.log('[Bridge] Sending connect with role=operator...');
          ws.send(JSON.stringify(connectReq));
        }
        
        // Handle connection success (check both formats)
        else if (frame.type === 'res') {
          if (frame.ok) {
            console.log('[Bridge] Gateway connected (hello-ok)');
            isConnected = true;
            reconnectDelay = 1000;
            if (onConnected) onConnected();
          } else if (frame.error) {
            console.error('[Bridge] Connection error:', JSON.stringify(frame.error));
          } else {
            console.log('[Bridge] Response:', JSON.stringify(frame).substring(0, 200));
          }
        }
        
        // Forward all event frames to handler
        else if (frame.type === 'event') {
          if (onEvent) onEvent(frame);
        }
      } catch (err) {
        console.error('[Bridge] Failed to parse message:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('[Bridge] WebSocket error:', err.message);
    });

    ws.on('close', () => {
      console.log('[Bridge] WebSocket closed');
      const wasConnected = isConnected;
      isConnected = false;
      
      if (wasConnected && onDisconnected) {
        onDisconnected();
      }
      
      if (!isClosing) {
        scheduleReconnect();
      }
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    
    console.log(`[Bridge] Reconnecting in ${reconnectDelay}ms...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
      // Exponential backoff with cap
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }, reconnectDelay);
  }

  function close() {
    isClosing = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  // Start initial connection
  connect();

  return {
    close,
    isConnected: () => isConnected
  };
}

module.exports = { createGatewayClient };
