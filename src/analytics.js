// =============================================
// PairFC — Merkezi Analytics Modülü
// =============================================
// Tüm PostHog event'leri buradan geçer. İleride farklı bir analytics
// provider'a geçilirse (Amplitude, Mixpanel) sadece bu dosya değişir.
//
// API:
//   initAnalytics(clientId, props?)      — Sayfa açılışında bir kez çağır.
//   track(name, props?)                  — Event gönder.
//   startTimer(label) / endTimer(label)  — Süre ölçümü.
//   identify(clientId, props?)           — Kullanıcı kimlik bilgilerini güncelle.
//   setUserProperties(props)             — Kalıcı kullanıcı özellikleri.
//   setGlobalProperty(key, value)        — Tüm event'lere otomatik eklenecek özellik.
//
// PostHog SDK index.html'de yüklenmiş varsayılır (window.posthog).
// SDK yoksa fonksiyonlar sessizce no-op; dev modunda console'a düşer.

const DEV = typeof window !== "undefined" && (
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname.endsWith(".local")
);

// Süre ölçümü için label → start time map'i
const timers = new Map();

// Standart property'ler: her track() çağrısına otomatik eklenir
const globalProps = {
  app_version: "1.0.0"
};

function getPostHog() {
  if (typeof window === "undefined") return null;
  return window.posthog || null;
}

/**
 * Uygulama açılışında çağrılır. PostHog'u init eder ve kullanıcıyı identify yapar.
 * @param {string} clientId - Kalıcı anonymous UUID (localStorage'tan)
 * @param {Object} [props] - { nickname, lang, has_supabase_user, ... }
 */
export function initAnalytics(clientId, props) {
  const ph = getPostHog();

  if (typeof document !== "undefined" && document.documentElement.lang) {
    globalProps.app_lang = document.documentElement.lang;
  }

  if (DEV) console.log(`[analytics] init`, { clientId, props });

  if (ph) {
    try {
      if (clientId && typeof ph.identify === "function") {
        ph.identify(clientId, props || {});
      }
      track("session_started", {
        first_session: isFirstSession(),
        viewport_width: typeof window !== "undefined" ? window.innerWidth : null,
        viewport_height: typeof window !== "undefined" ? window.innerHeight : null,
        is_pwa: isStandalonePWA(),
        ...(props || {})
      });
    } catch (e) {
      if (DEV) console.warn(`[analytics] init failed:`, e);
    }
  }
}

export function track(eventName, properties) {
  const ph = getPostHog();
  const props = { ...globalProps, ...(properties || {}) };

  if (DEV) console.log(`[analytics] ${eventName}`, props);

  if (ph && typeof ph.capture === "function") {
    try { ph.capture(eventName, props); }
    catch (e) { if (DEV) console.warn(`[analytics] capture failed:`, e); }
  }
}

export function identify(clientId, properties) {
  const ph = getPostHog();
  if (!clientId) return;
  if (DEV) console.log(`[analytics] identify`, clientId, properties);
  if (ph && typeof ph.identify === "function") {
    try { ph.identify(clientId, properties || {}); }
    catch (e) { if (DEV) console.warn(`[analytics] identify failed:`, e); }
  }
}

export function setUserProperties(properties) {
  const ph = getPostHog();
  if (!properties) return;
  if (DEV) console.log(`[analytics] setUserProperties`, properties);
  if (ph && ph.people && typeof ph.people.set === "function") {
    try { ph.people.set(properties); }
    catch (e) { if (DEV) console.warn(`[analytics] setUserProperties failed:`, e); }
  }
}

export function setGlobalProperty(key, value) {
  globalProps[key] = value;
}

export function startTimer(label) {
  timers.set(label, Date.now());
}

export function endTimer(label) {
  const start = timers.get(label);
  if (!start) return 0;
  timers.delete(label);
  return Math.round((Date.now() - start) / 1000);
}

export function resetAnalytics() {
  const ph = getPostHog();
  if (ph && typeof ph.reset === "function") {
    try { ph.reset(); } catch (e) {}
  }
}

// --- İç yardımcılar ---

function isFirstSession() {
  try {
    const KEY = "pairfc_session_marker";
    const seen = window.localStorage.getItem(KEY);
    if (!seen) {
      window.localStorage.setItem(KEY, "1");
      return true;
    }
    return false;
  } catch (e) { return false; }
}

function isStandalonePWA() {
  try {
    if (typeof window === "undefined") return false;
    if (window.navigator.standalone === true) return true;
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    return false;
  } catch (e) { return false; }
}
