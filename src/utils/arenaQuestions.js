// =============================================
// PairFC Arena — Otomatik Soru Üretimi
// =============================================
// players.js'ten kaliteli (ortak oyuncu sayısı yeterli) soru çiftleri üretir.
// Bir soru = (Kulüp A, Kulüp B, Cevap Havuzu).
// Cevap havuzu en az 3 oyuncu içermeli ki tahmini kolay yapılamasın
// ama "anlaşılabilir" zorlukta kalsın.

import { PLAYERS, TEAMS } from "../data/gameData";

const MIN_ANSWERS_PER_PAIR = 3;
const MAX_ANSWERS_PER_PAIR = 30; // çok genel çiftler de istemiyoruz (örn Real Madrid+Barcelona 50+)

// Bir kez build edilir: tüm geçerli kulüp çiftlerini ve cevaplarını çıkarır.
let cachedPairs = null;

function buildArenaPairs() {
  if (cachedPairs) return cachedPairs;

  const teamSet = new Set(TEAMS);
  const pairMap = new Map(); // "TeamA||TeamB" -> [oyuncu adları]

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

  // Geçerli çiftler: 3-30 cevap aralığında
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

// n adet rastgele, tekrar etmeyen soru üretir.
export function generateArenaQuestions(count) {
  const pool = buildArenaPairs();
  if (pool.length === 0) return [];

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

// Normalize: cevap doğrulamasında i18n/türkçe karakter eşleştirmesi
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

// Bir tahmin doğru mu? (cevap havuzunda var mı)
export function checkArenaAnswer(guess, correctAnswers) {
  const normalized = normalizeAnswer(guess);
  if (!normalized) return false;
  return correctAnswers.some((ans) => {
    const fullNorm = normalizeAnswer(ans);
    if (fullNorm === normalized) return true;
    // Soyadı eşleşmesi de kabul (örn "Sneijder" → "Wesley Sneijder")
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

// 6 haneli rastgele PIN üretir (ambiguous karakterler dahil değil)
export function makeArenaPin() {
  const digits = "0123456789";
  let pin = "";
  for (let i = 0; i < 6; i++) {
    pin += digits[Math.floor(Math.random() * digits.length)];
  }
  return pin;
}
