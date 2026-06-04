// =============================================
// PairFC Arena — Otomatik Soru Üretimi + Yardımcılar
// =============================================
// players.js'ten kaliteli (ortak oyuncu sayısı yeterli) soru çiftleri üretir.
// Bir soru = (Kulüp A, Kulüp B, Cevap Havuzu).

import { PLAYERS, TEAMS } from "../data/gameData";
import {
  EASY_TEAMS, MEDIUM_TEAMS,
  TIER_WEIGHTS_BY_MODE,
  getTierWeight
} from "../data/tiers";

const MIN_ANSWERS_PER_PAIR = 3;
const MAX_ANSWERS_PER_PAIR = 30; // çok genel çiftler de istemiyoruz

function isPairInArenaDifficulty(clubA, clubB, difficulty) {
  if (difficulty === "easy") return EASY_TEAMS.has(clubA) && EASY_TEAMS.has(clubB);
  if (difficulty === "medium") return MEDIUM_TEAMS.has(clubA) && MEDIUM_TEAMS.has(clubB);
  return true; // hard = tüm havuz
}

// Arena tier ağırlığı — App.jsx ile aynı tier matrisini kullanır
// (./data/tiers.js'ten gelir). Arena aynı-ülke boost'u eklemiyor.
function getArenaPairWeight(clubA, clubB, difficulty) {
  return getTierWeight(clubA, clubB, difficulty);
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
// Easy modunda ilk 3 soru en yüksek ortak-oyuncu çiftlerinden gelir (herkes 3'ü
// garanti yapsın diye). Geri kalan sorular tier-bilinçli weighted random.
export function generateArenaQuestions(count, difficulty = "medium") {
  const allPairs = buildArenaPairs();
  if (allPairs.length === 0) return [];

  // Difficulty filtresi
  const filtered = allPairs.filter((p) =>
    isPairInArenaDifficulty(p.clubA, p.clubB, difficulty)
  );

  // Filtre sonrası hiç çift yoksa, sessizce tüm havuza düş
  const pool = filtered.length > 0 ? filtered : allPairs;

  if (filtered.length === 0 && difficulty !== "hard") {
    console.warn(`[Arena] '${difficulty}' havuzunda çift bulunamadı, tüm havuza geri dönüldü.`);
  } else {
    console.log(`[Arena] '${difficulty}' havuzu: ${filtered.length} çift (toplam ${allPairs.length}).`);
  }

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

  // ── Geri kalan sorular: tier-weighted random ──
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
