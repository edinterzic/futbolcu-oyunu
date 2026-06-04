// =============================================
// PairFC Tier Sistemi — TEK KAYNAK
// =============================================
// App.jsx ve arenaQuestions.js iki yerden import eder.
// Bu dosyada yapılan değişiklik her iki yerde otomatik yansır
// (eskiden duplicate listeler vardı, drift bug riski oluştururdu).

// =================== TIER LİSTELERİ ===================
// TIER 1: "Popüler" takımlar — Türk taraftar için tanınır + Avrupa devleri
// TIER 2: İkinci kademe Avrupa kulüpleri (Şampiyonlar Ligi adayı)
// TIER 3: Diğer tüm takımlar (otomatik — listede olmayan her şey)
export const TIER_1_TEAMS = [
  // Türk takımları
  "Galatasaray", "Beşiktaş", "Fenerbahçe", "Trabzonspor", "Başakşehir",
  "Antalyaspor", "Konyaspor", "Sivasspor", "Kayserispor", "Alanyaspor",
  "Samsunspor", "Kasımpaşa", "Gaziantep FK",
  "Rizespor", "Gençlerbirliği", "Göztepe",
  "Karagümrük", "Eyüpspor", "Kocaelispor",
  // Avrupa devleri
  "Real Madrid", "Barcelona", "Atletico Madrid", "Bayern Munich",
  "Manchester United", "Manchester City", "Liverpool", "Chelsea", "Arsenal",
  "Juventus", "AC Milan", "Inter", "Borussia Dortmund", "PSG"
];

export const TIER_2_TEAMS = [
  "Tottenham", "Napoli", "AS Roma", "Ajax", "FC Porto",
  "Benfica", "Sevilla", "Newcastle", "LOSC Lille",
  "Atalanta", "Lazio", "Leverkusen", "Sporting CP",
  "Aston Villa", "Valencia", "Villarreal", "Real Sociedad",
  "Athletic Bilbao", "Fiorentina", "Marsilya", "Monaco",
  "Feyenoord", "PSV", "West Ham", "Everton"
];

export const TIER_1_SET = new Set(TIER_1_TEAMS);
export const TIER_2_SET = new Set(TIER_2_TEAMS);

// =================== ZORLUK HAVUZLARI ===================
// Tier'dan farklı bir kavram: zorluk filtresi UI seçimine göre çift filtreliyor.
// EASY:   Top Avrupa devleri + 3 Türk büyüğü (17 takım)
// MEDIUM: EASY ∪ TIER_2 ∪ orta Türk (Trabzon, Başakşehir) = 44 takım
// HARD:   tüm takımlar (filter yok)
export const EASY_TEAMS = new Set([
  "Real Madrid", "Barcelona", "Bayern Munich",
  "Manchester United", "Manchester City", "Liverpool", "Chelsea", "Arsenal",
  "Juventus", "AC Milan", "Inter", "PSG",
  "Atletico Madrid", "Borussia Dortmund",
  "Fenerbahçe", "Beşiktaş", "Galatasaray"
]);

export const MEDIUM_TEAMS = new Set([
  ...EASY_TEAMS,
  ...TIER_2_TEAMS,
  "Trabzonspor", "Başakşehir"
]);

// =================== HELPERS ===================
export function getTier(teamName) {
  if (TIER_1_SET.has(teamName)) return 1;
  if (TIER_2_SET.has(teamName)) return 2;
  return 3;
}

// İki takım çifti belirtilen zorluk havuzunda mı?
// (teamA, teamB) ya da ({teams: [a, b]}, difficulty) iki kullanım da çalışsın
export function isPairInDifficulty(teamA, teamB, difficulty) {
  if (difficulty === "easy") return EASY_TEAMS.has(teamA) && EASY_TEAMS.has(teamB);
  if (difficulty === "medium") return MEDIUM_TEAMS.has(teamA) && MEDIUM_TEAMS.has(teamB);
  return true; // hard
}

// =================== TIER AĞIRLIKLARI ===================
// Easy:   filtre 1-1'e kısıtlı, uniform (1) yeterli — easy-start mekanizması ayrı
// Medium: 1-2 (örn. Real ↔ Leverkusen) DOMİNANT (~%70) — anchor effect
// Hard:   2-3 ve 3-3 pozitif — Bundesliga içi vs. çiftler unlock
export const TIER_WEIGHTS_BY_MODE = {
  easy:   { "1-1": 1 },
  medium: { "1-1": 4, "1-2": 8, "2-2": 3 },
  hard:   { "1-1": 6, "1-2": 4, "1-3": 3, "2-2": 4, "2-3": 2, "3-3": 1 }
};

// Tier-tabanlı ağırlık — aynı-ülke boost'u çağıran kod ekler (App.jsx).
// Arena boost kullanmıyor; direkt bu ağırlığı alıyor.
export function getTierWeight(teamA, teamB, difficulty = "hard") {
  const tierKey = [getTier(teamA), getTier(teamB)].sort().join("-");
  const weights = TIER_WEIGHTS_BY_MODE[difficulty] || TIER_WEIGHTS_BY_MODE.hard;
  return weights[tierKey] ?? 0;
}
