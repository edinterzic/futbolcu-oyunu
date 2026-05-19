import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { PLAYERS } from "../data/players";
import { TEAMS } from "../data/teams";
import { TEAM_LOGOS } from "../data/teamLogos";

// =================== SUPABASE ===================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: "pairfc-admin-auth"
      }
    })
  : null;

// =================== CONSTANTS ===================
const SNAPSHOT_KEY = "pairfc_admin_snapshot_v1";
const PAGE_SIZE = 50;
const COMMON_LEAGUES = [
  "Süper Lig", "Premier League", "La Liga", "Serie A",
  "Bundesliga", "Ligue 1", "Eredivisie", "Primeira Liga"
];

// =================== HELPERS ===================
export function normalizeText(s) {
  return String(s || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function formatRelativeTime(timestamp) {
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

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function getContrastColor(hex) {
  if (!hex) return "#ffffff";
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0f172a" : "#ffffff";
}

// =================== DATA STORE ===================
function buildFreshSnapshot() {
  const teams = TEAMS.map((entry) => {
    // TEAMS hem string array hem obje array olabilir — defansif
    const teamName = typeof entry === "string" ? entry : (entry?.name || "");
    const isObj = typeof entry === "object" && entry !== null;
    const style = TEAM_LOGOS[teamName] || {};
    return {
      name: teamName,
      initials: (isObj && entry.initials) || style.initials || "",
      primary: (isObj && entry.primary) || style.primary || "#10b981",
      secondary: (isObj && entry.secondary) || style.secondary || "#ffffff",
      country: (isObj && entry.country) || "",
      league: (isObj && entry.league) || "",
      founded: (isObj && entry.founded !== undefined) ? entry.founded : null,
      isActive: (isObj && entry.isActive !== undefined) ? entry.isActive : true
    };
  });
  const players = PLAYERS.map((p) => ({
    name: p.name,
    clubs: [...p.clubs],
    nationality: "",
    birthYear: null,
    isActive: null
  }));
  return { schemaVersion: 1, createdAt: Date.now(), lastModified: Date.now(), players, teams };
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (snap.schemaVersion !== 1) return null;

    // Migration: eski bozuk format düzelt — name'in iç içe obje olduğu durum
    let needsFix = false;
    if (Array.isArray(snap.teams)) {
      snap.teams = snap.teams.map((t) => {
        if (t && typeof t.name === "object" && t.name !== null) {
          needsFix = true;
          const inner = t.name;
          return {
            name: inner.name || "",
            initials: inner.initials || t.initials || "",
            primary: inner.primary || t.primary || "#10b981",
            secondary: inner.secondary || t.secondary || "#ffffff",
            country: inner.country || t.country || "",
            league: inner.league || t.league || "",
            founded: inner.founded ?? t.founded ?? null,
            isActive: inner.isActive !== undefined ? inner.isActive : (t.isActive !== undefined ? t.isActive : true)
          };
        }
        return t;
      });
      // Bozuk takımları filtre: name hâlâ string değilse at
      const before = snap.teams.length;
      snap.teams = snap.teams.filter((t) => typeof t.name === "string" && t.name.length > 0);
      if (snap.teams.length !== before) needsFix = true;
    }
    if (needsFix) {
      console.warn("[admin] Snapshot otomatik düzeltildi (eski bozuk format).");
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    }
    return snap;
  } catch { return null; }
}

function saveSnapshot(snapshot) {
  const next = { ...snapshot, lastModified: Date.now() };
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
    return next;
  } catch (err) {
    console.error("Snapshot save failed:", err);
    return snapshot;
  }
}

export function useDataStore() {
  const [snapshot, setSnapshot] = useState(() => loadSnapshot() || buildFreshSnapshot());

  useEffect(() => {
    if (!loadSnapshot()) saveSnapshot(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSnapshot = useCallback((updater) => {
    setSnapshot((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return saveSnapshot(next);
    });
  }, []);

  const resetToOriginal = useCallback(() => {
    localStorage.removeItem(SNAPSHOT_KEY);
    const fresh = buildFreshSnapshot();
    setSnapshot(fresh);
    saveSnapshot(fresh);
  }, []);

  return { snapshot, updateSnapshot, resetToOriginal };
}

export function computeDiff(snapshot) {
  const origPlayerNames = new Set(PLAYERS.map((p) => p.name));
  const origTeamNames = new Set(TEAMS);
  const curPlayerNames = new Set(snapshot.players.map((p) => p.name));
  const curTeamNames = new Set(snapshot.teams.map((t) => t.name));

  const addedPlayers = snapshot.players.filter((p) => !origPlayerNames.has(p.name));
  const removedPlayers = PLAYERS.filter((p) => !curPlayerNames.has(p.name));
  const origPlayerMap = new Map(PLAYERS.map((p) => [p.name, p]));
  const modifiedPlayers = snapshot.players.filter((p) => {
    if (!origPlayerMap.has(p.name)) return false;
    const orig = origPlayerMap.get(p.name);
    if (orig.clubs.length !== p.clubs.length) return true;
    const sa = [...orig.clubs].sort();
    const sb = [...p.clubs].sort();
    return sa.some((c, i) => c !== sb[i]);
  });

  const addedTeams = snapshot.teams.filter((t) => !origTeamNames.has(t.name));
  const removedTeams = TEAMS.filter((n) => !curTeamNames.has(n));
  const origTeamMap = new Map(TEAMS.map((n) => [n, TEAM_LOGOS[n] || {}]));
  const modifiedTeams = snapshot.teams.filter((t) => {
    if (!origTeamMap.has(t.name)) return false;
    const orig = origTeamMap.get(t.name);
    return orig.initials !== t.initials || orig.primary !== t.primary || orig.secondary !== t.secondary;
  });

  const totalPC = addedPlayers.length + removedPlayers.length + modifiedPlayers.length;
  const totalTC = addedTeams.length + removedTeams.length + modifiedTeams.length;

  return {
    addedPlayers, removedPlayers, modifiedPlayers,
    addedTeams, removedTeams, modifiedTeams,
    totalPlayerChanges: totalPC, totalTeamChanges: totalTC,
    hasChanges: totalPC + totalTC > 0
  };
}

function computeStats(snapshot) {
  const eligible = snapshot.players.filter((p) => p.clubs.length >= 2);
  const playerCountByTeam = new Map();
  for (const p of eligible) {
    for (const c of p.clubs) {
      playerCountByTeam.set(c, (playerCountByTeam.get(c) || 0) + 1);
    }
  }
  const activeTeams = snapshot.teams.filter((t) => playerCountByTeam.has(t.name));
  const pairs = new Set();
  for (const p of eligible) {
    const clubs = [...new Set(p.clubs)].filter((c) => playerCountByTeam.has(c));
    for (let i = 0; i < clubs.length; i += 1) {
      for (let j = i + 1; j < clubs.length; j += 1) {
        const [a, b] = [clubs[i], clubs[j]].sort();
        pairs.add(`${a}|${b}`);
      }
    }
  }
  const totalPossible = activeTeams.length * (activeTeams.length - 1) / 2;
  return {
    totalPlayers: snapshot.players.length,
    eligiblePlayers: eligible.length,
    excludedPlayers: snapshot.players.length - eligible.length,
    totalTeams: snapshot.teams.length,
    activeTeams: activeTeams.length,
    pairsWithAnswers: pairs.size,
    emptyPairs: totalPossible - pairs.size,
    totalPossiblePairs: totalPossible
  };
}

// =================== JS FILE GENERATORS ===================
function generateTeamsJS(snapshot) {
  const counts = new Map();
  for (const p of snapshot.players) {
    if (p.clubs.length >= 2) for (const c of p.clubs) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const active = snapshot.teams.filter((t) => counts.has(t.name));
  active.sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0));
  const list = active.map((t) => `  ${JSON.stringify(t.name)}`).join(",\n");
  return `// Auto-generated from admin panel
// Generated: ${new Date().toISOString()}

export const TEAMS = [
${list}
];
`;
}

function generatePlayersJS(snapshot) {
  const eligible = snapshot.players.filter((p) => p.clubs.length >= 2);
  eligible.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const entries = eligible.map((p) => {
    const clubs = p.clubs.map((c) => `      ${JSON.stringify(c)}`).join(",\n");
    return `  {
    "name": ${JSON.stringify(p.name)},
    "clubs": [
${clubs}
    ]
  }`;
  }).join(",\n");
  return `// Auto-generated from admin panel
// Generated: ${new Date().toISOString()}

export const PLAYERS = [
${entries}
];
`;
}

function generateAnswerIndexJS(snapshot) {
  const counts = new Map();
  for (const p of snapshot.players) {
    if (p.clubs.length >= 2) for (const c of p.clubs) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const active = snapshot.teams.filter((t) => counts.has(t.name));
  active.sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0));
  const teamIdx = new Map(active.map((t, i) => [t.name, i]));

  const index = {};
  const eligible = snapshot.players.filter((p) => p.clubs.length >= 2);
  for (const player of eligible) {
    const clubs = [...new Set(player.clubs)].filter((c) => teamIdx.has(c));
    clubs.sort((a, b) => teamIdx.get(a) - teamIdx.get(b));
    for (let i = 0; i < clubs.length; i += 1) {
      for (let j = i + 1; j < clubs.length; j += 1) {
        const key = `${clubs[i]}|${clubs[j]}`;
        if (!index[key]) index[key] = [];
        index[key].push(player.name);
      }
    }
  }
  for (const k of Object.keys(index)) index[k].sort((a, b) => a.localeCompare(b, "tr"));

  const entries = Object.entries(index).map(([k, ps]) => {
    const list = ps.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
    return `  ${JSON.stringify(k)}: [
${list}
  ]`;
  }).join(",\n");

  return `// Auto-generated from admin panel
// Generated: ${new Date().toISOString()}

import { TEAMS } from './teams';

export const ANSWER_INDEX = {
${entries}
};

export function getPairKey(teamA, teamB) {
  return [teamA, teamB]
    .sort((a, b) => TEAMS.indexOf(a) - TEAMS.indexOf(b))
    .join('|');
}

export function getAnswers(teamA, teamB) {
  return ANSWER_INDEX[getPairKey(teamA, teamB)] || [];
}
`;
}

function generateTeamLogosJS(snapshot) {
  const counts = new Map();
  for (const p of snapshot.players) {
    if (p.clubs.length >= 2) for (const c of p.clubs) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const active = snapshot.teams.filter((t) => counts.has(t.name));
  active.sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0));
  const entries = active.map((t) => `  ${JSON.stringify(t.name)}: {
    "initials": ${JSON.stringify(t.initials || "")},
    "primary": ${JSON.stringify(t.primary || "#10b981")},
    "secondary": ${JSON.stringify(t.secondary || "#ffffff")}
  }`).join(",\n");
  return `// Auto-generated from admin panel
// Generated: ${new Date().toISOString()}

export const TEAM_LOGOS = {
${entries}
};
`;
}

// =================== UI COMPONENTS ===================
export function Modal({ open, onClose, title, children, maxWidth = 520 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        <header className="admin-modal-header">
          <h3>{title}</h3>
          <button type="button" className="admin-icon-button" onClick={onClose} aria-label="Kapat">✕</button>
        </header>
        <div className="admin-modal-body">{children}</div>
      </div>
    </div>
  );
}

function useConfirm() {
  const [state, setState] = useState({ open: false });
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setState({
      open: true,
      title: opts.title || "Emin misin?",
      message: opts.message || "",
      confirmText: opts.confirmText || "Onayla",
      cancelText: opts.cancelText || "Vazgeç",
      danger: opts.danger ?? true,
      onResolve: resolve
    });
  }), []);
  const handle = (a) => { state.onResolve?.(a); setState({ open: false }); };
  const dialog = (
    <Modal open={state.open} onClose={() => handle(false)} title={state.title || ""} maxWidth={420}>
      <p style={{ margin: "0 0 20px", color: "var(--admin-text-muted)", lineHeight: 1.5 }}>{state.message}</p>
      <div className="admin-modal-actions">
        <button type="button" className="admin-secondary-button" onClick={() => handle(false)}>{state.cancelText}</button>
        <button type="button" className={state.danger ? "admin-danger-button-solid" : "admin-primary-button"} onClick={() => handle(true)}>{state.confirmText}</button>
      </div>
    </Modal>
  );
  return { confirm, dialog };
}

