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
export async function signInWithGoogle(supabase) {
  if (!supabase) return { error: "no_client" };
  try {
    const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
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
