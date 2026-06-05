// PairFC i18n — hafif özel sistem (kütüphane yok)
// Kullanım: import { t, useLang, setLang } from "./i18n";
// App component'in tepesinde bir kez useLang() çağır; dil değişince tüm alt ağaç yeniden render olur.

import { useState, useEffect } from "react";
import { tr } from "./locales/tr";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { pt } from "./locales/pt";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { it } from "./locales/it";

const LOCALES = { tr, en, es, pt, fr, de, it };

// Desteklenen diller — UI'da dil seçici ve detection bu listeyi kullanır.
// Yeni dil eklemek için: ./locales/X.js yarat, yukarıya import ekle, buraya bir satır ekle.
export const SUPPORTED_LANGS = [
  { code: "tr", label: "Türkçe", flag: "🇹🇷" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "it", label: "Italiano", flag: "🇮🇹" }
];

const SUPPORTED_CODES = new Set(SUPPORTED_LANGS.map((l) => l.code));
const DEFAULT_LANG = "tr";
const STORAGE_KEY = "pairfc_lang";

// Spanish gibi yeni dillerde key eksik olursa fallback zinciri: en → tr.
// İngilizce daha evrensel olduğu için ilk fallback English.
const FALLBACK_CHAIN = ["en", "tr"];

function detectInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_CODES.has(saved)) return saved;
    // Tarayıcı dilini al — startsWith ile region kodlarını da yakalar (es-ES, es-MX, en-US, vs.)
    const nav = (typeof navigator !== "undefined" && (navigator.language || navigator.userLanguage) || "").toLowerCase();
    for (const { code } of SUPPORTED_LANGS) {
      if (nav.startsWith(code)) return code;
    }
  } catch (e) {}
  return DEFAULT_LANG;
}

let currentLang = detectInitialLang();
const listeners = new Set();

export function getLang() { return currentLang; }

export function setLang(lang) {
  if (!SUPPORTED_CODES.has(lang)) return;
  if (lang === currentLang) return;
  currentLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  try { if (typeof document !== "undefined") document.documentElement.lang = lang; } catch (e) {}
  listeners.forEach(fn => { try { fn(lang); } catch (e) {} });
}

export function t(key, vars) {
  const dict = LOCALES[currentLang] || LOCALES[DEFAULT_LANG];
  let s = dict[key];
  // Mevcut dilde yoksa fallback zincirini dene (yeni dillerde olur)
  if (s === undefined) {
    for (const fbLang of FALLBACK_CHAIN) {
      if (LOCALES[fbLang] && LOCALES[fbLang][key] !== undefined) {
        s = LOCALES[fbLang][key];
        break;
      }
    }
  }
  if (s === undefined) s = key; // hiçbir dilde yoksa key'i göster (geliştirici uyarısı)
  if (vars && typeof s === "string") {
    Object.keys(vars).forEach(k => {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k]));
    });
  }
  return s;
}

// Hook: App component bunu çağırınca dil değişiminde re-render olur,
// alt ağaçtaki tüm t() çağrıları otomatik tazelenir.
export function useLang() {
  const [lang, setLangState] = useState(currentLang);
  useEffect(() => {
    const fn = (l) => setLangState(l);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return [lang, setLang];
}
