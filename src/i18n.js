// PairFC i18n — hafif özel sistem (kütüphane yok)
// Kullanım: import { t, useLang, setLang } from "./i18n";
// App component'in tepesinde bir kez useLang() çağır; dil değişince tüm alt ağaç yeniden render olur.

import { useState, useEffect } from "react";
import { tr } from "./locales/tr";
import { en } from "./locales/en";

const LOCALES = { tr, en };
const DEFAULT_LANG = "tr";
const STORAGE_KEY = "pairfc_lang";

function detectInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "tr" || saved === "en") return saved;
    // Tarayıcı dilini al
    const nav = (typeof navigator !== "undefined" && (navigator.language || navigator.userLanguage) || "").toLowerCase();
    if (nav.startsWith("tr")) return "tr";
    if (nav.startsWith("en")) return "en";
  } catch (e) {}
  return DEFAULT_LANG;
}

let currentLang = detectInitialLang();
const listeners = new Set();

export function getLang() { return currentLang; }

export function setLang(lang) {
  if (lang !== "tr" && lang !== "en") return;
  if (lang === currentLang) return;
  currentLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  try { if (typeof document !== "undefined") document.documentElement.lang = lang; } catch (e) {}
  listeners.forEach(fn => { try { fn(lang); } catch (e) {} });
}

export function t(key, vars) {
  const dict = LOCALES[currentLang] || LOCALES.tr;
  let s = dict[key];
  if (s === undefined) s = LOCALES.tr[key];  // çeviri yoksa Türkçeye düş
  if (s === undefined) s = key;              // o da yoksa key'i göster (uyarı)
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
