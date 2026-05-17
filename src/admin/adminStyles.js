// Tüm admin paneli stilleri tek string olarak.
// AdminPanel.jsx ve AdminTabs.jsx içinden import edilir.
// Buraya CSS özellikleri eklersen, değişiklik tüm admin paneline yansır.

export const ADMIN_STYLES = `
:root {
  --admin-bg: #0f172a;
  --admin-surface: #1e293b;
  --admin-surface-2: #334155;
  --admin-border: #334155;
  --admin-border-light: #475569;
  --admin-text: #f1f5f9;
  --admin-text-muted: #94a3b8;
  --admin-primary: #10b981;
  --admin-primary-soft: rgba(16, 185, 129, 0.15);
  --admin-primary-hover: #34d399;
  --admin-danger: #ef4444;
  --admin-danger-soft: rgba(239, 68, 68, 0.15);
  --admin-warning: #f59e0b;
  --admin-info: #38bdf8;
  --admin-success: #22c55e;
}

* { box-sizing: border-box; }

.admin-root {
  position: fixed;
  inset: 0;
  background: var(--admin-bg);
  color: var(--admin-text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
  font-size: 14px;
}

/* ===== LOGIN ===== */
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
.admin-login-header { text-align: center; margin-bottom: 28px; }
.admin-login-mark { font-size: 36px; margin-bottom: 12px; }
.admin-login-header h1 { font-size: 24px; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.02em; }
.admin-login-header p { font-size: 14px; color: var(--admin-text-muted); margin: 0; }
.admin-login-form { display: flex; flex-direction: column; gap: 12px; }
.admin-login-form input {
  width: 100%; padding: 14px 16px; font-size: 15px;
  background: rgba(15, 23, 42, 0.6); border: 1px solid var(--admin-border);
  border-radius: 12px; color: var(--admin-text); outline: none; transition: all 0.2s;
}
.admin-login-form input:focus {
  border-color: var(--admin-primary); background: rgba(15, 23, 42, 0.9);
  box-shadow: 0 0 0 3px var(--admin-primary-soft);
}
.admin-login-footer { margin-top: 20px; text-align: center; }
.admin-login-footer a { color: var(--admin-text-muted); font-size: 13px; text-decoration: none; }
.admin-login-footer a:hover { color: var(--admin-primary); }

/* ===== BUTTONS ===== */
.admin-primary-button {
  padding: 11px 18px; background: var(--admin-primary); color: white;
  border: none; border-radius: 10px; font-size: 14px; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
  display: inline-flex; align-items: center; gap: 6px;
}
.admin-primary-button:hover:not(:disabled) { background: var(--admin-primary-hover); transform: translateY(-1px); }
.admin-primary-button:disabled { opacity: 0.5; cursor: not-allowed; }

.admin-secondary-button {
  padding: 9px 14px; background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--admin-border); border-radius: 10px;
  color: var(--admin-text); font-size: 13px; font-weight: 600;
  cursor: pointer; text-decoration: none;
  display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s;
}
.admin-secondary-button:hover { background: rgba(255, 255, 255, 0.12); border-color: var(--admin-primary); }

.admin-danger-button {
  padding: 9px 14px; background: var(--admin-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px;
  color: #fca5a5; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.admin-danger-button:hover { background: rgba(239, 68, 68, 0.25); border-color: var(--admin-danger); color: #fee2e2; }

.admin-danger-button-solid {
  padding: 11px 18px; background: var(--admin-danger); color: white;
  border: none; border-radius: 10px; font-size: 14px; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
}
.admin-danger-button-solid:hover { background: #dc2626; transform: translateY(-1px); }

.admin-icon-button {
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.06); border: 1px solid var(--admin-border);
  border-radius: 10px; color: var(--admin-text); font-size: 16px;
  cursor: pointer; transition: all 0.15s;
}
.admin-icon-button:hover { background: rgba(255, 255, 255, 0.12); border-color: var(--admin-primary); }

.admin-icon-button-small {
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.05); border: 1px solid var(--admin-border);
  border-radius: 8px; cursor: pointer; transition: all 0.15s;
  font-size: 13px;
}
.admin-icon-button-small:hover { background: rgba(255, 255, 255, 0.12); }
.admin-icon-button-small.admin-icon-danger:hover { background: var(--admin-danger-soft); border-color: var(--admin-danger); }

.admin-big-button {
  padding: 18px 28px; background: var(--admin-primary); color: white;
  border: none; border-radius: 14px; font-size: 16px; font-weight: 800;
  cursor: pointer; transition: all 0.15s;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
}
.admin-big-button:hover:not(:disabled) {
  background: var(--admin-primary-hover); transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.4);
}
.admin-big-button:disabled { opacity: 0.5; cursor: not-allowed; }

/* ===== SHELL ===== */
.admin-shell { height: 100dvh; display: flex; flex-direction: column; }
.admin-topbar {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 20px; background: rgba(15, 23, 42, 0.9);
  backdrop-filter: blur(20px); border-bottom: 1px solid var(--admin-border);
  flex-shrink: 0;
}
.admin-brand { display: flex; align-items: center; gap: 12px; }
.admin-brand-mark { font-size: 22px; }
.admin-brand strong { display: block; font-size: 15px; font-weight: 800; letter-spacing: -0.02em; }
.admin-brand small { display: block; font-size: 11px; color: var(--admin-text-muted); margin-top: 1px; }

.admin-unsaved-badge {
  padding: 6px 12px; background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 999px;
  color: #fcd34d; font-size: 12px; font-weight: 600;
}

/* ===== SAVE STATUS (topbar) ===== */
.admin-saved-indicator {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: 999px;
  color: #86efac; font-size: 12px; font-weight: 600;
}
.admin-publish-cta {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 16px 8px 12px;
  background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%);
  color: white; border: none; border-radius: 999px;
  cursor: pointer; transition: all 0.2s;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);
  animation: publishPulse 2.5s ease-in-out infinite;
}
.admin-publish-cta:hover {
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.55);
}
.admin-publish-icon { font-size: 16px; }
.admin-publish-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.1; }
.admin-publish-text strong { font-size: 13px; font-weight: 800; }
.admin-publish-text small { font-size: 10px; opacity: 0.9; font-weight: 600; }
@keyframes publishPulse {
  0%, 100% { box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4); }
  50% { box-shadow: 0 6px 22px rgba(245, 158, 11, 0.65); }
}
@media (max-width: 700px) {
  .admin-publish-text small { display: none; }
}

.admin-topbar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

/* ===== BODY ===== */
.admin-body { flex: 1; display: flex; min-height: 0; position: relative; }
.admin-sidebar {
  width: 220px; background: rgba(30, 41, 59, 0.5);
  border-right: 1px solid var(--admin-border);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.admin-nav { flex: 1; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
.admin-nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 14px; background: transparent; border: 1px solid transparent;
  border-radius: 10px; color: var(--admin-text-muted);
  font-size: 14px; font-weight: 600; text-align: left;
  cursor: pointer; transition: all 0.15s;
}
.admin-nav-item:hover { background: rgba(255, 255, 255, 0.04); color: var(--admin-text); }
.admin-nav-item.active {
  background: var(--admin-primary-soft); border-color: rgba(16, 185, 129, 0.3);
  color: var(--admin-primary-hover);
}
.admin-nav-icon { font-size: 16px; width: 22px; display: inline-flex; justify-content: center; }
.admin-sidebar-footer { padding: 12px; border-top: 1px solid var(--admin-border); }
.admin-version-badge { padding: 8px 12px; background: rgba(15, 23, 42, 0.6); border-radius: 8px; text-align: center; }
.admin-version-badge small { color: var(--admin-text-muted); font-size: 11px; font-weight: 600; }

.admin-main { flex: 1; overflow-y: auto; padding: 24px; }

/* ===== TAB CONTENT ===== */
.admin-tab-content { display: flex; flex-direction: column; gap: 20px; }
.admin-tab-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.admin-tab-header h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.admin-tab-subtitle { margin: 4px 0 0; color: var(--admin-text-muted); font-size: 13px; }

.admin-tab-placeholder {
  min-height: 400px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 40px;
  background: rgba(30, 41, 59, 0.4); border: 1px dashed var(--admin-border);
  border-radius: 16px;
}
.admin-tab-icon { font-size: 56px; margin-bottom: 16px; opacity: 0.6; }
.admin-tab-placeholder h2 { font-size: 24px; font-weight: 800; margin: 0 0 8px; }
.admin-tab-placeholder p { font-size: 14px; color: var(--admin-text-muted); margin: 0 0 20px; max-width: 400px; }
.admin-coming-soon {
  display: inline-block; padding: 6px 14px;
  background: var(--admin-warning); color: #422006;
  font-size: 12px; font-weight: 700; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.04em;
}

/* ===== TOOLBAR ===== */
.admin-toolbar { display: flex; gap: 12px; flex-wrap: wrap; }
.admin-search, .admin-select {
  padding: 10px 14px; background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--admin-border); border-radius: 10px;
  color: var(--admin-text); font-size: 14px; outline: none;
  transition: all 0.15s;
}
.admin-search { flex: 1; min-width: 240px; }
.admin-search:focus, .admin-select:focus { border-color: var(--admin-primary); box-shadow: 0 0 0 3px var(--admin-primary-soft); }
.admin-select { cursor: pointer; min-width: 200px; }

.admin-bulk-actions {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; background: var(--admin-primary-soft);
  border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 10px;
}
.admin-bulk-actions span { color: var(--admin-primary-hover); font-weight: 600; flex: 1; }

/* ===== TABLE ===== */
.admin-table-wrap {
  background: rgba(30, 41, 59, 0.4); border: 1px solid var(--admin-border);
  border-radius: 12px; overflow: hidden; overflow-x: auto;
}
.admin-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.admin-table thead { background: rgba(15, 23, 42, 0.6); }
.admin-table th {
  padding: 12px 16px; text-align: left;
  font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--admin-text-muted);
  border-bottom: 1px solid var(--admin-border);
}
.admin-table td { padding: 12px 16px; border-bottom: 1px solid rgba(51, 65, 85, 0.5); vertical-align: top; }
.admin-table tbody tr:hover { background: rgba(255, 255, 255, 0.02); }
.admin-table tbody tr.selected { background: var(--admin-primary-soft); }
.admin-table tbody tr:last-child td { border-bottom: none; }
.admin-table input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: var(--admin-primary); }

.admin-player-name { font-weight: 600; color: var(--admin-text); }
.admin-warn-badge {
  display: inline-block; margin-top: 4px;
  padding: 2px 8px; background: rgba(245, 158, 11, 0.15);
  color: #fcd34d; font-size: 11px; border-radius: 6px;
}
.admin-club-badges { display: flex; flex-direction: column; gap: 4px; }
.admin-club-row { display: inline-flex; align-items: center; gap: 8px; }
.admin-club-name { color: var(--admin-text-muted); font-size: 13px; }
.admin-row-actions { display: flex; gap: 6px; }

/* ===== PAGINATION ===== */
.admin-pagination { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 8px; }
.admin-pagination button {
  padding: 8px 14px; background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--admin-border); border-radius: 8px;
  color: var(--admin-text); font-size: 13px; font-weight: 600;
  cursor: pointer;
}
.admin-pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
.admin-pagination span { color: var(--admin-text-muted); font-size: 13px; }

/* ===== TEAM BADGE ===== */
.admin-team-badge {
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; font-weight: 800; letter-spacing: -0.02em;
  border: 1.5px solid; flex-shrink: 0;
}

/* ===== TEAM CARDS ===== */
.admin-team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.admin-team-card {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; background: rgba(30, 41, 59, 0.4);
  border: 1px solid var(--admin-border); border-radius: 12px;
  transition: all 0.15s;
}
.admin-team-card:hover { border-color: var(--admin-primary); background: rgba(30, 41, 59, 0.6); }
.admin-team-card-header { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.admin-team-card-info { min-width: 0; flex: 1; }
.admin-team-card-name { font-size: 15px; font-weight: 700; color: var(--admin-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-team-card-meta { font-size: 12px; color: var(--admin-text-muted); margin-top: 2px; }
.admin-team-card-count { color: var(--admin-primary-hover); font-weight: 600; margin-left: 4px; }
.admin-team-card-actions { display: flex; gap: 6px; }
.admin-empty-state { grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--admin-text-muted); }

/* ===== MODAL ===== */
.admin-modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px; animation: fadeIn 0.15s ease-out;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.admin-modal {
  width: 100%; background: var(--admin-surface);
  border: 1px solid var(--admin-border-light); border-radius: 16px;
  max-height: 90dvh; display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.2s ease-out;
}
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.admin-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--admin-border); flex-shrink: 0;
}
.admin-modal-header h3 { margin: 0; font-size: 17px; font-weight: 700; }
.admin-modal-body { padding: 20px; overflow-y: auto; flex: 1; }
.admin-modal-actions {
  display: flex; gap: 10px; justify-content: flex-end; align-items: center;
  margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--admin-border);
}

/* ===== FORM ===== */
.admin-form-row { margin-bottom: 16px; }
.admin-form-row label {
  display: block; margin-bottom: 6px;
  font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--admin-text-muted);
}
.admin-form-row input[type="text"],
.admin-form-row input[type="number"],
.admin-form-row textarea {
  width: 100%; padding: 11px 14px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--admin-border); border-radius: 10px;
  color: var(--admin-text); font-size: 14px; outline: none;
  transition: all 0.15s; font-family: inherit;
}
.admin-form-row input:focus, .admin-form-row textarea:focus {
  border-color: var(--admin-primary);
  background: rgba(15, 23, 42, 0.9);
  box-shadow: 0 0 0 3px var(--admin-primary-soft);
}
.admin-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.admin-form-details { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--admin-border); }
.admin-form-details summary {
  cursor: pointer; color: var(--admin-text-muted);
  font-size: 13px; font-weight: 600; padding: 6px 0; user-select: none;
}
.admin-form-details summary:hover { color: var(--admin-text); }
.admin-form-details[open] summary { margin-bottom: 12px; }

.admin-color-input { display: flex; gap: 8px; }
.admin-color-input input[type="color"] {
  width: 50px; height: 42px; padding: 0;
  border: 1px solid var(--admin-border); border-radius: 10px;
  background: transparent; cursor: pointer;
}
.admin-color-input input[type="text"] { flex: 1; }

.admin-radio-group { display: flex; gap: 8px; flex-wrap: wrap; }
.admin-radio-pill {
  padding: 8px 14px; background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--admin-border); border-radius: 999px;
  color: var(--admin-text-muted); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.admin-radio-pill:hover { background: rgba(255, 255, 255, 0.08); color: var(--admin-text); }
.admin-radio-pill.active {
  background: var(--admin-primary-soft); border-color: var(--admin-primary);
  color: var(--admin-primary-hover);
}

/* ===== CHIPS / AUTOCOMPLETE ===== */
.admin-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; min-height: 28px; }
.admin-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; background: var(--admin-primary-soft);
  border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 999px;
  font-size: 13px; color: var(--admin-primary-hover); font-weight: 600;
}
.admin-chip button {
  background: none; border: none; color: var(--admin-primary-hover);
  cursor: pointer; padding: 0; font-size: 14px; opacity: 0.6;
}
.admin-chip button:hover { opacity: 1; }

.admin-autocomplete { position: relative; }
.admin-suggestions {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
  margin-top: 4px; max-height: 240px; overflow-y: auto;
  background: var(--admin-surface); border: 1px solid var(--admin-border-light);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.admin-suggestion {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 14px; background: none; border: none;
  color: var(--admin-text); text-align: left; font-size: 13px;
  cursor: pointer; transition: background 0.1s;
}
.admin-suggestion:hover { background: rgba(255, 255, 255, 0.06); }

.admin-team-preview-row {
  display: flex; align-items: center; gap: 14px;
  padding: 14px; background: rgba(15, 23, 42, 0.5);
  border: 1px solid var(--admin-border); border-radius: 12px;
  margin-bottom: 18px;
}
.admin-team-preview-name { font-size: 16px; font-weight: 700; }
.admin-team-preview-meta { font-size: 12px; color: var(--admin-text-muted); margin-top: 2px; }

.admin-error {
  padding: 10px 14px; margin-top: 10px;
  background: var(--admin-danger-soft); border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px; color: #fca5a5; font-size: 13px;
}

/* ===== IMPORT TAB ===== */
.admin-import-help {
  padding: 16px 18px; background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 12px;
  font-size: 13px;
}
.admin-import-help strong { display: block; margin-bottom: 8px; color: var(--admin-info); }
.admin-import-help pre {
  background: rgba(15, 23, 42, 0.6); padding: 10px 12px; border-radius: 8px;
  font-size: 12px; overflow-x: auto; margin: 0 0 8px;
  color: var(--admin-text); font-family: 'Courier New', monospace;
  border: 1px solid var(--admin-border);
}
.admin-import-help small { color: var(--admin-text-muted); line-height: 1.6; }
.admin-import-textarea {
  width: 100%; min-height: 200px;
  padding: 14px 16px; background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--admin-border); border-radius: 12px;
  color: var(--admin-text); font-size: 13px; font-family: 'Courier New', monospace;
  outline: none; resize: vertical;
}
.admin-import-textarea:focus { border-color: var(--admin-primary); }
.admin-import-preview { display: flex; flex-direction: column; gap: 16px; }
.admin-import-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.admin-summary-card {
  padding: 14px; background: rgba(30, 41, 59, 0.5);
  border: 1px solid var(--admin-border); border-radius: 10px; text-align: center;
}
.admin-summary-num { font-size: 28px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
.admin-summary-label { font-size: 12px; color: var(--admin-text-muted); }
.admin-summary-add { border-color: rgba(34, 197, 94, 0.3); background: rgba(34, 197, 94, 0.08); }
.admin-summary-add .admin-summary-num { color: var(--admin-success); }
.admin-summary-update { border-color: rgba(56, 189, 248, 0.3); background: rgba(56, 189, 248, 0.08); }
.admin-summary-update .admin-summary-num { color: var(--admin-info); }
.admin-summary-team { border-color: rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.08); }
.admin-summary-team .admin-summary-num { color: var(--admin-warning); }
.admin-summary-skip { border-color: var(--admin-border); }
.admin-summary-skip .admin-summary-num { color: var(--admin-text-muted); }
.admin-summary-error { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.08); }
.admin-summary-error .admin-summary-num { color: var(--admin-danger); }
.admin-import-section {
  padding: 14px 16px; background: rgba(30, 41, 59, 0.4);
  border: 1px solid var(--admin-border); border-radius: 12px;
}
.admin-import-section h4 { margin: 0 0 10px; font-size: 14px; font-weight: 700; }
.admin-import-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.admin-import-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.admin-import-row { display: flex; gap: 12px; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.admin-import-row strong { min-width: 160px; }
.admin-import-row span { color: var(--admin-text-muted); }
.admin-import-row-add { background: rgba(34, 197, 94, 0.05); }
.admin-import-row-update { background: rgba(56, 189, 248, 0.05); }
.admin-import-row-error { background: rgba(239, 68, 68, 0.08); color: #fca5a5; }

/* ===== EXPORT TAB ===== */
.admin-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.admin-stat-card {
  padding: 18px; background: rgba(30, 41, 59, 0.5);
  border: 1px solid var(--admin-border); border-radius: 12px;
}
.admin-stat-num { font-size: 32px; font-weight: 800; color: var(--admin-primary-hover); line-height: 1; }
.admin-stat-label { font-size: 13px; color: var(--admin-text-muted); margin-top: 6px; }
.admin-stat-extra { display: block; color: var(--admin-text-muted); font-size: 11px; margin-top: 4px; }
.admin-changes-summary {
  padding: 18px; background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px;
}
.admin-changes-summary h3 { margin: 0 0 12px; font-size: 15px; color: #fcd34d; }
.admin-changes-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.admin-change-row {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: rgba(15, 23, 42, 0.4);
  border-radius: 999px; font-size: 13px;
}
.admin-change-row strong { color: var(--admin-text); }
.admin-change-add { color: var(--admin-success); }
.admin-change-remove { color: var(--admin-danger); }
.admin-change-edit { color: var(--admin-info); }
.admin-export-card, .admin-reset-card {
  display: flex; align-items: center; justify-content: space-between;
  gap: 20px; padding: 24px;
  background: rgba(30, 41, 59, 0.5); border: 1px solid var(--admin-border);
  border-radius: 16px; flex-wrap: wrap;
}
.admin-export-card { border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.05); }
.admin-export-card h3, .admin-reset-card h3 { margin: 0 0 6px; font-size: 17px; }
.admin-export-card p, .admin-reset-card p { margin: 0 0 8px; font-size: 13px; color: var(--admin-text-muted); max-width: 480px; }
.admin-export-card code, .admin-reset-card code {
  background: rgba(15, 23, 42, 0.6); padding: 2px 6px;
  border-radius: 4px; font-size: 12px;
}
.admin-reset-card { border-color: rgba(239, 68, 68, 0.2); }

/* ===== ACTIVITY LOG ===== */
.admin-log-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 320px; background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(20px);
  border-left: 1px solid var(--admin-border);
  display: flex; flex-direction: column; z-index: 10;
  animation: slideInLog 0.2s ease-out;
}
@keyframes slideInLog { from { transform: translateX(100%); } to { transform: translateX(0); } }
.admin-log-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; border-bottom: 1px solid var(--admin-border);
}
.admin-log-header h3 { margin: 0; font-size: 14px; font-weight: 700; }
.admin-log-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.admin-log-item {
  display: flex; gap: 10px; padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03); border-radius: 8px;
}
.admin-log-icon { font-size: 14px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.admin-log-body { flex: 1; min-width: 0; }
.admin-log-message { font-size: 12px; color: var(--admin-text); line-height: 1.3; word-break: break-word; }
.admin-log-time { font-size: 11px; color: var(--admin-text-muted); margin-top: 2px; }
.admin-log-more { padding: 10px; font-size: 12px; color: var(--admin-text-muted); text-align: center; }
.admin-log-clear {
  margin: 8px; padding: 8px;
  background: transparent; border: 1px solid var(--admin-border);
  border-radius: 8px; color: var(--admin-text-muted);
  font-size: 12px; cursor: pointer;
}
.admin-log-clear:hover { border-color: var(--admin-danger); color: var(--admin-danger); }
.admin-log-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 40px 20px; color: var(--admin-text-muted); font-size: 13px; text-align: center;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 900px) {
  .admin-sidebar { width: 64px; }
  .admin-nav-label { display: none; }
  .admin-nav-item { justify-content: center; padding: 11px; }
  .admin-brand small { display: none; }
  .admin-secondary-button { display: none; }
  .admin-main { padding: 16px; }
  .admin-log-panel { width: 280px; }
  .admin-version-badge { display: none; }
  .admin-unsaved-badge { font-size: 11px; padding: 4px 8px; }
  .admin-form-grid { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .admin-table { font-size: 13px; }
  .admin-table th, .admin-table td { padding: 8px 10px; }
  .admin-team-grid { grid-template-columns: 1fr; }
  .admin-log-panel { width: 100%; }
  .admin-export-card, .admin-reset-card { flex-direction: column; align-items: flex-start; }
}

/* Scrollbars */
.admin-main::-webkit-scrollbar,
.admin-nav::-webkit-scrollbar,
.admin-log-list::-webkit-scrollbar,
.admin-import-list::-webkit-scrollbar,
.admin-suggestions::-webkit-scrollbar { width: 8px; }
.admin-main::-webkit-scrollbar-track,
.admin-nav::-webkit-scrollbar-track,
.admin-log-list::-webkit-scrollbar-track,
.admin-import-list::-webkit-scrollbar-track,
.admin-suggestions::-webkit-scrollbar-track { background: transparent; }
.admin-main::-webkit-scrollbar-thumb,
.admin-nav::-webkit-scrollbar-thumb,
.admin-log-list::-webkit-scrollbar-thumb,
.admin-import-list::-webkit-scrollbar-thumb,
.admin-suggestions::-webkit-scrollbar-thumb { background: var(--admin-border); border-radius: 4px; }
.admin-main::-webkit-scrollbar-thumb:hover { background: var(--admin-text-muted); }
`;
