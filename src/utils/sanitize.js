// =============================================
// PairFC İçerik Temizleme Helper'ı — TEK KAYNAK
// =============================================
// Hem leaderboard (challenge_scores) hem Arena (host/oyuncu nickname) hem de
// gelecekte gelebilecek yorum/rapor alanları için ortak küfür/uygunsuz kelime
// filtresi. Önce App.jsx içinde sadece leaderboard için vardı; Arena nickname'leri
// filtrelenmiyordu (lobide görünür ve ekran görüntüsü Twitter'a düşer).

// Türkçe + İngilizce yaygın küfür/uygunsuz kelime listesi.
// Eşleşen kısım yıldızla maskelenir (kullanıcı hâlâ giriş yapabilir, sadece
// uygunsuz kelimeler gizlenir). Tüm-yıldız sonuç "Anonim" olarak değiştirilir.
//
// Liste case-insensitive eşleşir. Ekleme/silme yapmak için sadece bu diziyi düzelt.
const PROFANITY_LIST = [
  // Türkçe
  "amk", "aq", "oç", "oc.", "piç", "sik", "sok", "yarrak", "yarak", "göt", "got ",
  "orospu", "kahpe", "pezevenk", "ibne", "puşt", "gavat", "döl", "amcık", "amcik",
  // İngilizce
  "fuck", "fuk", "shit", "bitch", "cunt", "dick", "pussy", "asshole",
  "nigger", "nigga", "faggot", "whore", "slut", "rape"
];

// Görünür isim/nick'i temizler:
// 1. trim + maxLength karakter sınırı (default 30 — leaderboard; Arena 20 kullanır)
// 2. Boşsa "Anonim"
// 3. Küfür içeriyorsa yıldızla maskeler
// 4. Sadece yıldız/boşluk kaldıysa "Anonim"
export function cleanDisplayName(raw, maxLength = 30) {
  let name = (raw || "").trim().slice(0, maxLength);
  if (!name) return "Anonim";
  const lower = name.toLowerCase();
  let masked = name;
  for (const w of PROFANITY_LIST) {
    if (lower.includes(w)) {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      masked = masked.replace(re, "*".repeat(w.trim().length));
    }
  }
  const stripped = masked.replace(/[*\s]/g, "");
  if (!stripped) return "Anonim";
  return masked;
}

// Inline form validation için — kullanıcı tipliyorken anında uyarı vermek için
// "bu girdide küfür var mı?" diye sorgular. cleanDisplayName ile aynı listeyi
// kullanır ama maskeleme yapmaz, sadece bool döner.
export function containsProfanity(raw) {
  const lower = (raw || "").toLowerCase();
  return PROFANITY_LIST.some((w) => lower.includes(w));
}
