import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  PlayersTab, TeamsTab, ImportTab, ReportsTab, ExportTab,
  useDataStore, computeDiff, formatRelativeTime
} from "./AdminTabs";
import { ADMIN_STYLES } from "./adminStyles";

// =================== CONSTANTS ===================
// SHA-256 hash of the admin password. The actual password is never in source code.
// To change the password: run `echo -n "yourpassword" | sha256sum` and replace this hash.
const ADMIN_PASSWORD_HASH = "fd951ea5c8dc7cd32b7b5840f5151419aa90863330ee7ede41c52dd8df8dbbbc";

const SESSION_KEY = "pairfc_admin_session";
const ACTIVITY_LOG_KEY = "pairfc_admin_activity_log";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// =================== AUTH HELPERS ===================
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

// =================== ACTIVITY LOG ===================
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
    ].slice(0, 200);
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
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
      {log.slice(0, 50).map((entry) => (
        <div key={entry.id} className="admin-log-item">
          <div className="admin-log-icon" data-type={entry.type}>
            {entry.type === "auth" ? "🔐" :
             entry.type === "edit" ? "✏️" :
             entry.type === "delete" ? "🗑️" :
             entry.type === "add" ? "➕" :
             entry.type === "import" ? "📥" :
             entry.type === "export" ? "📤" : "•"}
          </div>
          <div className="admin-log-body">
            <div className="admin-log-message">{entry.message}</div>
            <div className="admin-log-time">{formatRelativeTime(entry.time)}</div>
          </div>
        </div>
      ))}
      {log.length > 50 && (
        <div className="admin-log-more">+{log.length - 50} eski kayıt</div>
      )}
      <button type="button" className="admin-log-clear" onClick={onClear}>
        Geçmişi temizle
      </button>
    </div>
  );
}

// =================== MAIN SHELL ===================
function AdminShell({ onLogout }) {
  const [activeTab, setActiveTab] = useState("players");
  const [activityLog, setActivityLog] = useState(() => getActivityLog());
  const [logVisible, setLogVisible] = useState(false);
  const { snapshot, updateSnapshot, resetToOriginal } = useDataStore();

  const diff = useMemo(() => computeDiff(snapshot), [snapshot]);

  const logActivity = useCallback((entry) => {
    const next = appendActivity(entry);
    setActivityLog(next);
  }, []);

  const handleClearLog = () => {
    if (window.confirm("Aktivite geçmişini silmek istediğine emin misin?")) {
      localStorage.removeItem(ACTIVITY_LOG_KEY);
      setActivityLog([]);
    }
  };

  const handleLogout = () => {
    if (diff.hasChanges) {
      const ok = window.confirm("Kaydedilmemiş değişikliklerin var! Yine de çıkmak istiyor musun? (Değişiklikler tarayıcıda kalır, sonra dönebilirsin.)");
      if (!ok) return;
    }
    appendActivity({ type: "auth", message: "Yönetici çıkış yaptı" });
    clearSession();
    onLogout();
  };

  const tabs = [
    { id: "players", label: "Oyuncular", icon: "🎮" },
    { id: "teams", label: "Takımlar", icon: "🛡️" },
    { id: "import", label: "Toplu Import", icon: "📥" },
    { id: "reports", label: "Raporlar", icon: "🚨" },
    { id: "export", label: "Dışa Aktar", icon: "📊" }
  ];

  const renderTab = () => {
    switch (activeTab) {
      case "players":
        return <PlayersTab snapshot={snapshot} updateSnapshot={updateSnapshot} logActivity={logActivity} />;
      case "teams":
        return <TeamsTab snapshot={snapshot} updateSnapshot={updateSnapshot} logActivity={logActivity} />;
      case "import":
        return <ImportTab snapshot={snapshot} updateSnapshot={updateSnapshot} logActivity={logActivity} />;
      case "reports":
        return <ReportsTab snapshot={snapshot} updateSnapshot={updateSnapshot} logActivity={logActivity} />;
      case "export":
        return <ExportTab snapshot={snapshot} resetToOriginal={resetToOriginal} logActivity={logActivity} />;
      default:
        return null;
    }
  };

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <span className="admin-brand-mark">⚙️</span>
          <div>
            <strong>PairFC Yönetim</strong>
            <small>Veri ve içerik kontrolü</small>
          </div>
        </div>

        {/* Save status — always visible */}
        {diff.hasChanges ? (
          <button
            type="button"
            className="admin-publish-cta"
            onClick={() => setActiveTab("export")}
            title="Tıkla → Dışa Aktar sekmesine git → Dosyaları indir → git push"
          >
            <span className="admin-publish-icon">📥</span>
            <span className="admin-publish-text">
              <strong>{diff.totalPlayerChanges + diff.totalTeamChanges} değişiklik</strong>
              <small>Canlıya almak için tıkla</small>
            </span>
          </button>
        ) : (
          <div className="admin-saved-indicator" title="Tüm değişiklikler tarayıcıda otomatik kaydediliyor">
            ✓ Otomatik kaydedildi
          </div>
        )}

        <div className="admin-topbar-actions">
          <button
            type="button"
            className="admin-icon-button"
            onClick={() => setLogVisible((v) => !v)}
            title="Aktivite geçmişi"
          >
            📋
          </button>
          <a href="/" className="admin-secondary-button">🎯 Oyuna Dön</a>
          <button type="button" className="admin-danger-button" onClick={handleLogout}>
            Çıkış
          </button>
        </div>
      </header>

      <div className="admin-body">
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
              <small>v0.2.0 · Faz 2</small>
            </div>
          </div>
        </aside>

        <main className="admin-main">
          {renderTab()}
        </main>

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

// =================== TOP-LEVEL ===================
export default function AdminPanel() {
  const [isAuthed, setIsAuthed] = useState(() => isSessionValid());

  // Check session validity every minute
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isSessionValid()) setIsAuthed(false);
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
