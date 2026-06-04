// =================== GÜNLÜK BULMACA ===================
// Her gün herkes aynı 5 eşleşmeyi oynar. Tarih seed'i ile deterministik.
// Türkiye saati 00:00'da yeni bulmaca.
// Rampa: 2 kolay (tier1) -> 2 orta (tier2) -> 1 final (tier3). Her zaman kolaydan zora.

import { getPairKey } from "./gameData";

// Türkiye saatine göre günün tarih string'i (YYYY-MM-DD)
export function getTodayKey() {
  const now = new Date();
  const tr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  return tr; // "2026-05-18" formatında
}

// Bugünden bir sonraki TR gece yarısına kalan süre (ms)
export function getMsUntilNextPuzzle() {
  const now = new Date();
  const trOffsetMs = 3 * 60 * 60 * 1000;
  const trNow = now.getTime() + trOffsetMs;
  const trDate = new Date(trNow);
  const tomorrow = new Date(Date.UTC(
    trDate.getUTCFullYear(),
    trDate.getUTCMonth(),
    trDate.getUTCDate() + 1
  ));
  return tomorrow.getTime() - trNow;
}

// String'den deterministic 32-bit integer seed
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Mulberry32 — fast, deterministic PRNG
function mulberry32(seed) {
  let t = seed;
  return function rand() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Bugünün bulmacasını üret. weightedPairs: App.jsx'teki WEIGHTED_TEAM_PAIRS
// difficulty: 1 = kolay (cevap çok), 2 = orta, 3 = final (cevap az)
export function getDailyPuzzle(weightedPairs) {
  const today = getTodayKey();
  const seed = hashString(today);
  const rng = mulberry32(seed);

  // Pair'leri zenginleştir + deterministik sırala
  // App.jsx annotatedPairs üretirken bucket'ı her zaman set ediyor (1/2/3).
  // bucket: 1 = kolay (Tier 1×1), 2 = orta (Medium havuzu içinde), 3 = zor.
  const enriched = weightedPairs
    .map((p) => {
      const key = getPairKey(p.teams[0], p.teams[1]);
      return { teams: p.teams, key, bucket: p.bucket };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  // 3 zorluk havuzu (oyunun zorluk tanımıyla aynı: takım-tier bazlı)
  const tier1 = enriched.filter((p) => p.bucket === 1); // kolay
  const tier2 = enriched.filter((p) => p.bucket === 2); // orta
  const tier3 = enriched.filter((p) => p.bucket === 3); // zor / final

  // Deterministik Fisher-Yates shuffle
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function pickN(pool, n, exclude) {
    const available = pool.filter((p) => !exclude.has(p.key));
    if (available.length === 0) return [];
    return shuffle(available).slice(0, n);
  }

  const exclude = new Set();
  const picks = [];

  // Hedef: 2 kolay + 2 orta + 1 final
  const plan = [
    [tier1, 2, 1],
    [tier2, 2, 2],
    [tier3, 1, 3]
  ];

  for (const [pool, count, difficulty] of plan) {
    const got = pickN(pool, count, exclude);
    got.forEach((g) => {
      picks.push({ ...g, difficulty });
      exclude.add(g.key);
    });
  }

  // 5'e ulaşamadıysak (örn. yeterli tier3 yoksa) diğer havuzlardan doldur.
  // Zorluk etiketi hangi havuzdan geldiyse ondan gelir.
  const fillOrder = [[tier1, 1], [tier2, 2], [tier3, 3]];
  while (picks.length < 5) {
    let added = false;
    for (const [pool, difficulty] of fillOrder) {
      if (picks.length >= 5) break;
      const got = pickN(pool, 1, exclude);
      if (got.length > 0) {
        picks.push({ ...got[0], difficulty });
        exclude.add(got[0].key);
        added = true;
      }
    }
    if (!added) break;
  }

  // Rampa her zaman korunsun: kolaydan zora sırala
  const ordered = picks.slice(0, 5).sort((a, b) => a.difficulty - b.difficulty);

  return {
    date: today,
    puzzles: ordered.map((p) => ({ teams: p.teams, key: p.key, difficulty: p.difficulty }))
  };
}

// Streak hesaplaması — localStorage'daki sonuçlardan
export function calculateStreak(history) {
  if (!history) return 0;
  const dates = Object.keys(history).sort().reverse();
  if (dates.length === 0) return 0;

  let streak = 0;
  let cursor = getTodayKey();

  if (!history[cursor]) {
    const d = new Date(cursor);
    d.setDate(d.getDate() - 1);
    cursor = d.toISOString().slice(0, 10);
  }

  while (history[cursor]) {
    const entry = history[cursor];
    const solved = entry.attempts && entry.attempts.filter((a) => a === "correct").length > 0;
    if (!solved) break;
    streak += 1;
    const d = new Date(cursor);
    d.setDate(d.getDate() - 1);
    cursor = d.toISOString().slice(0, 10);
  }

  return streak;
}