function TeamBadge({ team, size = 26 }) {
  if (!team) return null;
  return (
    <span className="admin-team-badge" style={{
      width: size, height: size,
      background: team.primary || "#10b981",
      color: getContrastColor(team.primary || "#10b981"),
      borderColor: team.secondary || "#ffffff",
      fontSize: Math.round(size * 0.36)
    }} title={team.name}>
      {team.initials || team.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

// =================== PLAYER EDITOR ===================
function PlayerEditor({ open, onClose, onSave, player, allTeams, existingNames }) {
  const isEdit = Boolean(player);
  const [name, setName] = useState("");
  const [clubs, setClubs] = useState([]);
  const [clubInput, setClubInput] = useState("");
  const [nationality, setNationality] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [isActive, setIsActive] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(player?.name || "");
      setClubs(player?.clubs ? [...player.clubs] : []);
      setClubInput(""); setError("");
      setNationality(player?.nationality || "");
      setBirthYear(player?.birthYear || "");
      setIsActive(player?.isActive ?? null);
    }
  }, [open, player]);

  const suggestions = useMemo(() => {
    if (!clubInput.trim()) return [];
    const q = normalizeText(clubInput);
    return allTeams.filter((t) => normalizeText(t.name).includes(q) && !clubs.includes(t.name)).slice(0, 8);
  }, [clubInput, allTeams, clubs]);

  const addClub = (n) => {
    if (!n.trim()) return;
    const exists = allTeams.find((t) => normalizeText(t.name) === normalizeText(n));
    if (!exists) { setError(`"${n}" takımı listede yok. Önce takımı ekle.`); return; }
    if (clubs.includes(exists.name)) { setError(`"${exists.name}" zaten ekli.`); return; }
    setClubs([...clubs, exists.name]); setClubInput(""); setError("");
  };

  const handleSave = () => {
    const tn = name.trim();
    if (!tn) { setError("Oyuncu adı boş olamaz."); return; }
    if (clubs.length === 0) { setError("En az 1 takım eklemelisin."); return; }
    if (clubs.length < 2 && !isEdit) { setError("Yeni oyuncuda en az 2 takım olmalı."); return; }
    if (existingNames.includes(tn) && (!isEdit || tn !== player.name)) { setError(`"${tn}" zaten ekli.`); return; }
    const yr = birthYear ? parseInt(birthYear, 10) : null;
    if (birthYear && (isNaN(yr) || yr < 1900 || yr > new Date().getFullYear())) { setError("Geçerli bir doğum yılı gir."); return; }
    onSave({ originalName: isEdit ? player.name : null, name: tn, clubs, nationality: nationality.trim(), birthYear: yr, isActive });
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "✏️ Oyuncuyu Düzenle" : "➕ Yeni Oyuncu"} maxWidth={580}>
      <div className="admin-form-row">
        <label>Oyuncu Adı *</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Didier Drogba" autoFocus />
      </div>
      <div className="admin-form-row">
        <label>Takımları * (en az 2)</label>
        <div className="admin-chips">
          {clubs.map((c) => (
            <span key={c} className="admin-chip">{c}<button type="button" onClick={() => setClubs(clubs.filter((x) => x !== c))} aria-label="Kaldır">✕</button></span>
          ))}
        </div>
        <div className="admin-autocomplete">
          <input type="text" value={clubInput} onChange={(e) => setClubInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (suggestions.length) addClub(suggestions[0].name); else if (clubInput.trim()) addClub(clubInput.trim()); } }}
            placeholder="Takım yaz, Enter'a bas veya öneriden seç" />
          {suggestions.length > 0 && (
            <div className="admin-suggestions">
              {suggestions.map((t) => (
                <button key={t.name} type="button" className="admin-suggestion" onClick={() => addClub(t.name)}>
                  <TeamBadge team={t} size={20} /><span>{t.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <details className="admin-form-details">
        <summary>İsteğe bağlı bilgiler (sonra doldurabilirsin)</summary>
        <div className="admin-form-grid">
          <div className="admin-form-row"><label>Milliyet</label><input type="text" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Örn: Türkiye" /></div>
          <div className="admin-form-row"><label>Doğum Yılı</label><input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="Örn: 1978" /></div>
        </div>
        <div className="admin-form-row">
          <label>Aktiflik Durumu</label>
          <div className="admin-radio-group">
            <button type="button" className={`admin-radio-pill ${isActive === true ? "active" : ""}`} onClick={() => setIsActive(true)}>⚽ Aktif</button>
            <button type="button" className={`admin-radio-pill ${isActive === false ? "active" : ""}`} onClick={() => setIsActive(false)}>🏖️ Emekli</button>
            <button type="button" className={`admin-radio-pill ${isActive === null ? "active" : ""}`} onClick={() => setIsActive(null)}>❓ Bilinmiyor</button>
          </div>
        </div>
      </details>
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-modal-actions">
        <button type="button" className="admin-secondary-button" onClick={onClose}>Vazgeç</button>
        <button type="button" className="admin-primary-button" onClick={handleSave}>{isEdit ? "Kaydet" : "Ekle"}</button>
      </div>
    </Modal>
  );
}

// =================== TEAM EDITOR ===================
function TeamEditor({ open, onClose, onSave, team, existingNames }) {
  const isEdit = Boolean(team);
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [primary, setPrimary] = useState("#10b981");
  const [secondary, setSecondary] = useState("#ffffff");
  const [country, setCountry] = useState("");
  const [league, setLeague] = useState("");
  const [founded, setFounded] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(team?.name || "");
      setInitials(team?.initials || "");
      setPrimary(team?.primary || "#10b981");
      setSecondary(team?.secondary || "#ffffff");
      setCountry(team?.country || ""); setLeague(team?.league || "");
      setFounded(team?.founded || ""); setError("");
    }
  }, [open, team]);

  const autoInitials = useMemo(() => {
    if (!name) return "";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
    return parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
  }, [name]);

  const handleSave = () => {
    const tn = name.trim();
    if (!tn) { setError("Takım adı boş olamaz."); return; }
    if (existingNames.includes(tn) && (!isEdit || tn !== team.name)) { setError(`"${tn}" zaten ekli.`); return; }
    const yr = founded ? parseInt(founded, 10) : null;
    if (founded && (isNaN(yr) || yr < 1800 || yr > new Date().getFullYear())) { setError("Geçerli bir kuruluş yılı gir."); return; }
    onSave({ originalName: isEdit ? team.name : null, name: tn,
      initials: (initials || autoInitials).toUpperCase().slice(0, 5),
      primary, secondary, country: country.trim(), league: league.trim(), founded: yr });
  };

  const previewTeam = { name: name || "Takım", initials: initials || autoInitials, primary, secondary };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "✏️ Takımı Düzenle" : "➕ Yeni Takım"} maxWidth={560}>
      <div className="admin-team-preview-row">
        <TeamBadge team={previewTeam} size={56} />
        <div><div className="admin-team-preview-name">{previewTeam.name}</div><div className="admin-team-preview-meta">Rozet önizleme</div></div>
      </div>
      <div className="admin-form-row"><label>Takım Adı *</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Galatasaray" autoFocus /></div>
      <div className="admin-form-grid">
        <div className="admin-form-row">
          <label>Kısaltma (2-5 harf)</label>
          <input type="text" value={initials} onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 5))} placeholder={autoInitials || "Örn: GS"} maxLength={5} />
          <small style={{ color: "var(--admin-text-muted)", fontSize: 11 }}>Boş bırakırsan: "{autoInitials}"</small>
        </div>
      </div>
      <div className="admin-form-grid">
        <div className="admin-form-row">
          <label>Ana Renk</label>
          <div className="admin-color-input"><input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} /><input type="text" value={primary} onChange={(e) => setPrimary(e.target.value)} /></div>
        </div>
        <div className="admin-form-row">
          <label>İkincil Renk</label>
          <div className="admin-color-input"><input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} /><input type="text" value={secondary} onChange={(e) => setSecondary(e.target.value)} /></div>
        </div>
      </div>
      <details className="admin-form-details">
        <summary>İsteğe bağlı bilgiler</summary>
        <div className="admin-form-grid">
          <div className="admin-form-row"><label>Ülke</label><input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Örn: Türkiye" /></div>
          <div className="admin-form-row">
            <label>Lig</label>
            <input type="text" value={league} onChange={(e) => setLeague(e.target.value)} list="admin-league-list" placeholder="Örn: Süper Lig" />
            <datalist id="admin-league-list">{COMMON_LEAGUES.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
        </div>
        <div className="admin-form-row"><label>Kuruluş Yılı</label><input type="number" value={founded} onChange={(e) => setFounded(e.target.value)} placeholder="Örn: 1905" /></div>
      </details>
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-modal-actions">
        <button type="button" className="admin-secondary-button" onClick={onClose}>Vazgeç</button>
        <button type="button" className="admin-primary-button" onClick={handleSave}>{isEdit ? "Kaydet" : "Ekle"}</button>
      </div>
    </Modal>
  );
}

