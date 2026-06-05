// =============================================
// PairFC Hata Loglama Helper'ı
// =============================================
// Boş catch blokları "sessiz hata" üretir — production'da bir bug oluşunca
// kaynağını bulmak imkansız hale gelir. Bu helper ile, "yutulan" hataları
// merkezi bir yerden hem developer console'a hem PostHog'a (varsa) yollarız.
//
// KULLANIM:
//   try {
//     await supabase.from("answer_log").insert(...);
//   } catch (e) {
//     logSwallowed("answer_log_insert", e);
//   }
//
// NOT: localStorage / analytics / audio.play() gibi NORMALDE FAIL OLABİLECEK
// (private mode, autoplay policy, etc.) yerlerde KULLANMA — sadece "bu fail
// olursa bilgi sahibi olmak isterim" denilen yerlerde kullan.

/**
 * Yutulan bir hatayı bağlam bilgisiyle merkezi olarak logla.
 * - DEV ortamında: console.warn ile dev tool'a yazar
 * - PROD ortamında: PostHog (yüklüyse) "swallowed_error" event'i atar
 * - Her durumda asla re-throw etmez
 *
 * @param {string} context - "supabase_arena_answer_insert" gibi tanımlayıcı
 * @param {Error|unknown} err - catch'ten gelen hata
 * @param {object} [extra] - opsiyonel ek metadata (örn. { roomId, userId })
 */
export function logSwallowed(context, err, extra = {}) {
  const message = err?.message || String(err || "unknown");

  if (import.meta.env.DEV) {
    // Dev'de uyarıyı görünür yap
    console.warn(`[swallowed:${context}]`, err, extra);
  }

  // Prod'da PostHog'a yolla (yüklüyse). Yoksa zaten DEV log'u yeterli oldu.
  try {
    if (typeof window !== "undefined" && typeof window.posthog?.capture === "function") {
      window.posthog.capture("swallowed_error", {
        context,
        message: String(message).slice(0, 500),
        stack: err?.stack ? String(err.stack).slice(0, 1000) : undefined,
        ...extra
      });
    }
  } catch {
    // Logger'ın kendisi fail olursa sessiz — re-throw etmek tehlikeli
  }
}
