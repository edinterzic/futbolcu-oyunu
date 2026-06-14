// =============================================
// PairFC Auth Helper — Supabase Auth (Google OAuth) — Sürüm 1a
// =============================================
// İsteğe bağlı giriş: oyun girişsiz de oynanır. Giriş, kalıcı XP + sıralama
// içindir. Bu modül auth çağrılarını tek yerde toplar; App.jsx sadece çağırır.
// 1a kapsamı: giriş başlat / çıkış / oturum al / profil çek.
// (Kullanıcı adı seçme + hesap silme 1b'de eklenecek.)

import { logSwallowed } from "./utils/errors";

// Google ile giriş başlat. Supabase kullanıcıyı Google'a yönlendirir; giriş
// bitince redirectTo (mevcut origin = pairfc.com) adresine geri döner.
//
// iOS WKWebView SORUNU: Google, uygulama-içi webview'lerde OAuth'u reddeder
// (disallowed_useragent). PWABuilder iOS paketi WKWebView kullandığı için
// normal redirect "yükleniyor → hata → geri dön" yapıyor. Çözüm: iOS'ta girişi
// SİSTEM Safari'sinde aç (skipBrowserRedirect + window.open). Kullanıcı Safari'de
// giriş yapar, pairfc.com'a döner; oturum oradaki URL'den (detectSessionInUrl)
// okunur. NOT: WKWebView çerez izolasyonu nedeniyle bu yöntem PWABuilder'da
// her zaman tam çalışmayabilir — test edip karar vereceğiz.
function isIOSWebView() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // Safari'nin kendisi değil ama iOS WebKit ise (uygulama-içi webview)
  const isStandaloneWebView = isIOS && !/safari/i.test(ua);
  // PWA standalone modu da webview gibi davranır
  const isStandalone = typeof window !== "undefined" &&
    (window.navigator.standalone === true ||
     (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches));
  return isIOS && (isStandaloneWebView || isStandalone);
}

export async function signInWithGoogle(supabase) {
  if (!supabase) return { error: "no_client" };
  try {
    const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;

    // iOS webview/standalone: girişi sistem tarayıcısında aç
    if (isIOSWebView()) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true }
      });
      if (error) {
        logSwallowed("auth_google_signin_ios", error);
        return { error: error.message };
      }
      if (data?.url) {
        // _blank → iOS bunu sistem Safari'sinde açar (webview içinde değil)
        window.open(data.url, "_blank");
        return { ok: true, external: true };
      }
      return { error: "no_oauth_url" };
    }

    // Web + Android: normal redirect (çalışıyor)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) {
      logSwallowed("auth_google_signin", error);
      return { error: error.message };
    }
    return { ok: true };
  } catch (e) {
    logSwallowed("auth_google_signin_throw", e);
    return { error: String(e?.message || e) };
  }
}

// Çıkış yap
export async function signOut(supabase) {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch (e) {
    logSwallowed("auth_signout", e);
  }
}

// Mevcut oturumu al (uygulama açılışında)
export async function getSession(supabase) {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
  } catch (e) {
    logSwallowed("auth_get_session", e);
    return null;
  }
}

// Bir kullanıcının profilini (username) çek. 1a'da sadece "var mı / username
// set edilmiş mi" diye bakmak için; 1b'de username picker bunu kullanacak.
export async function fetchProfile(supabase, userId) {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, created_at")
      .eq("id", userId)
      .single();
    if (error) {
      if (error.code !== "PGRST116") logSwallowed("auth_fetch_profile", error);
      return null;
    }
    return data;
  } catch (e) {
    logSwallowed("auth_fetch_profile_throw", e);
    return null;
  }
}
