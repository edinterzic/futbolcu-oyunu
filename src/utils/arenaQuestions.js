// =============================================
// PairFC Arena — Otomatik Soru Üretimi + Yardımcılar
// =============================================
// players.js'ten kaliteli (ortak oyuncu sayısı yeterli) soru çiftleri üretir.
// Bir soru = (Kulüp A, Kulüp B, Cevap Havuzu).

import { PLAYERS, TEAMS } from "../data/gameData";
import { TEAM_LOGOS } from "../data/teamLogos";
import {
  EASY_TEAMS, MEDIUM_TEAMS,
  TIER_WEIGHTS_BY_MODE,
  getTierWeight
} from "../data/tiers";

// Arena filter Maraton ile aynı: en az 2 ortak oyuncu, üst limit yok.
// (Eskiden 3-30 idi — üst limit nedeniyle Milan↔Inter 119, GS↔FB 51 gibi yüksek
// ortak oyunculu çiftler Arena'dan dışlanıyordu. Easy mode'da "ilk 3 garanti"
// mekanizması bu yüzden Arena'da çalışmıyordu. App.jsx ile parite sağlandı.)
const MIN_ANSWERS_PER_PAIR = 2;

function isPairInArenaDifficulty(clubA, clubB, difficulty) {
  if (difficulty === "easy") return EASY_TEAMS.has(clubA) && EASY_TEAMS.has(clubB);
  if (difficulty === "medium") return MEDIUM_TEAMS.has(clubA) && MEDIUM_TEAMS.has(clubB);
  return true; // hard = tüm havuz
}

// App.jsx ile parite: aynı ülke derbileri (FB-GS, El Clásico, Manchester,
// Milano…) eşit tier ağırlığında pratikte "asla gelmiyor" hissi veriyordu.
// 3x boost ile bu kıymetli çiftler görünür sıklığa çıkar. App.jsx'teki
// SAME_COUNTRY_BOOST = 3 ile birebir aynı.
const SAME_COUNTRY_BOOST = 3;

function isSameCountryArenaPair(clubA, clubB) {
  const ca = TEAM_LOGOS[clubA]?.country;
  const cb = TEAM_LOGOS[clubB]?.country;
  return Boolean(ca) && ca === cb;
}

// Arena tier ağırlığı — App.jsx ile aynı tier matrisini (./data/tiers.js) ve
// aynı same-country boost'u kullanır. Böylece "orta zorlukta tier 1 ile tier 2
// daha çok eşleşir" mantığı Arena'da da (custom mod dahil) birebir çalışır.
function getArenaPairWeight(clubA, clubB, difficulty) {
  let w = getTierWeight(clubA, clubB, difficulty);
  if (w > 0 && isSameCountryArenaPair(clubA, clubB)) w *= SAME_COUNTRY_BOOST;
  return w;
}

// Weighted random pick — pool boş veya total weight 0 ise uniform fallback
function pickWeighted(pool, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(Math.random() * pool.length);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return pool.length - 1;
}

// Normalize fonksiyonu (Türkçe + diakritik)
export function normalizeAnswer(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ı]/g, "i")
    .replace(/[ğ]/g, "g")
    .replace(/[ü]/g, "u")
    .replace(/[ş]/g, "s")
    .replace(/[ç]/g, "c")
    .replace(/[ö]/g, "o")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Bir oyuncunun suggestion token'larını çıkar (isim + alias + her kelime +
// çok parçalı soyad birleşik suffix'leri: "van persie"→"vanpersie")
function buildSuggestionTokens(player) {
  const rawValues = [player.name, ...(player.aliases || [])];
  const tokenSet = new Set();
  rawValues.forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;
    tokenSet.add(normalizeAnswer(text));
    const words = text.replaceAll("-", " ")
      .split(" ")
      .map((part) => normalizeAnswer(part))
      .filter(Boolean);
    words.forEach((part) => tokenSet.add(part));
    // Sondan birleşik suffix'ler (≥2 kelime)
    for (let start = words.length - 2; start >= 0; start--) {
      tokenSet.add(words.slice(start).join(""));
    }
  });
  return Array.from(tokenSet);
}

