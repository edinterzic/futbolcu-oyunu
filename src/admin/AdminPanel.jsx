import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  PlayersTab, TeamsTab, ImportTab, ReportsTab, ExportTab, DuplicatesTab,
  useDataStore, computeDiff, formatRelativeTime
} from "./AdminTabs";
import { ADMIN_STYLES } from "./adminStyles";

// =================== SUPABASE AUTH ===================
// Supabase Auth ile yönetici girişi.
// Önceki versiyon: client-side SHA-256 hash (kaynak kodda görünüyordu, salt yok,
// brute-force'a açıktı). Yeni versiyon: Supabase'in server-side şifre doğrulaması.
//
// SETUP (lansman öncesi YAPILMASI GEREKEN):
// 1. Supabase dashboard → Authentication → Users → "Add user"
// 2. Email + güçlü şifre gir. "Auto Confirm" aç.
// 3. ADMIN_EMAILS dizisine o email'i ekle (case-sensitive).
// 4. (Opsiyonel) Supabase Authentication → Providers → Email → "Enable email
//    signups" kapatın (sadece sizin oluşturduğunuz hesaplar olsun).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Supabase Auth client — kendine özel storageKey ile (AdminTabs ile çakışmasın).
// persistSession: true → reload sonrası oturum korunur (8 saat default refresh).
const supabaseAuth = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "pairfc-admin-auth-session"
      }
    })
  : null;

// Whitelist: SADECE bu email'lere ait olanlar admin paneli görebilir.
// Supabase'de bu email'lerle oluşturulan kullanıcılar yetkili olur.
// Boş array = hiç kimse giriş yapamaz (deploy sonrası mutlaka doldurulmalı).
const ADMIN_EMAILS = new Set([
  // örn: "ozge@pairfc.com"
  // ⚠ Lansman öncesi BURAYI DOLDURUN, aksi takdirde panele giriş imkansız olur.
]);

const ACTIVITY_LOG_KEY = "pairfc_admin_activity_log";

// =================== AUTH HELPERS ===================
// Mevcut oturum yetkili mi? (Supabase session var + email whitelist'te)
async function checkAdminSession() {
  if (!supabaseAuth) return { valid: false, reason: "no_supabase" };
  const { data, error } = await supabaseAuth.auth.getSession();
  if (error || !data?.session) return { valid: false, reason: "no_session" };
  const email = data.session.user?.email;
  if (!email || !ADMIN_EMAILS.has(email)) {
    // Oturum var ama email whitelist dışı — sign out yap
    await supabaseAuth.auth.signOut();
    return { valid: false, reason: "not_admin" };
  }
  return { valid: true, email };
}

async function adminSignIn(email, password) {
  if (!supabaseAuth) {
    return { ok: false, error: "Supabase ayarları eksik. .env.local'da VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlı mı?" };
  }
  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) {
    return { ok: false, error: "Email veya şifre yanlış." };
  }
  const userEmail = data.user?.email;
  if (!userEmail || !ADMIN_EMAILS.has(userEmail)) {
    // Doğru şifre ama yetkisiz hesap — sign out yap
    await supabaseAuth.auth.signOut();
    return { ok: false, error: "Bu hesap admin yetkisine sahip değil." };
  }
  return { ok: true, email: userEmail };
}

async function adminSignOut() {
  if (!supabaseAuth) return;
  await supabaseAuth.auth.signOut();
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await adminSignIn(email, password);
      if (result.ok) {
        appendActivity({ type: "auth", message: `Yönetici giriş yaptı (${result.email})` });
        onLogin();
      } else {
        setError(result.error || "Bir hata oluştu.");
        // Brute-force yavaşlatma — sadece bu tarayıcıda etkili
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      setError("Beklenmedik hata: " + (err?.message || "bilinmiyor"));
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
          <p>Yönetici hesabınla giriş yap.</p>
        </div>

        <form onSubmit={handleSubmit} className="admin-login-form">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoFocus
            autoComplete="email"
            disabled={loading}
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Şifre"
            autoComplete="current-password"
            disabled={loading}
            required
          />
          <button type="submit" disabled={!email || !password || loading} className="admin-primary-button">
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

  const handleLogout = async () => {
    if (diff.hasChanges) {
      const ok = window.confirm("Kaydedilmemiş değişikliklerin var! Yine de çıkmak istiyor musun? (Değişiklikler tarayıcıda kalır, sonra dönebilirsin.)");
      if (!ok) return;
    }
    appendActivity({ type: "auth", message: "Yönetici çıkış yaptı" });
    await adminSignOut();
    onLogout();
  };

  const tabs = [
    { id: "players", label: "Oyuncular", icon: "🎮" },
    { id: "teams", label: "Takımlar", icon: "🛡️" },
    { id: "import", label: "Toplu Import", icon: "📥" },
    { id: "duplicates", label: "Yinelenenler", icon: "🔁" },
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
      case "duplicates":
        return <DuplicatesTab snapshot={snapshot} updateSnapshot={updateSnapshot} logActivity={logActivity} />;
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
  const [isAuthed, setIsAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  // İlk yükleme: mevcut Supabase session var mı kontrol et
  // Ayrıca onAuthStateChange ile token expiry / başka sekmeden logout vs. dinle
  useEffect(() => {
    let alive = true;

    checkAdminSession().then((result) => {
      if (!alive) return;
      setIsAuthed(result.valid);
      setChecking(false);
    });

    if (!supabaseAuth) return;
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange(
      async (event, session) => {
        if (!alive) return;
        if (event === "SIGNED_OUT" || !session) {
          setIsAuthed(false);
        } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          const email = session.user?.email;
          if (email && ADMIN_EMAILS.has(email)) {
            setIsAuthed(true);
          } else {
            await supabaseAuth.auth.signOut();
            setIsAuthed(false);
          }
        }
      }
    );

    return () => {
      alive = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Sayfa başlığı
  useEffect(() => {
    const prev = document.title;
    document.title = "Yönetim · PairFC";
    return () => { document.title = prev; };
  }, []);

  if (checking) {
    return (
      <div className="admin-root">
        <div className="admin-login-shell">
          <div className="admin-login-card" style={{ textAlign: "center" }}>
            <div className="admin-login-mark">⏳</div>
            <p>Oturum kontrol ediliyor...</p>
          </div>
        </div>
        <style>{ADMIN_STYLES}</style>
      </div>
    );
  }

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
