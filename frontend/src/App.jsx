import { useEffect, useState } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';
import Docs from './components/Docs';
import FoxAvatar from './components/FoxAvatar';
import Log from './components/Log';
import ModelUsage from './components/ModelUsage';
import { LanguageProvider, useTranslation } from './i18n/LanguageContext';

import { API_BASE_URL, FEATURES } from './config';

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [status, setStatus] = useState('idle');
  const [activeAgent, setActiveAgent] = useState('Claw');
  const [isConnected, setIsConnected] = useState(true);
  const [lastSync, setLastSync] = useState(new Date());
  const [agents, setAgents] = useState([]);
  const [agentStatuses, setAgentStatuses] = useState({});
  const { t, lang, setLang } = useTranslation();

  useEffect(() => {
    // Poll status + per-agent statuses from backend
    const poll = async () => {
      try {
        const [statusRes, agentStatusRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/status`),
          fetch(`${API_BASE_URL}/api/agents/status`)
        ]);
        if (!statusRes.ok) throw new Error('Disconnected');
        const data = await statusRes.json();
        setStatus(data.status || 'idle');
        setActiveAgent(data.activeAgent || 'Claw');
        setIsConnected(true);
        setLastSync(new Date());

        if (agentStatusRes.ok) {
          const asData = await agentStatusRes.json();
          setAgentStatuses(asData?.data || {});
        }
      } catch (err) {
        console.error('Failed to fetch status:', err);
        setIsConnected(false);
      }
    };
    poll();
    const interval = setInterval(poll, 15000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // SSE connection for real-time updates
    const es = new EventSource(`${API_BASE_URL}/api/events`);
    
    es.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'agentStatusUpdated') {
          const { agent, state, task } = msg.data;
          setAgentStatuses(prev => ({
            ...prev,
            [agent]: { state, task, updatedAt: msg.ts }
          }));
        }
        if (msg.event === 'statusUpdated') {
          setStatus(msg.data.state || msg.data.status || 'idle');
          setActiveAgent(msg.data.activeAgent || 'Claw');
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    });

    es.onerror = () => {
      console.warn('SSE connection lost, falling back to polling');
    };

    return () => es.close();
  }, []);

  useEffect(() => {
    // Fetch agents list from backend
    const loadAgents = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/agents`);
        const data = await res.json();
        setAgents(data?.data || []);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setAgents([]);
      }
    };
    loadAgents();
  }, []);

  const formatTime = (date) => {
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: lang !== 'zh'
    });
  };

  const getProcessingClass = (status) => {
    const s = (status || 'idle').toLowerCase();
    if (s === 'thinking') return 'status-idle'; // Yellow
    if (s === 'acting') return 'status-busy';   // Red
    if (s === 'error') return 'status-error';   // Red (error state)
    return 'status-online';                      // Green (Idle)
  };

  const formatStatusLabel = (status) => {
    const s = (status || 'idle').toLowerCase();
    if (s === 'thinking') return t('app.thinking');
    if (s === 'acting') return t('app.acting');
    if (s === 'error') return '錯誤';
    return t('app.idle');
  };

  const getConnectionClass = () => {
    return isConnected ? 'status-online' : 'status-busy'; // Green/Red
  };

  const getAgentLabel = (agentState) => {
    const s = (agentState || 'standby').toLowerCase();
    if (s === 'thinking') return t('app.agentThinking');
    if (s === 'acting') return t('app.agentActing');
    if (s === 'error') return '錯誤';
    return t('app.agentStandby');
  };

  const agentsOnDuty = (agents || []).map(a => {
    // Use id for API lookups, name for display
    const agentId = a.id || a.name;
    const displayName = a.name || a.id || 'Agent';

    // Per-agent status from new API (multi-agent support)
    const perAgent = agentStatuses[agentId];
    const agentState = perAgent?.state || 'standby';
    const isBusy = agentState === 'acting' || agentState === 'thinking';

    // Fallback: also check legacy single-agent activeAgent field
    const legacyActive = activeAgent === agentId && status.toLowerCase() !== 'idle';
    const finalBusy = isBusy || legacyActive;
    const finalState = isBusy ? agentState : (legacyActive ? status.toLowerCase() : 'standby');

    return {
      id: agentId,
      name: displayName,
      role: a.role || 'Agent',
      emoji: a.emoji || '🤖',
      status: finalBusy ? 'busy' : 'standby',
      label: getAgentLabel(finalState),
      task: perAgent?.task || ''
    };
  });

  const toggleLang = () => {
    setLang(lang === 'en' ? 'zh' : 'en');
  };

  return (
    <div className="app">
      {/* Sidebar / Top Bar */}
      <div className="sidebar">
        <div className="sidebar-top-main">
          <div className="profile">
            <FoxAvatar status={status} />
            <div className={`status-indicator ${getConnectionClass()}`}></div>
          </div>
          <div className="mobile-status-pill">
            <div className={`status-dot ${getProcessingClass(status)}`}></div>
            <span>{status.toUpperCase()}</span>
          </div>

          <div className="sidebar-mobile-right">
            <div className="sidebar-last-sync">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              {formatTime(lastSync)}
            </div>
          </div>
        </div>

        <div className="sidebar-status-panel glass">
          <div className="status-row">
            <div className={`status-dot ${getProcessingClass(status)}`}></div>
            <span className="status-label">{formatStatusLabel(status)}</span>
          </div>
          <div className="task-current">
            {status.toLowerCase() === 'thinking' ? t('app.thinkingTask') :
              status.toLowerCase() === 'acting' ? t('app.actingTask') : t('app.readyTask')}
          </div>
        </div>

        {agentsOnDuty.length > 0 && (
          <div className="sidebar-agents">
            <div className="agents-header">{t('app.teamStatus')}</div>
            <div className="agents-list">
              {agentsOnDuty.map((agent, i) => (
                <div key={i} className={`agent-item ${agent.status}`}>
                  <span className="agent-emoji">{agent.emoji}</span>
                  <div className="agent-info">
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-role">{agent.task || agent.label}</span>
                  </div>
                  <div className={`agent-status-dot ${agent.status}`}></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {FEATURES.ENABLE_MODEL_USAGE && <ModelUsage />}
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Header */}
        <div className="header">
          <div className="header-info">
            <span>{t('app.lastSync')}: {formatTime(lastSync)}</span>
            <span>☀️</span>
          </div>
          <button className="lang-switch-btn" onClick={toggleLang} title="Switch language">
            <span className="lang-switch-icon">🌐</span>
            <span className="lang-switch-label">{t('lang.switch')}</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            {t('app.tab.dashboard')}
          </button>
          <button
            className={`tab ${activeTab === 'docs' ? 'active' : ''}`}
            onClick={() => setActiveTab('docs')}
          >
            {t('app.tab.docs')}
          </button>
          <button
            className={`tab ${activeTab === 'log' ? 'active' : ''}`}
            onClick={() => setActiveTab('log')}
          >
            {t('app.tab.log')}
          </button>

        </div>

        {/* Content */}
        <div className="content">
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'docs' && <Docs />}
          {activeTab === 'log' && <Log />}

        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

export default App;