// SORTED_PLAYERS: alfabetik, suggestionTokens dahil — bir kez build
let cachedSortedPlayers = null;
function getSortedPlayers() {
  if (cachedSortedPlayers) return cachedSortedPlayers;
  cachedSortedPlayers = PLAYERS
    .map((p) => ({
      name: p.name,
      suggestionTokens: buildSuggestionTokens(p)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));
  return cachedSortedPlayers;
}

// Input için suggestion oyuncuları döner.
// Limit 30: App.jsx'teki getPlayerSuggestions ile parite. "dembele" gibi
// soyadlarda 3-4 farklı oyuncu (Ousmane, Mousa, Moussa, Bingourou…) olabiliyor;
// 6'lık eski limit alfabetik sırada sonda kalanları kesip Arena'da bulunmaz
// yapıyordu. 30 hem tüm varyantları kapsar hem render performansı için makul.
export function getArenaSuggestions(userInput) {
  const query = normalizeAnswer(userInput);
  if (query.length < 1) return [];
  return getSortedPlayers()
    .filter((p) => p.suggestionTokens.some((t) => t.startsWith(query)))
    .slice(0, 30);
}

// Bir kez build edilir: tüm geçerli kulüp çiftlerini ve cevaplarını çıkarır
let cachedPairs = null;
function buildArenaPairs() {
  if (cachedPairs) return cachedPairs;

  const teamSet = new Set(TEAMS);
  const pairMap = new Map();

  for (const p of PLAYERS) {
    const clubs = (p.clubs || []).filter((c) => teamSet.has(c));
    if (clubs.length < 2) continue;
    const sorted = [...new Set(clubs)].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}||${sorted[j]}`;
        if (!pairMap.has(key)) pairMap.set(key, []);
        pairMap.get(key).push(p.name);
      }
    }
  }

  const valid = [];
  for (const [key, answers] of pairMap.entries()) {
    if (answers.length < MIN_ANSWERS_PER_PAIR) continue;
    const [a, b] = key.split("||");
    valid.push({ clubA: a, clubB: b, answers });
  }

  cachedPairs = valid;
  console.log(`[Arena] ${valid.length} kaliteli kulüp çifti hazırlandı.`);
  return valid;
}

// n adet rastgele, tekrar etmeyen soru üretir.
// difficulty: "easy" | "medium" | "hard" (default: medium)
// leagueTeams: opsiyonel Set<string> — verilirse SADECE her iki kulübü de bu
//   sette olan çiftler havuza girer (Arena "özel mod" lig filtresi). null/boş
//   ise tüm havuz kullanılır.
//
// ÖNEMLİ (custom mod başlatma bug fix): Eskiden custom mod difficulty="hard"
// ile çağırıp dönen sonucu JS tarafında lig filtresinden geçiriyordu. Dar lig
// seçimlerinde overshoot yetmiyor → ya "filtre çok dar" hatası ya da binlerce
// çift arasından tekrarsız seçim yavaşlıyordu ("başlamıyor/geç başlıyor").
// Şimdi lig filtresi havuza ÖNCE uygulanıyor; weighted seçim zaten daralmış
// havuzda yapılıyor, overshoot/discard yok. Tier ağırlığı (orta zorlukta
// tier1↔tier2 yoğunluğu) tüm modlarda — custom dahil — aynı çalışır.
//
// Easy modunda ilk 3 soru en yüksek ortak-oyuncu çiftlerinden gelir (herkes 3'ü
// garanti yapsın diye). Geri kalan sorular tier-bilinçli weighted random.
export function generateArenaQuestions(count, difficulty = "medium", leagueTeams = null) {
  const allPairs = buildArenaPairs();
  if (allPairs.length === 0) return [];

  const hasLeagueFilter = leagueTeams instanceof Set && leagueTeams.size > 0;

  // 1) Önce lig filtresi (varsa), sonra difficulty filtresi.
  const inLeague = hasLeagueFilter
    ? allPairs.filter((p) => leagueTeams.has(p.clubA) && leagueTeams.has(p.clubB))
    : allPairs;

  const filtered = inLeague.filter((p) =>
    isPairInArenaDifficulty(p.clubA, p.clubB, difficulty)
  );

  // Difficulty filtresi havuzu boşaltırsa, lig içinde kalarak difficulty'yi
  // gevşet (custom modda dar lig + zorluk kombinasyonu kilitlenmesin).
  let pool = filtered;
  if (pool.length === 0) pool = inLeague;
  // Lig filtresi bile çift bırakmadıysa son çare tüm havuz (yine de soru üretilsin).
  if (pool.length === 0) pool = allPairs;

  console.log(
    `[Arena] havuz: lig=${hasLeagueFilter ? leagueTeams.size + " takım" : "tümü"}, ` +
    `'${difficulty}' sonrası ${filtered.length} çift (kullanılan ${pool.length}).`
  );

  const safe = Math.min(count, pool.length);
  const result = [];
  const usedKeys = new Set();
  const keyOf = (p) => `${p.clubA}||${p.clubB}`;

  // ── EASY-START: Easy modunda ilk min(3, safe) soru top-10 ortak-oyuncu pool'undan
  if (difficulty === "easy" && safe > 0) {
    const sorted = [...pool].sort((a, b) => b.answers.length - a.answers.length);
    const topPool = sorted.slice(0, Math.min(10, sorted.length));
    const startCount = Math.min(3, safe);
    while (result.length < startCount && topPool.length > 0) {
      const idx = Math.floor(Math.random() * topPool.length);
      const pair = topPool.splice(idx, 1)[0];
      if (!usedKeys.has(keyOf(pair))) {
        result.push(pair);
        usedKeys.add(keyOf(pair));
      }
    }
  }

  // ── Geri kalan sorular: tier-weighted random (App.jsx ile aynı matris+boost) ──
  const remaining = pool.filter((p) => !usedKeys.has(keyOf(p)));
  while (result.length < safe && remaining.length > 0) {
    const weights = remaining.map((p) => getArenaPairWeight(p.clubA, p.clubB, difficulty));
    const idx = pickWeighted(remaining, weights);
    const pair = remaining.splice(idx, 1)[0];
    result.push(pair);
    usedKeys.add(keyOf(pair));
  }

  return result.map((p) => ({
    clubA: p.clubA,
    clubB: p.clubB,
    correctAnswers: p.answers,
  }));
}

// Bir tahmin doğru mu? Tam isim, tek soyad VE çok parçalı soyad ("van persie",
// "de gea") kabul edilir. Eskiden sadece son kelimeye bakıyordu → "van persie"
// yazımı "persie" dışında çalışmıyordu.
export function checkArenaAnswer(guess, correctAnswers) {
  const normalized = normalizeAnswer(guess);
  if (!normalized) return false;
  return correctAnswers.some((ans) => {
    const fullNorm = normalizeAnswer(ans);
    if (fullNorm === normalized) return true;
    const words = ans.replaceAll("-", " ").split(/\s+/)
      .map((w) => normalizeAnswer(w)).filter(Boolean);
    if (words.includes(normalized)) return true;
    // Sondan birleşik suffix'ler: [robin,van,persie]→vanpersie, robinvanpersie
    for (let start = words.length - 2; start >= 0; start--) {
      if (words.slice(start).join("") === normalized) return true;
    }
    return false;
  });
}

// Puanlama: doğru ise 1000 baz + hız bonus (max 500), yanlış ise 0
export function calculateArenaScore(isCorrect, responseTimeMs, roundDurationMs) {
  if (!isCorrect) return 0;
  const elapsed = Math.max(0, Math.min(roundDurationMs, responseTimeMs));
  const remainingRatio = 1 - elapsed / roundDurationMs;
  const speedBonus = Math.round(500 * remainingRatio);
  return 1000 + speedBonus;
}

// 6 haneli rastgele PIN üretir
export function makeArenaPin() {
  const digits = "0123456789";
  let pin = "";
  for (let i = 0; i < 6; i++) {
    pin += digits[Math.floor(Math.random() * digits.length)];
  }
  return pin;
}
