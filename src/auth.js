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

// Nickname GÜNCELLE — profiles + user_xp tablolarındaki nickname'i değiştir.
// Benzersizlik DB unique constraint ile garanti; çakışırsa { error: "taken" }.
// user_xp'deki nickname'i de günceller ki sıralamada yeni ad görünsün.
export async function updateNickname(supabase, clientId, nickname) {
  if (!supabase || !clientId) return { error: "no_client" };
  const clean = String(nickname || "").trim();
  if (clean.length < 3) return { error: "too_short" };
  if (clean.length > 20) return { error: "too_long" };

  try {
    // Önce profiles'ı güncelle (unique constraint burada tetiklenir)
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ nickname: clean })
      .eq("client_id", clientId);
    if (pErr) {
      if (pErr.code === "23505") return { error: "taken" }; // unique violation
      logSwallowed("nick_update_profile", pErr);
      return { error: pErr.message };
    }
    // user_xp satırındaki nickname'i de güncelle (sıralama tutarlılığı)
    const { error: xErr } = await supabase
      .from("user_xp")
      .update({ nickname: clean })
      .eq("client_id", clientId);
    if (xErr) logSwallowed("nick_update_xp", xErr);

    return { ok: true, nickname: clean };
  } catch (e) {
    logSwallowed("nick_update_throw", e);
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

// Kullanıcının kendi sırasını + XP'sini çek. scope: "weekly" | "total".
// Sıra = "benden yüksek XP'li kaç kişi var" + 1. Oyun sonu ekranında kullanılır.
// Döner: { rank, xp } | null
export async function fetchMyRank(supabase, clientId, scope = "weekly") {
  if (!supabase || !clientId) return null;
  const col = scope === "weekly" ? "weekly_xp" : "total_xp";
  try {
    // Önce kendi XP'mi al
    const { data: me, error: meErr } = await supabase
      .from("user_xp")
      .select(`${col}`)
      .eq("client_id", clientId)
      .maybeSingle();
    if (meErr) { logSwallowed("rank_me", meErr); return null; }
    const myXp = me ? (me[col] || 0) : 0;

    // Benden kesinlikle yüksek XP'li kaç kişi var → sıram = o sayı + 1
    const { count, error: cErr } = await supabase
      .from("user_xp")
      .select("client_id", { count: "exact", head: true })
      .gt(col, myXp);
    if (cErr) { logSwallowed("rank_count", cErr); return null; }

    return { rank: (count || 0) + 1, xp: myXp };
  } catch (e) {
    logSwallowed("rank_throw", e);
    return null;
  }
}

// Oyun sonu "yarış kartı" için zengin sıralama bilgisi.
// Kendi sıram + XP'm + bir üstteki rakibin adı/farkı + (1.'ysem) beni kovalayanın farkı.
// scope: "weekly" | "total". Döner:
// {
//   rank, xp, totalPlayers,
//   ahead: { nickname, xp, gap } | null,   // bir üstteki rakip (gap = onu geçmek için gereken XP)
//   chaser: { nickname, xp, gap } | null,  // sadece 1.'yken: beni kovalayan (gap = aramdaki fark)
//   isTop: bool
// } | null
export async function fetchRaceStatus(supabase, clientId, scope = "weekly") {
  if (!supabase || !clientId) return null;
  const col = scope === "weekly" ? "weekly_xp" : "total_xp";
  try {
    // Kendi XP'm
    const { data: me, error: meErr } = await supabase
      .from("user_xp")
      .select(`${col}`)
      .eq("client_id", clientId)
      .maybeSingle();
    if (meErr) { logSwallowed("race_me", meErr); return null; }
    const myXp = me ? (me[col] || 0) : 0;

    // Toplam sıralanan oyuncu sayısı (XP > 0). "X kişi arasında" demek için.
    const { count: total, error: tErr } = await supabase
      .from("user_xp")
      .select("client_id", { count: "exact", head: true })
      .gt(col, 0);
    if (tErr) logSwallowed("race_total", tErr);

    // Benden yüksek XP'li kaç kişi → sıram
    const { count: above, error: aErr } = await supabase
      .from("user_xp")
      .select("client_id", { count: "exact", head: true })
      .gt(col, myXp);
    if (aErr) { logSwallowed("race_above", aErr); return null; }
    const rank = (above || 0) + 1;
    const isTop = rank === 1;

    let ahead = null;
    let chaser = null;

    if (!isTop) {
      // Bir üstteki rakip = benden yüksek XP'liler arasında EN DÜŞÜK XP'li olan.
      // (XP asc + benden büyük → ilk satır en yakın üst.)
      const { data: aboveRows, error: abErr } = await supabase
        .from("user_xp")
        .select(`nickname, ${col}`)
        .gt(col, myXp)
        .order(col, { ascending: true })
        .limit(1);
      if (abErr) logSwallowed("race_ahead", abErr);
      const a = aboveRows && aboveRows[0];
      if (a) {
        const aXp = a[col] || 0;
        ahead = { nickname: a.nickname, xp: aXp, gap: Math.max(1, aXp - myXp + 1) };
      }
    } else {
      // 1.'yim → beni kovalayan = benden düşük XP'liler arasında EN YÜKSEK XP'li.
      const { data: belowRows, error: bErr } = await supabase
        .from("user_xp")
        .select(`nickname, ${col}`)
        .lt(col, myXp)
        .order(col, { ascending: false })
        .limit(1);
      if (bErr) logSwallowed("race_chaser", bErr);
      const b = belowRows && belowRows[0];
      if (b) {
        const bXp = b[col] || 0;
        chaser = { nickname: b.nickname, xp: bXp, gap: Math.max(1, myXp - bXp) };
      }
    }

    return { rank, xp: myXp, totalPlayers: total || rank, ahead, chaser, isTop };
  } catch (e) {
    logSwallowed("race_throw", e);
    return null;
  }
}