// =================== PLAYERS TAB ===================
export function PlayersTab({ snapshot, updateSnapshot, logActivity }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name-asc");
  const [clubCountFilter, setClubCountFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const { confirm, dialog } = useConfirm();

  const teamMap = useMemo(() => new Map(snapshot.teams.map((t) => [t.name, t])), [snapshot.teams]);

  const filtered = useMemo(() => {
    let list = [...snapshot.players];
    if (clubCountFilter === "single") {
      list = list.filter((p) => p.clubs.length < 2);
    } else if (clubCountFilter === "multi") {
      list = list.filter((p) => p.clubs.length >= 2);
    }
    if (search.trim()) {
      const q = normalizeText(search);
      list = list.filter((p) => normalizeText(p.name).includes(q) || p.clubs.some((c) => normalizeText(c).includes(q)));
    }
    switch (sortBy) {
      case "name-asc": list.sort((a, b) => a.name.localeCompare(b.name, "tr")); break;
      case "name-desc": list.sort((a, b) => b.name.localeCompare(a.name, "tr")); break;
      case "clubs-desc": list.sort((a, b) => b.clubs.length - a.clubs.length || a.name.localeCompare(b.name, "tr")); break;
      case "clubs-asc": list.sort((a, b) => a.clubs.length - b.clubs.length || a.name.localeCompare(b.name, "tr")); break;
      default: break;
    }
    return list;
  }, [snapshot.players, search, sortBy, clubCountFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, sortBy, clubCountFilter]);

  const handleSave = (data) => {
    updateSnapshot((prev) => {
      let next = [...prev.players];
      if (data.originalName) {
        const idx = next.findIndex((p) => p.name === data.originalName);
        if (idx >= 0) next[idx] = { name: data.name, clubs: data.clubs, nationality: data.nationality, birthYear: data.birthYear, isActive: data.isActive };
        logActivity({ type: "edit", message: `"${data.originalName}" düzenlendi → "${data.name}" (${data.clubs.length} takım)` });
      } else {
        next.push({ name: data.name, clubs: data.clubs, nationality: data.nationality, birthYear: data.birthYear, isActive: data.isActive });
        logActivity({ type: "add", message: `"${data.name}" eklendi (${data.clubs.length} takım)` });
      }
      return { ...prev, players: next };
    });
    setEditorOpen(false); setEditingPlayer(null);
  };

  const handleDelete = async (n) => {
    const ok = await confirm({ title: "Oyuncuyu sil?", message: `"${n}" silinecek. Dosyaları indirip push edince canlıda da silinir.`, confirmText: "Sil", danger: true });
    if (!ok) return;
    updateSnapshot((prev) => ({ ...prev, players: prev.players.filter((p) => p.name !== n) }));
    logActivity({ type: "delete", message: `"${n}" silindi` });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    const ok = await confirm({ title: "Toplu sil?", message: `${selected.size} oyuncu silinecek. Geri alınamaz.`, confirmText: `${selected.size} oyuncuyu sil`, danger: true });
    if (!ok) return;
    updateSnapshot((prev) => ({ ...prev, players: prev.players.filter((p) => !selected.has(p.name)) }));
    logActivity({ type: "delete", message: `${selected.size} oyuncu toplu silindi` });
    setSelected(new Set());
  };

  const toggle = (n) => setSelected((p) => { const s = new Set(p); if (s.has(n)) s.delete(n); else s.add(n); return s; });
  const toggleAll = () => {
    const allSelected = visible.every((p) => selected.has(p.name));
    setSelected((prev) => { const s = new Set(prev); visible.forEach((p) => allSelected ? s.delete(p.name) : s.add(p.name)); return s; });
  };

  const existingNames = useMemo(() => snapshot.players.map((p) => p.name), [snapshot.players]);

  return (
    <div className="admin-tab-content">
      <header className="admin-tab-header">
        <div><h2>🎮 Oyuncular</h2><p className="admin-tab-subtitle">Toplam {snapshot.players.length} oyuncu · {filtered.length} eşleşen</p></div>
        <button type="button" className="admin-primary-button" onClick={() => { setEditingPlayer(null); setEditorOpen(true); }}>➕ Yeni Oyuncu</button>
      </header>
      <div className="admin-toolbar">
        <input type="text" className="admin-search" placeholder="🔍 İsim veya takım ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="admin-select" value={clubCountFilter} onChange={(e) => setClubCountFilter(e.target.value)}>
          <option value="all">Tüm oyuncular</option>
          <option value="multi">Çok takımlı (quiz'de kullanılır)</option>
          <option value="single">Tek takımlı (quiz dışı)</option>
        </select>
        <select className="admin-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="name-asc">İsim (A-Z)</option>
          <option value="name-desc">İsim (Z-A)</option>
          <option value="clubs-desc">Takım sayısı (çoktan aza)</option>
          <option value="clubs-asc">Takım sayısı (azdan çoğa)</option>
        </select>
      </div>
      {selected.size > 0 && (
        <div className="admin-bulk-actions">
          <span>{selected.size} oyuncu seçili</span>
          <button type="button" className="admin-danger-button-solid" onClick={handleBulkDelete}>🗑️ Seçili olanları sil</button>
          <button type="button" className="admin-secondary-button" onClick={() => setSelected(new Set())}>Seçimi temizle</button>
        </div>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr>
            <th style={{ width: 32 }}><input type="checkbox" checked={visible.length > 0 && visible.every((p) => selected.has(p.name))} onChange={toggleAll} /></th>
            <th>Oyuncu</th><th>Takımları</th><th style={{ width: 100 }}>İşlem</th>
          </tr></thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.name} className={selected.has(p.name) ? "selected" : ""}>
                <td><input type="checkbox" checked={selected.has(p.name)} onChange={() => toggle(p.name)} /></td>
                <td>
                  <div className="admin-player-name">{p.name}</div>
                  {p.clubs.length < 2 && <span className="admin-warn-badge" title="Quiz'de kullanılmaz">⚠️ Tek takım</span>}
                </td>
                <td>
                  <div className="admin-club-badges">
                    {p.clubs.map((c) => { const t = teamMap.get(c); return (
                      <span key={c} className="admin-club-row">{t && <TeamBadge team={t} size={18} />}<span className="admin-club-name">{c}</span></span>
                    ); })}
                  </div>
                </td>
                <td>
                  <div className="admin-row-actions">
                    <button type="button" className="admin-icon-button-small" onClick={() => { setEditingPlayer(p); setEditorOpen(true); }} title="Düzenle">✏️</button>
                    <button type="button" className="admin-icon-button-small admin-icon-danger" onClick={() => handleDelete(p.name)} title="Sil">🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--admin-text-muted)" }}>Sonuç bulunamadı.</td></tr>}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="admin-pagination">
          <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Önceki</button>
          <span>Sayfa {safePage + 1} / {totalPages}</span>
          <button type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Sonraki →</button>
        </div>
      )}
      <PlayerEditor open={editorOpen} onClose={() => { setEditorOpen(false); setEditingPlayer(null); }} onSave={handleSave} player={editingPlayer} allTeams={snapshot.teams} existingNames={existingNames} />
      {dialog}
    </div>
  );
}

