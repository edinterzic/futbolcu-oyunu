import React, { useState, useEffect, useCallback } from "react";

// SHA-256 hash of the admin password. The actual password is never in source code.
// To change the password: run `echo -n "yourpassword" | sha256sum` and replace this hash.
const ADMIN_PASSWORD_HASH = "fd951ea5c8dc7cd32b7b5840f5151419aa90863330ee7ede41c52dd8df8dbbbc";

const SESSION_KEY = "pairfc_admin_session";
const ACTIVITY_LOG_KEY = "pairfc_admin_activity_log";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// SHA-256 hash function using Web Crypto API (browser-native)
async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isSessionValid() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw);
    if (!session.expiresAt || Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function createSession() {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS })
  );
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function getActivityLog() {
  try {
    const raw = localStorage.getItem(ACTIVITY_LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function appendActivity(entry) {
  try {
    const log = getActivityLog();
    const next = [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: Date.now(), ...entry },
      ...log
    ].slice(0, 200); // keep last 200 entries
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds} sn önce`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

// =================== LOGIN SCREEN ===================
function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const inputHash = await sha256(password);
      if (inputHash === ADMIN_PASSWORD_HASH) {
        createSession();
        appendActivity({ type: "auth", message: "Yönetici giriş yaptı" });
        onLogin();
      } else {
        setError("Şifre yanlış.");
        // Add a small delay to slow down brute force attempts
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      setError("Bir hata oluştu. Tarayıcı modern bir sürüm olmalı.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <div className="admin-login-header">
          <div className="admin-login-mark">🔒</div>
          <h1>PairFC Yönetim</h1>
          <p>Devam etmek için yönetici şifresini gir.</p>
        </div>

        <form onSubmit={handleSubmit} className="admin-login-form">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Yönetici şifresi"
            autoFocus
            autoComplete="current-password"
            disabled={loading}
          />
          <button type="submit" disabled={!password || loading} className="admin-primary-button">
            {loading ? "Doğrulanıyor..." : "Giriş Yap"}
          </button>
          {error && <div className="admin-error">{error}</div>}
        </form>

        <div className="admin-login-footer">
          <a href="/">← Oyuna dön</a>
        </div>
      </div>
    </div>
  );
}

// =================== TAB PLACEHOLDERS (Faz 2-4'te dolacak) ===================
function PlayersTab({ logActivity }) {
  return (
    <div className="admin-tab-placeholder">
      <div className="admin-tab-icon">🎮</div>
      <h2>Oyuncular</h2>
      <p>Oyuncu listesi, arama, ekleme, düzenleme, silme.</p>
      <span className="admin-coming-soon">Faz 2'de geliyor</span>
    </div>
  );
}

function TeamsTab({ logActivity }) {
  return (
    <div className="admin-tab-placeholder">
      <div className="admin-tab-icon">🛡️</div>
      <h2>Takımlar</h2>
      <p>Takım listesi, renk seçici, kısaltma, canlı rozet önizleme.</p>
      <span className="admin-coming-soon">Faz 2'de geliyor</span>
    </div>
  );
}

function ImportTab({ logActivity }) {
  return (
    <div className="admin-tab-placeholder">
      <div className="admin-tab-icon">📥</div>
      <h2>Toplu Import</h2>
      <p>Excel/CSV yükle, önizleme gör, onayla.</p>
      <span className="admin-coming-soon">Faz 3'te geliyor</span>
    </div>
  );
}

function ReportsTab({ logActivity }) {
  return (
    <div className="admin-tab-placeholder">
      <div className="admin-tab-icon">🚨</div>
      <h2>Raporlar</h2>
      <p>Kullanıcılardan gelen hatalı cevap bildirimleri, düzenleme ile onaylama.</p>
      <span className="admin-coming-soon">Faz 3'te geliyor</span>
    </div>
  );
}

function ExportTab({ logActivity }) {
  return (
    <div className="admin-tab-placeholder">
      <div className="admin-tab-icon">📊</div>
      <h2>İstatistikler ve Dışa Aktar</h2>
      <p>Özet kartlar, grafikler, "Tüm Dosyaları İndir" butonu.</p>
      <span className="admin-coming-soon">Faz 2'de geliyor</span>
    </div>
  );
}

// =================== ACTIVITY LOG PANEL ===================
function ActivityLogPanel({ log, onClear }) {
  if (!log.length) {
    return (
      <div className="admin-log-empty">
        <p>Henüz aktivite yok.</p>
      </div>
    );
  }

  return (
    <div className="admin-log-list">
      {log.slice(0, 12).map((entry) => (
        <div key={entry.id} className="admin-log-item">
          <div className="admin-log-icon" data-type={entry.type}>
            {entry.type === "auth" ? "🔐" : entry.type === "edit" ? "✏️" : entry.type === "delete" ? "🗑️" : entry.type === "add" ? "➕" : entry.type === "import" ? "📥" : entry.type === "export" ? "📤" : "•"}
          </div>
          <div className="admin-log-body">
            <div className="admin-log-message">{entry.message}</div>
            <div className="admin-log-time">{formatRelativeTime(entry.time)}</div>
          </div>
        </div>
      ))}
      {log.length > 12 && (
        <div className="admin-log-more">+{log.length - 12} eski kayıt</div>
      )}
      <button type="button" className="admin-log-clear" onClick={onClear}>
        Geçmişi temizle
      </button>
    </div>
  );
}

// =================== MAIN PANEL ===================
function AdminShell({ onLogout }) {
  const [activeTab, setActiveTab] = useState("players");
  const [activityLog, setActivityLog] = useState(() => getActivityLog());
  const [logVisible, setLogVisible] = useState(false);

  const logActivity = useCallback((entry) => {
    const next = appendActivity(entry);
    setActivityLog(next);
  }, []);

  const handleClearLog = () => {
    if (window.confirm("Aktivite geçmişini silmek istediğine emin misin?")) {
      localStorage.removeItem(ACTIVITY_LOG_KEY);
      setActivityLog([]);
      appendActivity({ type: "edit", message: "Aktivite geçmişi silindi" });
      setActivityLog(getActivityLog());
    }
  };

  const handleLogout = () => {
    if (window.confirm("Çıkış yapmak istediğine emin misin?")) {
      appendActivity({ type: "auth", message: "Yönetici çıkış yaptı" });
      clearSession();
      onLogout();
    }
  };

  const tabs = [
    { id: "players", label: "Oyuncular", icon: "🎮" },
    { id: "teams", label: "Takımlar", icon: "🛡️" },
    { id: "import", label: "Toplu Import", icon: "📥" },
    { id: "reports", label: "Raporlar", icon: "🚨" },
    { id: "export", label: "İstatistikler", icon: "📊" }
  ];

  const renderTab = () => {
    switch (activeTab) {
      case "players": return <PlayersTab logActivity={logActivity} />;
      case "teams": return <TeamsTab logActivity={logActivity} />;
      case "import": return <ImportTab logActivity={logActivity} />;
      case "reports": return <ReportsTab logActivity={logActivity} />;
      case "export": return <ExportTab logActivity={logActivity} />;
      default: return null;
    }
  };

  return (
    <div className="admin-shell">
      {/* Topbar */}
      <header className="admin-topbar">
        <div className="admin-brand">
          <span className="admin-brand-mark">⚙️</span>
          <div>
            <strong>PairFC Yönetim</strong>
            <small>Veri ve içerik kontrolü</small>
          </div>
        </div>

        <div className="admin-topbar-actions">
          <button
            type="button"
            className="admin-icon-button"
            onClick={() => setLogVisible((v) => !v)}
            title="Aktivite geçmişi"
            aria-label="Aktivite geçmişi"
          >
            📋
          </button>
          <a href="/" className="admin-secondary-button" title="Oyuna dön">
            🎯 Oyuna Dön
          </a>
          <button
            type="button"
            className="admin-danger-button"
            onClick={handleLogout}
            title="Çıkış"
          >
            Çıkış
          </button>
        </div>
      </header>

      <div className="admin-body">
        {/* Sidebar */}
        <aside className="admin-sidebar">
          <nav className="admin-nav">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`admin-nav-item ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="admin-nav-icon">{tab.icon}</span>
                <span className="admin-nav-label">{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="admin-sidebar-footer">
            <div className="admin-version-badge">
              <small>v0.1.0 · Faz 1</small>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="admin-main">
          {renderTab()}
        </main>

        {/* Activity log slide-out */}
        {logVisible && (
          <aside className="admin-log-panel">
            <header className="admin-log-header">
              <h3>📋 Aktivite</h3>
              <button type="button" onClick={() => setLogVisible(false)} className="admin-icon-button">✕</button>
            </header>
            <ActivityLogPanel log={activityLog} onClear={handleClearLog} />
          </aside>
        )}
      </div>

      <style>{ADMIN_STYLES}</style>
    </div>
  );
}

// =================== TOP-LEVEL ADMIN COMPONENT ===================
export default function AdminPanel() {
  const [isAuthed, setIsAuthed] = useState(() => isSessionValid());

  useEffect(() => {
    // Re-check session every minute (auto-logout when expired)
    const interval = setInterval(() => {
      if (!isSessionValid()) {
        setIsAuthed(false);
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Set page title
  useEffect(() => {
    const prev = document.title;
    document.title = "Yönetim · PairFC";
    return () => { document.title = prev; };
  }, []);

  if (!isAuthed) {
    return (
      <div className="admin-root">
        <LoginScreen onLogin={() => setIsAuthed(true)} />
        <style>{ADMIN_STYLES}</style>
      </div>
    );
  }

  return (
    <div className="admin-root">
      <AdminShell onLogout={() => setIsAuthed(false)} />
    </div>
  );
}

// =================== STYLES ===================
const ADMIN_STYLES = `
:root {
  --admin-bg: #0f172a;
  --admin-surface: #1e293b;
  --admin-surface-2: #334155;
  --admin-border: #334155;
  --admin-text: #f1f5f9;
  --admin-text-muted: #94a3b8;
  --admin-primary: #10b981;
  --admin-primary-soft: rgba(16, 185, 129, 0.15);
  --admin-primary-hover: #34d399;
  --admin-danger: #ef4444;
  --admin-danger-soft: rgba(239, 68, 68, 0.15);
  --admin-warning: #f59e0b;
  --admin-info: #38bdf8;
}

* { box-sizing: border-box; }

.admin-root {
  position: fixed;
  inset: 0;
  background: var(--admin-bg);
  color: var(--admin-text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
}

/* ===== LOGIN SCREEN ===== */
.admin-login-shell {
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 80% 80%, rgba(56, 189, 248, 0.05) 0%, transparent 50%),
    var(--admin-bg);
}

.admin-login-card {
  width: 100%;
  max-width: 380px;
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  padding: 36px 28px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.admin-login-header {
  text-align: center;
  margin-bottom: 28px;
}

.admin-login-mark {
  font-size: 36px;
  margin-bottom: 12px;
}

.admin-login-header h1 {
  font-size: 24px;
  font-weight: 800;
  margin: 0 0 6px;
  letter-spacing: -0.02em;
}

.admin-login-header p {
  font-size: 14px;
  color: var(--admin-text-muted);
  margin: 0;
}

.admin-login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.admin-login-form input {
  width: 100%;
  padding: 14px 16px;
  font-size: 15px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--admin-border);
  border-radius: 12px;
  color: var(--admin-text);
  outline: none;
  transition: all 0.2s;
}

.admin-login-form input:focus {
  border-color: var(--admin-primary);
  background: rgba(15, 23, 42, 0.9);
  box-shadow: 0 0 0 3px var(--admin-primary-soft);
}

.admin-primary-button {
  padding: 14px 20px;
  background: var(--admin-primary);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.admin-primary-button:hover:not(:disabled) {
  background: var(--admin-primary-hover);
  transform: translateY(-1px);
}

.admin-primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.admin-error {
  padding: 10px 14px;
  background: var(--admin-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  color: #fca5a5;
  font-size: 13px;
  text-align: center;
}

.admin-login-footer {
  margin-top: 20px;
  text-align: center;
}

.admin-login-footer a {
  color: var(--admin-text-muted);
  font-size: 13px;
  text-decoration: none;
  transition: color 0.2s;
}

.admin-login-footer a:hover {
  color: var(--admin-primary);
}

/* ===== MAIN SHELL ===== */
.admin-shell {
  height: 100dvh;
  display: flex;
  flex-direction: column;
}

.admin-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(15, 23, 42, 0.9);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--admin-border);
  flex-shrink: 0;
}

.admin-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-brand-mark {
  font-size: 22px;
}

.admin-brand strong {
  display: block;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.admin-brand small {
  display: block;
  font-size: 11px;
  color: var(--admin-text-muted);
  margin-top: 1px;
}

.admin-topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-icon-button {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--admin-border);
  border-radius: 10px;
  color: var(--admin-text);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.admin-icon-button:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--admin-primary);
}

.admin-secondary-button {
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--admin-border);
  border-radius: 10px;
  color: var(--admin-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.admin-secondary-button:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--admin-primary);
}

.admin-danger-button {
  padding: 8px 14px;
  background: var(--admin-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  color: #fca5a5;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.admin-danger-button:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: var(--admin-danger);
  color: #fee2e2;
}

/* ===== BODY ===== */
.admin-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

.admin-sidebar {
  width: 220px;
  background: rgba(30, 41, 59, 0.5);
  border-right: 1px solid var(--admin-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.admin-nav {
  flex: 1;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.admin-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--admin-text-muted);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}

.admin-nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--admin-text);
}

.admin-nav-item.active {
  background: var(--admin-primary-soft);
  border-color: rgba(16, 185, 129, 0.3);
  color: var(--admin-primary-hover);
}

.admin-nav-icon {
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
}

.admin-sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--admin-border);
}

.admin-version-badge {
  padding: 8px 12px;
  background: rgba(15, 23, 42, 0.6);
  border-radius: 8px;
  text-align: center;
}

.admin-version-badge small {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 600;
}

/* ===== MAIN CONTENT ===== */
.admin-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.admin-tab-placeholder {
  height: 100%;
  min-height: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
  background: rgba(30, 41, 59, 0.4);
  border: 1px dashed var(--admin-border);
  border-radius: 16px;
}

.admin-tab-icon {
  font-size: 56px;
  margin-bottom: 16px;
  opacity: 0.6;
}

.admin-tab-placeholder h2 {
  font-size: 24px;
  font-weight: 800;
  margin: 0 0 8px;
  letter-spacing: -0.02em;
}

.admin-tab-placeholder p {
  font-size: 14px;
  color: var(--admin-text-muted);
  margin: 0 0 20px;
  max-width: 400px;
}

.admin-coming-soon {
  display: inline-block;
  padding: 6px 14px;
  background: var(--admin-warning);
  color: #422006;
  font-size: 12px;
  font-weight: 700;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ===== ACTIVITY LOG ===== */
.admin-log-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(20px);
  border-left: 1px solid var(--admin-border);
  display: flex;
  flex-direction: column;
  z-index: 10;
  animation: slideInLog 0.2s ease-out;
}

@keyframes slideInLog {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.admin-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--admin-border);
}

.admin-log-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.admin-log-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.admin-log-item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.admin-log-icon {
  font-size: 14px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.admin-log-body {
  flex: 1;
  min-width: 0;
}

.admin-log-message {
  font-size: 13px;
  color: var(--admin-text);
  line-height: 1.3;
}

.admin-log-time {
  font-size: 11px;
  color: var(--admin-text-muted);
  margin-top: 2px;
}

.admin-log-more {
  padding: 10px;
  font-size: 12px;
  color: var(--admin-text-muted);
  text-align: center;
}

.admin-log-clear {
  margin: 8px;
  padding: 8px;
  background: transparent;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  color: var(--admin-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.admin-log-clear:hover {
  border-color: var(--admin-danger);
  color: var(--admin-danger);
}

.admin-log-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--admin-text-muted);
  font-size: 13px;
  text-align: center;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 720px) {
  .admin-sidebar {
    width: 64px;
  }
  
  .admin-nav-label {
    display: none;
  }
  
  .admin-nav-item {
    justify-content: center;
    padding: 11px;
  }
  
  .admin-brand small {
    display: none;
  }
  
  .admin-secondary-button {
    display: none;
  }
  
  .admin-main {
    padding: 16px;
  }
  
  .admin-log-panel {
    width: 280px;
  }
  
  .admin-version-badge {
    display: none;
  }
}

@media (max-width: 480px) {
  .admin-log-panel {
    width: 100%;
  }
}

/* Hide scrollbar styling */
.admin-main::-webkit-scrollbar,
.admin-nav::-webkit-scrollbar,
.admin-log-list::-webkit-scrollbar {
  width: 8px;
}

.admin-main::-webkit-scrollbar-track,
.admin-nav::-webkit-scrollbar-track,
.admin-log-list::-webkit-scrollbar-track {
  background: transparent;
}

.admin-main::-webkit-scrollbar-thumb,
.admin-nav::-webkit-scrollbar-thumb,
.admin-log-list::-webkit-scrollbar-thumb {
  background: var(--admin-border);
  border-radius: 4px;
}

.admin-main::-webkit-scrollbar-thumb:hover,
.admin-nav::-webkit-scrollbar-thumb:hover,
.admin-log-list::-webkit-scrollbar-thumb:hover {
  background: var(--admin-text-muted);
}
`;
