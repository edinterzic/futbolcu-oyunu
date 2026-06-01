// =============================================
// PairFC Arena — Otomatik Soru Üretimi + Yardımcılar
// =============================================
// players.js'ten kaliteli (ortak oyuncu sayısı yeterli) soru çiftleri üretir.
// Bir soru = (Kulüp A, Kulüp B, Cevap Havuzu).

import { PLAYERS, TEAMS } from "../data/gameData";

const MIN_ANSWERS_PER_PAIR = 3;
const MAX_ANSWERS_PER_PAIR = 30; // çok genel çiftler de istemiyoruz

// =============================================
// Zorluk havuzları (App.jsx Marathon ile birebir aynı)
// =============================================
const EASY_TEAMS = new Set([
  // Top Avrupa devleri
  "Real Madrid", "Barcelona", "Bayern Munich",
  "Manchester United", "Manchester City", "Liverpool", "Chelsea", "Arsenal",
  "Juventus", "AC Milan", "Inter", "PSG",
  "Atletico Madrid", "Borussia Dortmund",
  // Üç büyük Türk
  "Fenerbahçe", "Beşiktaş", "Galatasaray"
]);

const TIER_2_TEAMS = [
  "Tottenham", "Napoli", "AS Roma", "Ajax", "FC Porto",
  "Benfica", "Sevilla", "Newcastle", "LOSC Lille",
  "Atalanta", "Lazio", "Leverkusen", "Sporting CP",
  "Aston Villa", "Valencia", "Villarreal", "Real Sociedad",
  "Athletic Bilbao", "Fiorentina", "Marsilya", "Monaco",
  "Feyenoord", "PSV", "West Ham", "Everton"
];

const MEDIUM_TEAMS = new Set([
  ...EASY_TEAMS,
  ...TIER_2_TEAMS,
  "Trabzonspor", "Başakşehir"
]);

function isPairInArenaDifficulty(clubA, clubB, difficulty) {
  if (difficulty === "easy") return EASY_TEAMS.has(clubA) && EASY_TEAMS.has(clubB);
  if (difficulty === "medium") return MEDIUM_TEAMS.has(clubA) && MEDIUM_TEAMS.has(clubB);
  return true; // hard = tüm havuz
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

// Bir oyuncunun suggestion token'larını çıkar (isim + alias + her bir kelime)
function buildSuggestionTokens(player) {
  const rawValues = [player.name, ...(player.aliases || [])];
  const tokenSet = new Set();
  rawValues.forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;
    tokenSet.add(normalizeAnswer(text));
    text.replaceAll("-", " ")
      .split(" ")
      .map((part) => normalizeAnswer(part))
      .filter(Boolean)
      .forEach((part) => tokenSet.add(part));
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

// Input için suggestion oyuncuları döner (top 6)
export function getArenaSuggestions(userInput) {
  const query = normalizeAnswer(userInput);
  if (query.length < 1) return [];
  return getSortedPlayers()
    .filter((p) => p.suggestionTokens.some((t) => t.startsWith(query)))
    .slice(0, 6);
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
    if (answers.length > MAX_ANSWERS_PER_PAIR) continue;
    const [a, b] = key.split("||");
    valid.push({ clubA: a, clubB: b, answers });
  }

  cachedPairs = valid;
  console.log(`[Arena] ${valid.length} kaliteli kulüp çifti hazırlandı.`);
  return valid;
}

// n adet rastgele, tekrar etmeyen soru üretir
// difficulty: "easy" | "medium" | "hard" (default: medium)
export function generateArenaQuestions(count, difficulty = "medium") {
  const allPairs = buildArenaPairs();
  if (allPairs.length === 0) return [];

  // Difficulty filtresi
  const filtered = allPairs.filter((p) =>
    isPairInArenaDifficulty(p.clubA, p.clubB, difficulty)
  );

  // Filtre sonrası hiç çift yoksa, sessizce tüm havuza düş
  // (host'un yarışmasını kurtarmak için — pratikte easy/medium'da bol çift var)
  const pool = filtered.length > 0 ? filtered : allPairs;

  if (filtered.length === 0 && difficulty !== "hard") {
    console.warn(`[Arena] '${difficulty}' havuzunda çift bulunamadı, tüm havuza geri dönüldü.`);
  } else {
    console.log(`[Arena] '${difficulty}' havuzu: ${filtered.length} çift (toplam ${allPairs.length}).`);
  }

  const safe = Math.min(count, pool.length);
  const indices = new Set();
  while (indices.size < safe) {
    indices.add(Math.floor(Math.random() * pool.length));
  }

  return [...indices].map((i) => ({
    clubA: pool[i].clubA,
    clubB: pool[i].clubB,
    correctAnswers: pool[i].answers,
  }));
}

// Bir tahmin doğru mu? Hem tam isim hem soyad eşleşmesi kabul
export function checkArenaAnswer(guess, correctAnswers) {
  const normalized = normalizeAnswer(guess);
  if (!normalized) return false;
  return correctAnswers.some((ans) => {
    const fullNorm = normalizeAnswer(ans);
    if (fullNorm === normalized) return true;
    const lastWord = ans.split(/\s+/).slice(-1)[0];
    return normalizeAnswer(lastWord) === normalized;
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
