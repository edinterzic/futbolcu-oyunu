// PairFC — Service Worker kaydı + Web Push yardımcıları

const VAPID_PUBLIC_KEY =
  "BM82SzTnYxTRNQWs7xwkApgcai0ImWhr2b010c6wvaREQe0Yhg8u06XlJymN_M56mXEh4uUcWX4J6O8cytvfzEc";

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// Push bu tarayıcıda destekleniyor mu?
export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// "default" | "granted" | "denied" | "unsupported"
export function getNotificationPermission() {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

// Mevcut subscription (varsa) — JSON formatında
export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const j = sub.toJSON();
    return { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth };
  } catch (e) {
    return null;
  }
}

// İzin iste + push'a abone ol.
// Dönüş: { ok: true, subscription: {endpoint,p256dh,auth} } veya { ok:false, reason }
export async function subscribeToPush() {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch (e) {
      return { ok: false, reason: "error" };
    }
  }
  if (permission !== "granted") return { ok: false, reason: permission };

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const j = sub.toJSON();
    return {
      ok: true,
      subscription: { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth },
    };
  } catch (e) {
    console.warn("Push subscribe failed:", e);
    return { ok: false, reason: "error" };
  }
}

// Aboneliği iptal et
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return { ok: false };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      return { ok: true, endpoint };
    }
    return { ok: true, endpoint: null };
  } catch (e) {
    return { ok: false };
  }
}
