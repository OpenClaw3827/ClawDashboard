/**
 * Map agent lifecycle events to dashboard status updates
 * @param {Object} payload - Event payload from Gateway
 * @param {string} payload.runId - Run identifier
 * @param {number} payload.seq - Sequence number
 * @param {string} payload.stream - Event stream type
 * @param {number} payload.ts - Timestamp
 * @param {Object} payload.data - Event data
 * @param {string} payload.sessionKey - Session key (e.g. "agent:main:main")
 * @returns {Object|null} { agentId, state, task } or null if not mappable
 */
function mapAgentEvent(payload) {
  if (!payload || !payload.sessionKey) {
    return null;
  }

  // Extract agentId from sessionKey: "agent:AGENTID:..." -> AGENTID
  const match = payload.sessionKey.match(/^agent:([^:]+):/);
  if (!match) {
    return null;
  }
  const agentId = match[1];

  // Only process lifecycle stream
  if (payload.stream !== 'lifecycle') {
    return null;
  }

  const data = payload.data || {};
  const phase = data.phase;

  // Map lifecycle phases to dashboard states
  let state = null;
  let task = '';

  if (phase === 'start') {
    state = 'thinking';
    task = '';
  } else if (phase === 'end') {
    state = 'standby';
    task = '';
  } else if (phase === 'error') {
    state = 'error';
    task = data.error ? data.error.substring(0, 100) : 'error';
  }

  if (!state) {
    return null;
  }

  return { agentId, state, task };
}

module.exports = { mapAgentEvent };