// =================== TEAMS TAB ===================
export function TeamsTab({ snapshot, updateSnapshot, logActivity }) {
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const { confirm, dialog } = useConfirm();

  const playerCount = useMemo(() => {
    const m = new Map();
    snapshot.players.forEach((p) => p.clubs.forEach((c) => m.set(c, (m.get(c) || 0) + 1)));
    return m;
  }, [snapshot.players]);

  const filtered = useMemo(() => {
    let list = [...snapshot.teams];
    if (search.trim()) {
      const q = normalizeText(search);
      list = list.filter((t) => normalizeText(t.name).includes(q) || normalizeText(t.initials || "").includes(q) || normalizeText(t.country || "").includes(q) || normalizeText(t.league || "").includes(q));
    }
    list.sort((a, b) => (playerCount.get(b.name) || 0) - (playerCount.get(a.name) || 0));
    return list;
  }, [snapshot.teams, search, playerCount]);

  const handleSave = (data) => {
    updateSnapshot((prev) => {
      let nextTeams = [...prev.teams];
      let nextPlayers = [...prev.players];
      if (data.originalName) {
        const idx = nextTeams.findIndex((t) => t.name === data.originalName);
        if (idx >= 0) nextTeams[idx] = { name: data.name, initials: data.initials, primary: data.primary, secondary: data.secondary, country: data.country, league: data.league, founded: data.founded };
        if (data.originalName !== data.name) {
          nextPlayers = nextPlayers.map((p) => ({ ...p, clubs: p.clubs.map((c) => c === data.originalName ? data.name : c) }));
          logActivity({ type: "edit", message: `"${data.originalName}" → "${data.name}" yeniden adlandırıldı` });
        } else {
          logActivity({ type: "edit", message: `"${data.name}" takımı düzenlendi` });
        }
      } else {
        nextTeams.push({ name: data.name, initials: data.initials, primary: data.primary, secondary: data.secondary, country: data.country, league: data.league, founded: data.founded });
        logActivity({ type: "add", message: `"${data.name}" takımı eklendi` });
      }
      return { ...prev, teams: nextTeams, players: nextPlayers };
    });
    setEditorOpen(false); setEditingTeam(null);
  };

  const handleDelete = async (n) => {
    const count = playerCount.get(n) || 0;
    const ok = await confirm({
      title: "Takımı sil?",
      message: count > 0 ? `"${n}" silinecek ve ${count} oyuncunun kulüp listesinden çıkarılacak.` : `"${n}" silinecek.`,
      confirmText: "Sil", danger: true
    });
    if (!ok) return;
    updateSnapshot((prev) => ({
      ...prev,
      teams: prev.teams.filter((t) => t.name !== n),
      players: prev.players.map((p) => ({ ...p, clubs: p.clubs.filter((c) => c !== n) }))
    }));
    logActivity({ type: "delete", message: `"${n}" takımı silindi (${count} oyuncudan çıkarıldı)` });
  };

  const existingNames = useMemo(() => snapshot.teams.map((t) => t.name), [snapshot.teams]);

  return (
    <div className="admin-tab-content">
      <header className="admin-tab-header">
        <div><h2>🛡️ Takımlar</h2><p className="admin-tab-subtitle">Toplam {snapshot.teams.length} takım · {filtered.length} eşleşen</p></div>
        <button type="button" className="admin-primary-button" onClick={() => { setEditingTeam(null); setEditorOpen(true); }}>➕ Yeni Takım</button>
      </header>
      <div className="admin-toolbar">
        <input type="text" className="admin-search" placeholder="🔍 Takım, kısaltma, ülke veya lig ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="admin-team-grid">
        {filtered.map((t) => {
          const c = playerCount.get(t.name) || 0;
          return (
            <div key={t.name} className="admin-team-card">
              <div className="admin-team-card-header">
                <TeamBadge team={t} size={42} />
                <div className="admin-team-card-info">
                  <div className="admin-team-card-name">{t.name}</div>
                  <div className="admin-team-card-meta">{t.league || t.country || "—"}{c > 0 && <span className="admin-team-card-count">· {c} oyuncu</span>}</div>
                </div>
              </div>
              <div className="admin-team-card-actions">
                <button type="button" className="admin-icon-button-small" onClick={() => { setEditingTeam(t); setEditorOpen(true); }} title="Düzenle">✏️</button>
                <button type="button" className="admin-icon-button-small admin-icon-danger" onClick={() => handleDelete(t.name)} title="Sil">🗑️</button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="admin-empty-state">Sonuç bulunamadı.</div>}
      </div>
      <TeamEditor open={editorOpen} onClose={() => { setEditorOpen(false); setEditingTeam(null); }} onSave={handleSave} team={editingTeam} existingNames={existingNames} />
      {dialog}
    </div>
  );
}

// =================== IMPORT TAB ===================
export function ImportTab({ snapshot, updateSnapshot, logActivity }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const parse = () => {
    setError("");
    if (!text.trim()) { setError("Önce veri yapıştır."); return; }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setError("Veri boş."); return; }
    let delim = "\t";
    if (lines[0].indexOf("\t") === -1) delim = lines[0].indexOf(";") !== -1 ? ";" : ",";
    const rows = lines.map((l) => l.split(delim).map((c) => c.trim()).filter(Boolean));

    const existingP = new Set(snapshot.players.map((p) => p.name));
    const existingT = new Set(snapshot.teams.map((t) => t.name));
    const tMap = new Map();
    snapshot.teams.forEach((t) => tMap.set(normalizeText(t.name), t.name));

    const result = { newPlayers: [], updatedPlayers: [], newTeams: new Set(), skipped: [], errors: [] };
    rows.forEach((row, idx) => {
      if (row.length < 2) { result.errors.push({ row: idx + 1, message: "En az 1 oyuncu + 1 takım gerekli", raw: row.join(delim) }); return; }
      const [pname, ...clubs] = row;
      if (!pname) { result.errors.push({ row: idx + 1, message: "Oyuncu adı boş", raw: row.join(delim) }); return; }
      const resolved = [];
      const newTs = [];
      clubs.forEach((c) => {
        const n = normalizeText(c);
        if (tMap.has(n)) resolved.push(tMap.get(n));
        else if (existingT.has(c)) resolved.push(c);
        else { result.newTeams.add(c); newTs.push(c); resolved.push(c); }
      });
      const unique = [...new Set(resolved)];
      if (existingP.has(pname)) {
        const ex = snapshot.players.find((p) => p.name === pname);
        const add = unique.filter((c) => !ex.clubs.includes(c));
        if (add.length === 0) result.skipped.push({ name: pname, reason: "Tüm takımları zaten ekli" });
        else result.updatedPlayers.push({ name: pname, originalClubs: ex.clubs, newClubs: add, finalClubs: [...ex.clubs, ...add] });
      } else {
        result.newPlayers.push({ name: pname, clubs: unique, willAddTeams: newTs });
      }
    });
    setPreview(result);
  };

  const apply = () => {
    if (!preview) return;
    updateSnapshot((prev) => {
      let nextT = [...prev.teams];
      let nextP = [...prev.players];
      preview.newTeams.forEach((tn) => {
        if (nextT.some((t) => t.name === tn)) return;
        const init = tn.split(/\s+/).map((p) => p[0]).join("").slice(0, 3).toUpperCase();
        nextT.push({ name: tn, initials: init, primary: "#10b981", secondary: "#ffffff", country: "", league: "", founded: null });
      });
      preview.newPlayers.forEach((np) => nextP.push({ name: np.name, clubs: np.clubs, nationality: "", birthYear: null, isActive: null }));
      preview.updatedPlayers.forEach((up) => {
        const idx = nextP.findIndex((p) => p.name === up.name);
        if (idx >= 0) nextP[idx] = { ...nextP[idx], clubs: up.finalClubs };
      });
      return { ...prev, teams: nextT, players: nextP };
    });
    const total = preview.newPlayers.length + preview.updatedPlayers.length + preview.newTeams.size;
    logActivity({ type: "import", message: `Import: ${preview.newPlayers.length} yeni oyuncu, ${preview.updatedPlayers.length} güncelleme, ${preview.newTeams.size} yeni takım` });
    setText(""); setPreview(null); setError("");
    alert(`İçe aktarma tamamlandı: ${total} değişiklik.`);
  };

  return (
    <div className="admin-tab-content">
      <header className="admin-tab-header">
        <div><h2>📥 Toplu Import</h2><p className="admin-tab-subtitle">Excel'den hücreleri kopyalayıp yapıştır.</p></div>
      </header>
      <div className="admin-import-help">
        <strong>Format örneği:</strong>
        <pre>{`Drogba	Chelsea	Galatasaray	Marsilya
Mert Günok	Fenerbahçe	Beşiktaş	Başakşehir
Wesley Sneijder	Real Madrid	Inter	Galatasaray`}</pre>
        <small>• İlk sütun: oyuncu adı · Sonraki sütunlar: takım(lar)<br/>• Sekme, virgül veya noktalı virgül ayraç olarak çalışır<br/>• Yeni takımlar otomatik eklenir (sonra renkleri düzenle)<br/>• Mevcut oyuncuların yeni takımları varsa listesi genişler</small>
      </div>
      {!preview && (
        <>
          <textarea className="admin-import-textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Excel'den kopyalanan hücreleri buraya yapıştır (Ctrl+V)..." rows={10} />
          {error && <div className="admin-error">{error}</div>}
          <div className="admin-modal-actions">
            <button type="button" className="admin-secondary-button" onClick={() => setText("")}>Temizle</button>
            <button type="button" className="admin-primary-button" onClick={parse} disabled={!text.trim()}>🔍 Önizlemeyi Göster</button>
          </div>
        </>
      )}
      {preview && (
        <div className="admin-import-preview">
          <div className="admin-import-summary">
            <div className="admin-summary-card admin-summary-add"><div className="admin-summary-num">{preview.newPlayers.length}</div><div className="admin-summary-label">Yeni oyuncu</div></div>
            <div className="admin-summary-card admin-summary-update"><div className="admin-summary-num">{preview.updatedPlayers.length}</div><div className="admin-summary-label">Güncellenecek</div></div>
            <div className="admin-summary-card admin-summary-team"><div className="admin-summary-num">{preview.newTeams.size}</div><div className="admin-summary-label">Yeni takım</div></div>
            <div className="admin-summary-card admin-summary-skip"><div className="admin-summary-num">{preview.skipped.length}</div><div className="admin-summary-label">Atlanan</div></div>
            {preview.errors.length > 0 && <div className="admin-summary-card admin-summary-error"><div className="admin-summary-num">{preview.errors.length}</div><div className="admin-summary-label">Hata</div></div>}
          </div>
          {preview.newTeams.size > 0 && (
            <div className="admin-import-section">
              <h4>🆕 Eklenecek Takımlar ({preview.newTeams.size})</h4>
              <div className="admin-import-chips">{[...preview.newTeams].map((t) => <span key={t} className="admin-chip">{t}</span>)}</div>
              <small style={{ color: "var(--admin-text-muted)" }}>Bu takımlar varsayılan renk ile eklenecek. Sonra "Takımlar" sekmesinden düzenle.</small>
            </div>
          )}
          {preview.newPlayers.length > 0 && (
            <div className="admin-import-section">
              <h4>➕ Yeni Oyuncular ({preview.newPlayers.length})</h4>
              <div className="admin-import-list">
                {preview.newPlayers.slice(0, 30).map((p, i) => <div key={i} className="admin-import-row admin-import-row-add"><strong>{p.name}</strong><span>{p.clubs.join(", ")}</span></div>)}
                {preview.newPlayers.length > 30 && <small>... ve {preview.newPlayers.length - 30} oyuncu daha</small>}
              </div>
            </div>
          )}
          {preview.updatedPlayers.length > 0 && (
            <div className="admin-import-section">
              <h4>🔄 Güncellenecek ({preview.updatedPlayers.length})</h4>
              <div className="admin-import-list">
                {preview.updatedPlayers.slice(0, 30).map((p, i) => <div key={i} className="admin-import-row admin-import-row-update"><strong>{p.name}</strong><span>+{p.newClubs.join(", +")}</span></div>)}
                {preview.updatedPlayers.length > 30 && <small>... ve {preview.updatedPlayers.length - 30} daha</small>}
              </div>
            </div>
          )}
          {preview.errors.length > 0 && (
            <div className="admin-import-section">
              <h4>❌ Hatalar ({preview.errors.length})</h4>
              <div className="admin-import-list">
                {preview.errors.slice(0, 10).map((e, i) => <div key={i} className="admin-import-row admin-import-row-error"><strong>Satır {e.row}:</strong> {e.message}<small style={{ display: "block", opacity: 0.7 }}>{e.raw}</small></div>)}
              </div>
            </div>
          )}
          <div className="admin-modal-actions">
            <button type="button" className="admin-secondary-button" onClick={() => setPreview(null)}>⬅️ Geri Dön</button>
            <button type="button" className="admin-primary-button" onClick={apply} disabled={preview.newPlayers.length + preview.updatedPlayers.length === 0}>✅ İçeri Aktar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// =================== REPORT EDITOR MODAL ===================
function ReportEditor({ open, onClose, report, onApprove, snapshotPlayers }) {
  const [editedName, setEditedName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && report) {
      setEditedName(report.answer || "");
      setError("");
    }
  }, [open, report]);

  if (!report) return null;

  const finalName = editedName.trim();
  const isNameChanged = finalName !== (report.answer || "").trim();
  const existingPlayer = snapshotPlayers.find((p) => normalizeText(p.name) === normalizeText(finalName));

  const handleApprove = () => {
    if (!finalName) { setError("Oyuncu adı boş olamaz."); return; }
    onApprove({ reportId: report.id, finalName, isExisting: !!existingPlayer });
  };

  return (
    <Modal open={open} onClose={onClose} title="✏️ Raporu Düzenle ve Onayla" maxWidth={520}>
      <div className="admin-report-edit-context">
        <span className="admin-report-edit-context-label">Takım Çifti</span>
        <div className="admin-report-edit-context-teams">
          <span>{report.team_a}</span>
          <span style={{ color: "var(--admin-text-muted)" }}>↔</span>
          <span>{report.team_b}</span>
        </div>
      </div>

      {isNameChanged && (
        <div className="admin-report-edit-original">
          <strong>Orijinal öneri:</strong> "{report.answer}" → düzeltme yapılıyor
        </div>
      )}

      <div className="admin-form-row">
        <label>Oyuncu Adı (düzeltebilirsin)</label>
        <input
          type="text"
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          placeholder="Örn: Mert Günok"
          autoFocus
        />
        <small style={{ color: "var(--admin-text-muted)", fontSize: 12, marginTop: 6, display: "block" }}>
          {existingPlayer
            ? `✓ "${existingPlayer.name}" zaten veride mevcut. Onaylanırsa bu iki takım onun kulüp listesine eklenir.`
            : `🆕 Bu isim veride yok. Onaylanırsa "${finalName || "..."}" yeni oyuncu olarak eklenecek.`}
        </small>
      </div>

      {report.feedback && (
        <div className="admin-form-row">
          <label>Kullanıcı Notu</label>
          <div className="admin-report-feedback" style={{ marginTop: 0 }}>{report.feedback}</div>
        </div>
      )}

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-modal-actions">
        <button type="button" className="admin-secondary-button" onClick={onClose}>Vazgeç</button>
        <button type="button" className="admin-primary-button" onClick={handleApprove}>
          ✅ Onayla ve Veriye Ekle
        </button>
      </div>
    </Modal>
  );
}

// =================== REPORTS TAB ===================
export function ReportsTab({ snapshot, updateSnapshot, logActivity }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingReport, setEditingReport] = useState(null);
  const { confirm, dialog } = useConfirm();

  const playerIndex = useMemo(() => {
    const map = new Map();
    snapshot.players.forEach((p) => map.set(normalizeText(p.name), p));
    return map;
  }, [snapshot.players]);

  const fetchReports = useCallback(async () => {
    if (!supabase) {
      setError("Supabase bağlantısı yapılandırılmamış. .env.local içindeki VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY değerlerini kontrol et.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("answer_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (err) throw err;
      setReports(data || []);
    } catch (e) {
      setError(`Raporlar yüklenemedi: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const filtered = useMemo(() => {
    if (!search.trim()) return reports;
    const q = normalizeText(search);
    return reports.filter((r) =>
      normalizeText(r.answer || "").includes(q) ||
      normalizeText(r.team_a || "").includes(q) ||
      normalizeText(r.team_b || "").includes(q) ||
      normalizeText(r.player_name || "").includes(q) ||
      normalizeText(r.feedback || "").includes(q)
    );
  }, [reports, search]);

  const deleteReport = async (reportId) => {
    if (!supabase) return;
    const { error: err } = await supabase.from("answer_reports").delete().eq("id", reportId);
    if (err) throw err;
    setReports((prev) => prev.filter((r) => r.id !== reportId));
  };

  const handleApprove = async ({ reportId, finalName, isExisting }) => {
    const report = reports.find((r) => r.id === reportId);
    if (!report) return;

    try {
      // Update snapshot: add player or extend existing player's clubs
      updateSnapshot((prev) => {
        const teams = [report.team_a, report.team_b].filter(Boolean);
        const existing = prev.players.find((p) => normalizeText(p.name) === normalizeText(finalName));
        if (existing) {
          // Add new clubs to existing player
          const newClubs = teams.filter((t) => !existing.clubs.includes(t));
          if (newClubs.length === 0) return prev;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p === existing ? { ...p, clubs: [...p.clubs, ...newClubs] } : p
            )
          };
        }
        // New player
        return {
          ...prev,
          players: [...prev.players, { name: finalName, clubs: teams, nationality: "", birthYear: null, isActive: null }]
        };
      });

      // Delete report from Supabase
      await deleteReport(reportId);

      logActivity({
        type: "import",
        message: `Rapor onaylandı: "${finalName}" (${report.team_a} - ${report.team_b})${isExisting ? " — mevcut oyuncuya takım eklendi" : " — yeni oyuncu"}`
      });

      setEditingReport(null);
    } catch (e) {
      alert(`Hata: ${e.message}`);
    }
  };

  const handleReject = async (report) => {
    const ok = await confirm({
      title: "Raporu reddet?",
      message: `"${report.answer}" önerisi reddedilecek ve rapor silinecek. Veriye eklenmeyecek.`,
      confirmText: "Reddet ve Sil",
      danger: true
    });
    if (!ok) return;
    try {
      await deleteReport(report.id);
      logActivity({ type: "delete", message: `Rapor reddedildi: "${report.answer}" (${report.team_a} - ${report.team_b})` });
    } catch (e) {
      alert(`Hata: ${e.message}`);
    }
  };

  const handleQuickAccept = async (report) => {
    // For reports where the answer matches an existing player exactly,
    // offer a one-click confirm without opening the modal
    const existing = playerIndex.get(normalizeText(report.answer || ""));
    const teams = [report.team_a, report.team_b].filter(Boolean);
    const newClubs = existing ? teams.filter((t) => !existing.clubs.includes(t)) : [];
    if (existing && newClubs.length === 0) {
      // Player already has both clubs — just delete the report
      const ok = await confirm({
        title: "Zaten veride var",
        message: `"${existing.name}" oyuncusu zaten ${teams.join(" ve ")} takımları için kayıtlı. Raporu silmek ister misin?`,
        confirmText: "Raporu Sil",
        danger: false
      });
      if (!ok) return;
      try {
        await deleteReport(report.id);
        logActivity({ type: "delete", message: `Rapor silindi (zaten mevcut): "${report.answer}"` });
      } catch (e) {
        alert(`Hata: ${e.message}`);
      }
      return;
    }
    // Otherwise open the editor
    setEditingReport(report);
  };

  return (
    <div className="admin-tab-content">
      <header className="admin-tab-header">
        <div>
          <h2>🚨 Kullanıcı Raporları</h2>
          <p className="admin-tab-subtitle">Eksik veya yanlış olduğunu düşündüğün önerileri burada görüp düzelterek veriye ekleyebilirsin.</p>
        </div>
        <button type="button" className="admin-secondary-button" onClick={fetchReports} disabled={loading}>
          {loading ? "Yükleniyor..." : "🔄 Yenile"}
        </button>
      </header>

      <div className="admin-reports-toolbar">
        <div className="admin-reports-toolbar-info">
          <span className="admin-reports-count">{filtered.length}</span>
          <span>{filtered.length === reports.length ? "rapor" : `/ ${reports.length} rapor (filtrelenmiş)`}</span>
        </div>
        <input
          type="text"
          className="admin-search"
          placeholder="🔍 İsim, takım veya not ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 240 }}
        />
      </div>

      {error && <div className="admin-error">{error}</div>}

      {loading ? (
        <div className="admin-reports-loading">Raporlar yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="admin-reports-empty">
          <div className="admin-reports-empty-icon">🎉</div>
          <h3>{reports.length === 0 ? "Henüz rapor yok" : "Filtreyle eşleşen rapor yok"}</h3>
          <p>{reports.length === 0 ? "Kullanıcılar oyunda eksik gördükleri yanıtları buraya bildirir." : "Arama terimini değiştir veya temizle."}</p>
        </div>
      ) : (
        <div className="admin-reports-list">
          {filtered.map((report) => {
            const existing = playerIndex.get(normalizeText(report.answer || ""));
            const teams = [report.team_a, report.team_b].filter(Boolean);
            const alreadyHasBoth = existing && teams.every((t) => existing.clubs.includes(t));
            const isExisting = !!existing;

            return (
              <div
                key={report.id}
                className={`admin-report-card ${alreadyHasBoth ? "has-existing" : isExisting ? "has-existing" : "has-new"}`}
              >
                <div className="admin-report-header">
                  <div className="admin-report-teams">
                    <span>{report.team_a || "?"}</span>
                    <span className="admin-report-vs">vs</span>
                    <span>{report.team_b || "?"}</span>
                  </div>
                  {alreadyHasBoth ? (
                    <span className="admin-report-status admin-report-status-existing">✓ Zaten veride</span>
                  ) : isExisting ? (
                    <span className="admin-report-status admin-report-status-existing">↗ Mevcut oyuncu</span>
                  ) : (
                    <span className="admin-report-status admin-report-status-new">🆕 Yeni öneri</span>
                  )}
                </div>

                <div className="admin-report-body">
                  <span className="admin-report-answer-label">Önerilen Yanıt</span>
                  <div className="admin-report-answer">
                    {report.answer || <em style={{ color: "var(--admin-text-muted)" }}>(boş)</em>}
                    {report.mode && <span className="admin-report-mode">{report.mode}</span>}
                  </div>
                  {report.feedback && <div className="admin-report-feedback">"{report.feedback}"</div>}
                </div>

                <div className="admin-report-meta">
                  {report.player_name && (
                    <span className="admin-report-meta-item">👤 {report.player_name}</span>
                  )}
                  {report.room_code && (
                    <span className="admin-report-meta-item">🎮 {report.room_code}</span>
                  )}
                  <span className="admin-report-meta-item">
                    🕐 {report.created_at ? formatRelativeTime(new Date(report.created_at).getTime()) : "—"}
                  </span>
                </div>

                <div className="admin-report-actions">
                  <button
                    type="button"
                    className="admin-primary-button"
                    onClick={() => handleQuickAccept(report)}
                  >
                    {alreadyHasBoth ? "🗑️ Raporu Sil (Zaten Var)" : "✏️ Düzenle ve Onayla"}
                  </button>
                  <button
                    type="button"
                    className="admin-danger-button"
                    onClick={() => handleReject(report)}
                  >
                    ✗ Reddet
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ReportEditor
        open={!!editingReport}
        onClose={() => setEditingReport(null)}
        report={editingReport}
        onApprove={handleApprove}
        snapshotPlayers={snapshot.players}
      />
      {dialog}
    </div>
  );
}

// =================== EXPORT TAB ===================
export function ExportTab({ snapshot, resetToOriginal, logActivity }) {
  const stats = useMemo(() => computeStats(snapshot), [snapshot]);
  const diff = useMemo(() => computeDiff(snapshot), [snapshot]);
  const { confirm, dialog } = useConfirm();
  const [dl, setDl] = useState(false);

  const handleDownload = async () => {
    setDl(true);
    try {
      downloadTextFile("teams.js", generateTeamsJS(snapshot));
      await new Promise((r) => setTimeout(r, 250));
      downloadTextFile("players.js", generatePlayersJS(snapshot));
      await new Promise((r) => setTimeout(r, 250));
      downloadTextFile("answerIndex.js", generateAnswerIndexJS(snapshot));
      await new Promise((r) => setTimeout(r, 250));
      downloadTextFile("teamLogos.js", generateTeamLogosJS(snapshot));
      logActivity({ type: "export", message: `Dosyalar indirildi: ${stats.eligiblePlayers} oyuncu, ${stats.activeTeams} takım` });
      localStorage.setItem("pairfc_admin_last_export", String(Date.now()));
    } finally { setDl(false); }
  };

  const handleReset = async () => {
    const ok = await confirm({ title: "Sıfırla?", message: "TÜM düzenlemeler silinecek, orijinal hale dönecek. Geri alınamaz.", confirmText: "Sıfırla", danger: true });
    if (!ok) return;
    resetToOriginal();
    logActivity({ type: "edit", message: "Tüm değişiklikler sıfırlandı" });
  };

  const lastExport = useMemo(() => {
    const s = localStorage.getItem("pairfc_admin_last_export");
    return s ? formatRelativeTime(parseInt(s, 10)) : null;
  }, [snapshot.lastModified]);

  return (
    <div className="admin-tab-content">
      <header className="admin-tab-header"><div><h2>📊 İstatistikler ve Dışa Aktar</h2><p className="admin-tab-subtitle">Veri özeti ve oyuna gönderme.</p></div></header>
      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-num">{stats.eligiblePlayers.toLocaleString("tr-TR")}</div>
          <div className="admin-stat-label">Oyuncu (2+ takımlı)</div>
          {stats.excludedPlayers > 0 && <small className="admin-stat-extra">+{stats.excludedPlayers} tek-takımlı (dışlanır)</small>}
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-num">{stats.activeTeams}</div>
          <div className="admin-stat-label">Aktif Takım</div>
          {stats.totalTeams !== stats.activeTeams && <small className="admin-stat-extra">Toplam {stats.totalTeams} takım</small>}
        </div>
        <div className="admin-stat-card"><div className="admin-stat-num">{stats.pairsWithAnswers.toLocaleString("tr-TR")}</div><div className="admin-stat-label">Oynanabilir Pair</div></div>
        <div className="admin-stat-card"><div className="admin-stat-num">{stats.emptyPairs.toLocaleString("tr-TR")}</div><div className="admin-stat-label">Boş Pair</div></div>
      </div>
      {diff.hasChanges && (
        <div className="admin-changes-summary">
          <h3>📝 Kaydedilmemiş Değişiklikler</h3>
          <div className="admin-changes-grid">
            {diff.addedPlayers.length > 0 && <div className="admin-change-row admin-change-add"><span>➕</span> <strong>{diff.addedPlayers.length}</strong> yeni oyuncu</div>}
            {diff.removedPlayers.length > 0 && <div className="admin-change-row admin-change-remove"><span>🗑️</span> <strong>{diff.removedPlayers.length}</strong> silinmiş oyuncu</div>}
            {diff.modifiedPlayers.length > 0 && <div className="admin-change-row admin-change-edit"><span>✏️</span> <strong>{diff.modifiedPlayers.length}</strong> değiştirilmiş oyuncu</div>}
            {diff.addedTeams.length > 0 && <div className="admin-change-row admin-change-add"><span>➕</span> <strong>{diff.addedTeams.length}</strong> yeni takım</div>}
            {diff.removedTeams.length > 0 && <div className="admin-change-row admin-change-remove"><span>🗑️</span> <strong>{diff.removedTeams.length}</strong> silinmiş takım</div>}
            {diff.modifiedTeams.length > 0 && <div className="admin-change-row admin-change-edit"><span>✏️</span> <strong>{diff.modifiedTeams.length}</strong> değiştirilmiş takım</div>}
          </div>
        </div>
      )}
      <div className="admin-export-card">
        <div>
          <h3>🚀 Canlıya Gönder</h3>
          <p><strong>Adım adım:</strong></p>
          <ol style={{ margin: "8px 0", paddingLeft: 20, color: "var(--admin-text-muted)", fontSize: 13, lineHeight: 1.7 }}>
            <li>Aşağıdaki butona bas → 4 dosya iner: <code>teams.js</code>, <code>players.js</code>, <code>answerIndex.js</code>, <code>teamLogos.js</code></li>
            <li>Bu 4 dosyayı projede <code>src/data/</code> klasörüne kopyala (üzerine yaz)</li>
            <li>Terminale yaz: <code>git add -A && git commit -m "data update" && git push</code></li>
            <li>Vercel 1-2 dakikada canlıya alır ✨</li>
          </ol>
          {lastExport && <small style={{ color: "var(--admin-text-muted)" }}>Son indirme: {lastExport}</small>}
        </div>
        <button type="button" className="admin-big-button" onClick={handleDownload} disabled={dl}>{dl ? "İndiriliyor..." : "📥 Dosyaları İndir"}</button>
      </div>
      <div className="admin-reset-card">
        <div><h3>♻️ Sıfırla</h3><p>Tüm yerel düzenlemeleri sil, orijinal hale dön.</p></div>
        <button type="button" className="admin-danger-button-solid" onClick={handleReset}>🗑️ Tüm Değişiklikleri Sıfırla</button>
      </div>
      {dialog}
    </div>
  );
}
