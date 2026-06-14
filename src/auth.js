// =============================================
// PairFC Nickname/XP Helper — Supabase (OAuth YOK)
// =============================================
// OAuth denendi ama PWABuilder iOS WKWebView'de Google girişi çalışmadı.
// KARAR: kimlik = mevcut anonim client_id + benzersiz nickname. Email toplanmaz.
// Bu modül profil (nickname) ve XP ile ilgili tüm Supabase çağrılarını toplar.

import { logSwallowed } from "./utils/errors";

// Bu client_id'ye ait profil (nickname) var mı? Açılışta çağrılır.
export async function fetchProfileByClientId(supabase, clientId) {
  if (!supabase || !clientId) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("client_id, nickname, created_at")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) { logSwallowed("nick_fetch_profile", error); return null; }
    return data || null;
  } catch (e) {
    logSwallowed("nick_fetch_profile_throw", e);
    return null;
  }
}

// Nickname müsait mi? (anlık UI uyarısı için)
export async function isNicknameAvailable(supabase, nickname) {
  if (!supabase || !nickname) return false;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("client_id")
      .eq("nickname", nickname)
      .limit(1);
    if (error) { logSwallowed("nick_check", error); return false; }
    return !data || data.length === 0;
  } catch (e) {
    logSwallowed("nick_check_throw", e);
    return false;
  }
}

// Nickname kaydet (yeni profil oluştur) + user_xp satırını başlat.
// Benzersizlik DB unique constraint ile garanti; çakışırsa { error: "taken" }.
export async function registerNickname(supabase, clientId, nickname) {
  if (!supabase || !clientId) return { error: "no_client" };
  const clean = String(nickname || "").trim();
  if (clean.length < 3) return { error: "too_short" };
  if (clean.length > 20) return { error: "too_long" };

  try {
    const { error: pErr } = await supabase
      .from("profiles")
      .insert([{ client_id: clientId, nickname: clean }]);
    if (pErr) {
      if (pErr.code === "23505") return { error: "taken" }; // unique violation
      logSwallowed("nick_register_profile", pErr);
      return { error: pErr.message };
    }
    // XP satırını oluştur (best-effort; profil önemli olan)
    const { error: xErr } = await supabase
      .from("user_xp")
      .insert([{ client_id: clientId, nickname: clean, total_xp: 0, weekly_xp: 0 }]);
    if (xErr && xErr.code !== "23505") logSwallowed("nick_register_xp", xErr);

    return { ok: true, nickname: clean };
  } catch (e) {
    logSwallowed("nick_register_throw", e);
    return { error: String(e?.message || e) };
  }
}

// XP ekle — Supabase add_xp fonksiyonunu çağırır (atomik + haftalık reset).
// delta: bu oyunda kazanılan XP. Sürüm 2'de oyun sonlarına bağlanacak.
export async function addXp(supabase, clientId, delta) {
  if (!supabase || !clientId || !delta || delta <= 0) return;
  try {
    const { error } = await supabase.rpc("add_xp", {
      p_client_id: clientId,
      p_delta: Math.round(delta)
    });
    if (error) logSwallowed("nick_add_xp", error);
  } catch (e) {
    logSwallowed("nick_add_xp_throw", e);
  }
}

// Sıralama çek. scope: "total" | "weekly". Sürüm 3'te sıralama ekranı kullanacak.
export async function fetchLeaderboard(supabase, scope = "total", limit = 100) {
  if (!supabase) return [];
  const col = scope === "weekly" ? "weekly_xp" : "total_xp";
  try {
    const { data, error } = await supabase
      .from("user_xp")
      .select(`nickname, ${col}`)
      .order(col, { ascending: false })
      .limit(limit);
    if (error) { logSwallowed("nick_leaderboard", error); return []; }
    return (data || []).map((r) => ({ nickname: r.nickname, xp: r[col] || 0 }));
  } catch (e) {
    logSwallowed("nick_leaderboard_throw", e);
    return [];
  }
}
