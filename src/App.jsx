import { t, useLang, SUPPORTED_LANGS } from "./i18n";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { PLAYERS, TEAMS, ANSWER_INDEX, getPairKey, getAnswers } from "./data/gameData";
import {
  TIER_1_TEAMS, TIER_2_TEAMS, TIER_1_SET, TIER_2_SET,
  EASY_TEAMS, MEDIUM_TEAMS,
  TIER_WEIGHTS_BY_MODE,
  getTier as getTierFromTiers,
  isPairInDifficulty as isPairInDifficultyFromTiers,
  getTierWeight
} from "./data/tiers";
import { cleanDisplayName } from "./utils/sanitize";
import { logSwallowed } from "./utils/errors";
import {
  normalizeText,
  getNameTokens,
  answerNameMatchesInput,
  buildSuggestionSearchTokens
} from "./utils/normalize";
import {
  drawScoreShareCard,
  shareScoreImage,
  drawDailyShareCard
} from "./utils/canvas";
import { TEAM_LOGOS } from "./data/teamLogos";
import { getDailyPuzzle, getTodayKey, getMsUntilNextPuzzle, calculateStreak } from "./data/dailyPuzzle";
import { SOUND_FILES } from "./data/sounds";
import { initAnalytics, track, startTimer, endTimer, identify } from "./analytics";
import { isPushSupported, getNotificationPermission, subscribeToPush, unsubscribeFromPush } from "./pwa";
import AdminPanel from "./admin/AdminPanel";
import Arena from "./components/Arena";

const WINNING_SCORE = 3;
const ROUND_SECONDS = 20;
const TEAM_SELECT_SECONDS = 20;
const ROUND_REVEAL_SECONDS = 3;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

// =================== LEADERBOARD SUPABASE ===================
// Küfür/uygunsuz kelime filtresi src/utils/sanitize.js'te — Arena ile ortak helper

async function saveScore(playerName, score, difficulty) {
  if (!supabase || score < 1) return null;
  const name = cleanDisplayName(playerName);
  try {
    const { data, error } = await supabase
      .from("challenge_scores")
      .insert([{ player_name: name, score, difficulty }])
      .select()
      .single();
    if (error) { console.error("Skor kayıt hatası:", error); return null; }
    return data;
  } catch (e) { console.error("Skor kayıt:", e); return null; }
}

async function fetchLeaderboard(difficulty, period = "today") {
  if (!supabase) return [];
  try {
    let query = supabase
      .from("challenge_scores")
      .select("id, player_name, score, difficulty, created_at")
      .eq("difficulty", difficulty)
      .order("score", { ascending: false })
      .limit(50);
    if (period === "today") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      query = query.gte("created_at", todayStart.toISOString());
    }
    const { data, error } = await query;
    if (error) { console.error("Leaderboard hatası:", error); return []; }
    return data || [];
  } catch (e) { console.error("Leaderboard:", e); return []; }
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function makeClientId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Intl.DateTimeFormat / NumberFormat için her dilin BCP 47 tag'i.
// Yeni dil eklenirse buraya bir satır eklemek yeter.
const LOCALE_TAGS = {
  tr: "tr-TR",
  en: "en-US",
  es: "es-ES",
  pt: "pt-BR",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT"
};

// normalizeText, getNameTokens, answerNameMatchesInput, buildSuggestionSearchTokens
// artık ./utils/normalize.js'ten import ediliyor — tek kaynak, arenaQuestions.js
// de aynı dosyadan import edebilir (lansman sonrası unify).


const NORMALIZED_PLAYERS = PLAYERS.map((player) => {
  const normalizedClubs = new Set((player.clubs || []).map(normalizeText));
  const answerTokens = new Set([player.name, ...(player.aliases || [])].map(normalizeText));

  return {
    ...player,
    normalizedClubs,
    answerTokens,
    suggestionTokens: buildSuggestionSearchTokens(player)
  };
});

const SORTED_PLAYERS = [...NORMALIZED_PLAYERS].sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));
const PLAYERS_BY_TOKEN = new Map();

NORMALIZED_PLAYERS.forEach((player) => {
  player.answerTokens.forEach((token) => {
    if (token && !PLAYERS_BY_TOKEN.has(token)) {
      PLAYERS_BY_TOKEN.set(token, player);
    }
  });
});

function playerPlayedForClub(player, clubName) {
  return player.normalizedClubs.has(normalizeText(clubName));
}

function getRoundAnswers(round) {
  return getAnswers(round.teams[0], round.teams[1]);
}

function findAcceptedAnswer(round, userInput) {
  const answers = getRoundAnswers(round);
  return answers.find((answer) => answerNameMatchesInput(answer, userInput, answers)) || null;
}

function findPlayerByInput(userInput) {
  const normalizedInput = normalizeText(userInput);
  if (!normalizedInput) return null;

  const exactPlayer = PLAYERS_BY_TOKEN.get(normalizedInput);
  if (exactPlayer) return exactPlayer;

  const tokenMatches = NORMALIZED_PLAYERS.filter((player) => player.suggestionTokens.includes(normalizedInput));
  return tokenMatches.length === 1 ? tokenMatches[0] : null;
}

function isCorrectAnswer(round, userInput) {
  return Boolean(findAcceptedAnswer(round, userInput));
}

function getWrongAnswerExplanation(round, userInput) {
  const acceptedAnswer = findAcceptedAnswer(round, userInput);

  if (acceptedAnswer) {
    return t("exp_accepted", { answer: acceptedAnswer });
  }

  const player = findPlayerByInput(userInput);
  const teamA = round.teams[0];
  const teamB = round.teams[1];

  if (!player) {
    return t("exp_not_in_pool", { input: userInput });
  }

  const playedA = playerPlayedForClub(player, teamA);
  const playedB = playerPlayedForClub(player, teamB);

  if (playedA && !playedB) {
    return t("exp_played_a_only", { name: player.name, teamA, teamB });
  }

  if (!playedA && playedB) {
    return t("exp_played_b_only", { name: player.name, teamA, teamB });
  }

  if (!playedA && !playedB) {
    return t("exp_played_neither", { name: player.name, teamA, teamB });
  }

  return t("exp_data_check", { name: player.name });
}

function getCorrectPlayersForRound(round) {
  return getRoundAnswers(round).map((name) => ({ name }));
}

function getPlayerSuggestions(userInput) {
  const query = normalizeText(userInput);
  if (query.length < 1) return [];

  // Limit 30: "dembele" gibi soyadlarda 3-4 Dembélé var (Ousmane, Mousa, Moussa,
  // Bingourou…); 6'lık eski limit alfabetik sırada sonda kalanı kesiyordu.
  // 30 hem tüm varyantları kapsıyor hem hala render performansı için makul.
  return SORTED_PLAYERS
    .filter((player) => player.suggestionTokens.some((token) => token.startsWith(query)))
    .slice(0, 30);
}

function getRoundKey(round) {
  return getPairKey(round.teams[0], round.teams[1]);
}

// Cevap denemesi kaydı (Supabase, ateşle-unut). Hangi eşleşmede hangi cevap veriliyor + doğru mu.
// Tekrar eden YANLIŞ cevaplar = datada düzeltilecek olası yanlış-negatifler.
function logAnswerAttempt(mode, round, rawInput) {
  if (!supabase || !round || !round.teams || !rawInput) return;
  try {
    const raw = String(rawInput).trim();
    if (!raw) return;
    const matched = findAcceptedAnswer(round, raw);
    supabase.from("answer_log").insert({
      pair_key: getRoundKey(round),
      team_a: round.teams[0],
      team_b: round.teams[1],
      answer_raw: raw.slice(0, 80),
      answer_matched: matched || null,
      correct: Boolean(matched),
      mode
    }).then(() => {}, (err) => logSwallowed("answer_log_insert", err, { mode }));
  } catch (e) {
    logSwallowed("answer_log_attempt", e, { mode });
  }
}

// Bir oyuncunun kaç farklı eşleşmede (takım çiftinde) cevap olduğu — nadirlik proxy'si.
// Düşük = az kulüp bağlantısı = niş/nadir cevap; yüksek = çok gezmiş, bariz cevap.
const PLAYER_PAIR_FREQ = (() => {
  const m = new Map();
  for (const key of Object.keys(ANSWER_INDEX)) {
    for (const name of (ANSWER_INDEX[key] || [])) {
      const k = normalizeText(name);
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
})();

// =================== TAKIM AĞIRLIKLI SEÇİM ===================
// Tier listeleri ve zorluk havuzları artık src/data/tiers.js'ten import ediliyor —
// App.jsx + arenaQuestions.js iki yerde duplicate tutmamak için.

function isPairInDifficulty(pair, difficulty) {
  return isPairInDifficultyFromTiers(pair.teams[0], pair.teams[1], difficulty);
}

function getDifficultyLabel(d) {
  if (d === "easy") return t("diff_easy");
  if (d === "medium") return t("diff_medium");
  return t("diff_hard");
}

function getDifficultyEmoji(d) {
  if (d === "easy") return "🟢";
  if (d === "medium") return "🟡";
  return "🔴";
}

function getTier(teamName) {
  return getTierFromTiers(teamName);
}

// Aynı ülkeden takım çifti mi? Derbiler (FB-GS, Real-Barça, ManU-Liverpool,
// Milan-Inter, vs.) daha sık çıksın diye boost uygulamak için kullanılır.
// TEAM_LOGOS'un country alanı kaynak.
function isSameCountryPair(pair) {
  const ca = TEAM_LOGOS[pair.teams[0]]?.country;
  const cb = TEAM_LOGOS[pair.teams[1]]?.country;
  return Boolean(ca) && ca === cb;
}

// Aynı ülke derbileri ağırlık çarpanı.
// Sorun: 17 takımlı easy pool'da 14 Avrupa devi + 3 TR büyüğü aynı tier 1-1.
// Eşit ağırlıkla FB-GS sadece %2.2 ihtimalle çıkıyor — pratikte "asla gelmiyor"
// olarak hissediliyor. 3x boost ile TR derbileri ~%5'e çıkar (20 turluk bir
// maratonda 1+ derbi beklenir). Aynı zamanda El Clásico, Manchester derbisi,
// Milano derbisi gibi diğer kıymetli aynı-ülke çiftleri de canlanır.
const SAME_COUNTRY_BOOST = 3;

// Tier çiftine göre ağırlık. difficulty verilmezse "hard" varsayılır
// (WEIGHTED_TEAM_PAIRS modül yüklenirken bu çağrıyı yapar — hard pozitiftir,
// 1-1'den 3-3'e kadar her tier kombinasyonu havuza girer).
// Tier matrisi ./data/tiers.js içinde. Aynı ülke boost'u burada ekleniyor.
function getPairWeight(pair, difficulty = "hard") {
  let baseWeight = getTierWeight(pair.teams[0], pair.teams[1], difficulty);
  if (baseWeight > 0 && isSameCountryPair(pair)) {
    baseWeight *= SAME_COUNTRY_BOOST;
  }
  return baseWeight;
}

const PLAYABLE_TEAM_PAIRS = Object.keys(ANSWER_INDEX).map((key) => {
  const [teamA, teamB] = key.split("|");
  return { teams: [teamA, teamB] };
});

// Sıfır ağırlıklı çiftleri ve yalnızca 1 ortak oyuncusu olan çiftleri havuzdan çıkar.
// Not: "hard" ağırlıklarıyla check — yeni sistemde 2-3 ve 3-3 pozitif olduğu için
// 4.4k yeni çift pool'a girer. Asıl filtreleme zorluğa göre getRandomRound'da yapılır.
const WEIGHTED_TEAM_PAIRS = PLAYABLE_TEAM_PAIRS.filter((pair) => {
  if (getPairWeight(pair, "hard") <= 0) return false;
  const key = getPairKey(pair.teams[0], pair.teams[1]);
  return (ANSWER_INDEX[key] || []).length >= 2;
});

// =================== LİG FİLTRESİ ===================
// TEAM_LOGOS'taki league alanından benzersiz lig listesi türetilir.
// Takım sayısına göre azalan sırada (büyük ligler önce).
// Sadece ≥2 takımı olan ligler gösterilir — tek takımlı ligler (örn. Pro League
// için Club Brugge tek başına) seçildiğinde boş havuz oluştururdu. Bu Maraton'da
// canStart guard ile yakalanıyordu ama Düello + Arena guard'sızdı ve FB-GS
// fallback'ine düşüyordu (silent bug).
const LEAGUES = (() => {
  const map = new Map();
  for (const [team, meta] of Object.entries(TEAM_LOGOS)) {
    if (!meta || !meta.league) continue;
    if (!map.has(meta.league)) {
      map.set(meta.league, {
        name: meta.league,
        country: meta.country || "",
        flag: meta.flag || "",
        teamCount: 0
      });
    }
    map.get(meta.league).teamCount++;
  }
  return [...map.values()]
    .filter((l) => l.teamCount >= 2)
    .sort((a, b) => b.teamCount - a.teamCount);
})();

// Seçilen ligler → izinli takım Set'i (null = filtre yok = tümü).
function buildAllowedTeams(selectedLeagues) {
  if (!selectedLeagues || selectedLeagues.length === 0) return null;
  const selSet = new Set(selectedLeagues);
  return new Set(
    Object.entries(TEAM_LOGOS)
      .filter(([_, meta]) => meta && meta.league && selSet.has(meta.league))
      .map(([name]) => name)
  );
}

function pairAllowed(round, allowedTeams) {
  if (!allowedTeams) return true;
  return allowedTeams.has(round.teams[0]) && allowedTeams.has(round.teams[1]);
}

function getPlayableTeamPairs(allowedTeams = null) {
  if (!allowedTeams) return WEIGHTED_TEAM_PAIRS;
  return WEIGHTED_TEAM_PAIRS.filter((p) => pairAllowed(p, allowedTeams));
}

function getRandomRound(usedRoundKeys = [], difficulty = "hard", allowedTeams = null) {
  // Önce lig filtresi (varsa), sonra difficulty.
  let allowedPool = WEIGHTED_TEAM_PAIRS;
  if (allowedTeams) {
    allowedPool = allowedPool.filter((round) => pairAllowed(round, allowedTeams));
  }
  // Lig filtresi sonrası tamamen boşsa (örn. tek takımlı lig seçildi) — null dön.
  if (allowedPool.length === 0) return null;

  const difficultyFiltered = allowedPool.filter((round) => isPairInDifficulty(round, difficulty));
  const basePool = difficultyFiltered.length > 0 ? difficultyFiltered : allowedPool;
  const available = basePool.filter((round) => !usedRoundKeys.includes(getRoundKey(round)));

  // Eşleşme kalmadıysa null dön — çağıran kod zorluk yükseltir veya filtre uyarısı verir
  if (available.length === 0) return null;

  // ── EASY-START: ilk 3 turda en yüksek ortak-oyuncu çiftlerinden seç ──
  // UX: "Herkes 3 yapabilsin". Sonraki turlar normal weighted random.
  // Sadece Easy modunda, sadece üçüncü tura kadar.
  if (difficulty === "easy" && usedRoundKeys.length < 3) {
    const ranked = available
      .map((p) => ({
        p,
        n: (ANSWER_INDEX[getPairKey(p.teams[0], p.teams[1])] || []).length
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, Math.min(10, available.length));
    if (ranked.length > 0) {
      return ranked[Math.floor(Math.random() * ranked.length)].p;
    }
  }

  // ── Zorluk-bilinçli weighted random ──
  const totalWeight = available.reduce((sum, pair) => sum + getPairWeight(pair, difficulty), 0);
  if (totalWeight <= 0) {
    return available[Math.floor(Math.random() * available.length)];
  }

  let random = Math.random() * totalWeight;
  for (const pair of available) {
    random -= getPairWeight(pair, difficulty);
    if (random <= 0) return pair;
  }
  return available[available.length - 1];
}

// Challenge: zorluk tükenince bir üst zorluğa geç
const DIFFICULTY_ORDER = ["easy", "medium", "hard"];
const DIFFICULTY_LABELS = { easy: "Kolay", medium: "Orta", hard: "Zor" };

function getNextChallengeRound(usedKeys, startDifficulty, allowedTeams = null) {
  const startIdx = DIFFICULTY_ORDER.indexOf(startDifficulty);
  // Mevcut zorluktan başlayarak yukarı dene
  for (let i = Math.max(0, startIdx); i < DIFFICULTY_ORDER.length; i++) {
    const round = getRandomRound(usedKeys, DIFFICULTY_ORDER[i], allowedTeams);
    if (round) {
      return {
        round,
        newDifficulty: DIFFICULTY_ORDER[i],
        escalated: i > startIdx,
        escalatedLabel: DIFFICULTY_LABELS[DIFFICULTY_ORDER[i]]
      };
    }
  }
  // Tüm zorluklar tükendi — usedKeys sıfırla, baştan başla
  const round = getRandomRound([], startDifficulty, allowedTeams) || { teams: ["Fenerbahçe", "Galatasaray"] };
  return { round, newDifficulty: startDifficulty, escalated: false, reset: true };
}

// =================== EFEKT HELPERS ===================
// Konfeti: 40 parça rastgele renkli div ekrana ekler, 3 saniye sonra siler
function triggerConfetti() {
  if (typeof document === "undefined") return;
  const colors = ["#10b981", "#f59e0b", "#38bdf8", "#ef4444", "#a855f7", "#22c55e", "#ec4899"];
  for (let i = 0; i < 40; i += 1) {
    const c = document.createElement("div");
    c.className = "confetti-particle";
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.3}s`;
    c.style.animationDuration = `${1.6 + Math.random() * 0.8}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => { c.remove(); }, 3000);
  }
}

// Ekran flash: kırmızı (yanlış) veya yeşil (doğru) yarı saydam katman
function triggerScreenFlash(type) {
  if (typeof document === "undefined") return;
  const flash = document.createElement("div");
  flash.className = `screen-flash screen-flash-${type}`;
  document.body.appendChild(flash);
  setTimeout(() => { flash.remove(); }, 400);
}

function runSelfTests() {
  console.assert(normalizeText("Mesut Özil") === normalizeText("mesut ozil"), "Turkish character normalization failed");
  console.assert(normalizeText("Hakan Şükür") === normalizeText("hakan sukur"), "Turkish s/ü normalization failed");
  // NFD'nin parçalamadığı bağımsız Latin harfleri — regresyon koruması
  console.assert(normalizeText("Simon Kjær") === normalizeText("Simon Kjaer"), "æ → ae normalization failed");
  console.assert(normalizeText("Brøndby") === normalizeText("Brondby"), "ø → o normalization failed");
  console.assert(normalizeText("Eiður Guðjohnsen") === normalizeText("Eidur Gudjohnsen"), "ð → d normalization failed");
  console.assert(normalizeText("Großkreutz") === normalizeText("Grosskreutz"), "ß → ss normalization failed");
  console.assert(normalizeText("Łukasz") === normalizeText("Lukasz"), "ł → l normalization failed");
  console.assert(normalizeText("Đorđević") === normalizeText("Djordjevic"), "đ → dj normalization failed");
  console.assert(getPlayerSuggestions("xzy").length === 0, "Suggestions should be empty when there is no match");
  // Çok parçalı soyad eşleşmesi (van Persie, de Gea regresyonu)
  console.assert(answerNameMatchesInput("Robin van Persie", "van persie", ["Robin van Persie"]), "Multi-word surname 'van persie' should match");
  console.assert(answerNameMatchesInput("Robin van Persie", "vanpersie", ["Robin van Persie"]), "Joined surname 'vanpersie' should match");
  console.assert(answerNameMatchesInput("David de Gea", "de gea", ["David de Gea"]), "Multi-word surname 'de gea' should match");
  console.assert(answerNameMatchesInput("Robin van Persie", "persie", ["Robin van Persie"]), "Last word 'persie' should still match");
  console.assert(getPlayableTeamPairs().length > 0 && getPlayableTeamPairs().length <= Object.keys(ANSWER_INDEX).length, "Playable pairs subset of ANSWER_INDEX");
  console.assert(getPlayableTeamPairs().length > 0, "There should be playable team pairs");

  // Regresyon: 3 büyük Türk derbisi (FB-GS, FB-BJK, BJK-GS) kolay modda
  // pool'da OLMALIYDI — ama tek başına yetmez. Aynı ülke boost'u da çalışmalı
  // ki bu derbiler pratikte de gelsin (önceki davranışta %2.2 ihtimal vardı).
  const fbgs = WEIGHTED_TEAM_PAIRS.find((p) =>
    (p.teams.includes("Fenerbahçe") && p.teams.includes("Galatasaray"))
  );
  console.assert(fbgs, "FB-GS pair should exist in WEIGHTED_TEAM_PAIRS");
  if (fbgs) {
    console.assert(
      isPairInDifficulty(fbgs, "easy"),
      "FB-GS should be in easy difficulty"
    );
    console.assert(
      getPairWeight(fbgs, "hard") === 18,
      `FB-GS hard weight should be 18 (6 base × 3 same-country boost), got ${getPairWeight(fbgs, "hard")}`
    );
    // Medium ağırlığı da kontrol: 1-1 = 4 base × 3 same-country = 12
    console.assert(
      getPairWeight(fbgs, "medium") === 12,
      `FB-GS medium weight should be 12 (4 base × 3 same-country), got ${getPairWeight(fbgs, "medium")}`
    );
    console.assert(
      isSameCountryPair(fbgs),
      "FB-GS should be detected as same-country (Türkiye)"
    );
  }

  console.assert(WINNING_SCORE === 3, "Winning score should be 3");
}

// Self-tests sadece development modunda çalışır. Production'da:
// - Bundle'a girer ama çağrılmaz (tree-shake olmaz, callable kalır)
// - Console.assert mesajları kullanıcının console'unda görünmez
// - Açılış performansı etkilenmez
if (import.meta.env.DEV) {
  runSelfTests();
}

// =================== XSS-SAFE i18n RENDERER ===================
// Kullanıcı cevabını <strong> ile sarmak için. Eskiden dangerouslySetInnerHTML
// ile HTML string interpolation yapılıyordu — kullanıcı cevap kutusuna
// <img onerror=...> yazarsa XSS riski oluştururdu. JSX node döndürdüğümüz için
// React her metni otomatik escape eder, payload zararsızlaşır.
function renderWithBoldAnswer(translatedText, userAnswer) {
  if (!userAnswer) return translatedText;
  // Önce "tırnaklı" eşleşme dene: '..."Beckham"...'
  const quoted = `"${userAnswer}"`;
  let idx = translatedText.indexOf(quoted);
  if (idx >= 0) {
    return (
      <>
        {translatedText.slice(0, idx)}
        {'"'}<strong>{userAnswer}</strong>{'"'}
        {translatedText.slice(idx + quoted.length)}
      </>
    );
  }
  // Tırnaksız eşleşme dene
  idx = translatedText.indexOf(userAnswer);
  if (idx >= 0) {
    return (
      <>
        {translatedText.slice(0, idx)}
        <strong>{userAnswer}</strong>
        {translatedText.slice(idx + userAnswer.length)}
      </>
    );
  }
  // i18n template yapısı değiştiyse en azından raw text'i göster
  return translatedText;
}

// =================== LİG FİLTRESİ UI ===================
// Çoklu seçim chip grid'i + "tümü" toggle. Boş seçim = tüm ligler.
// Maraton, Düello (create), Arena (host) setup ekranlarında kullanılır.
function LeagueFilter({ selectedLeagues, onChange, disabled = false, compact = false }) {
  const allSelected = !selectedLeagues || selectedLeagues.length === 0;

  const toggleLeague = (leagueName) => {
    if (disabled) return;
    const current = selectedLeagues || [];
    if (current.includes(leagueName)) {
      onChange(current.filter((l) => l !== leagueName));
    } else {
      onChange([...current, leagueName]);
    }
  };

  // Seçili filtre ile kaç oynanabilir eşleşme var?
  const allowedTeams = buildAllowedTeams(selectedLeagues);
  const matchCount = allowedTeams
    ? WEIGHTED_TEAM_PAIRS.filter((p) => pairAllowed(p, allowedTeams)).length
    : WEIGHTED_TEAM_PAIRS.length;

  // Çok az eşleşme varsa uyarı
  const tooFew = !allSelected && matchCount < 10;

  return (
    <div className={`league-filter ${compact ? "compact" : ""}`}>
      <div className="league-filter-header">
        <span className="league-filter-label">{t("league_filter_label")}</span>
        <span className={`league-filter-count ${tooFew ? "warn" : ""}`}>
          {allSelected ? t("league_filter_all") : t("league_filter_n_selected", { n: selectedLeagues.length })} · {t("league_filter_n_pairs", { n: matchCount })}
        </span>
      </div>
      <div className="league-filter-chips">
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={disabled}
          className={`league-chip all-chip ${allSelected ? "active" : ""}`}
        >
          {t("league_filter_btn_all")}
        </button>
        {LEAGUES.map((lg) => {
          const active = !allSelected && selectedLeagues.includes(lg.name);
          return (
            <button
              key={lg.name}
              type="button"
              onClick={() => toggleLeague(lg.name)}
              disabled={disabled}
              className={`league-chip ${active ? "active" : ""}`}
              title={`${lg.country} · ${lg.teamCount} takım`}
            >
              {lg.flag && <span className="league-chip-flag">{lg.flag}</span>}
              <span className="league-chip-name">{lg.name}</span>
              <span className="league-chip-count">{lg.teamCount}</span>
            </button>
          );
        })}
      </div>
      {tooFew && (
        <small className="league-filter-warn">
          {t("league_filter_too_few_warning")}
        </small>
      )}
    </div>
  );
}

function StatusMessage({ message }) {
  if (!message) return null;

  const iconByType = {
    success: "✓",
    error: "!",
    info: "i"
  };

  return (
    <div className={`status-message status-${message.type}`} role="status">
      <span className="status-icon" aria-hidden="true">{iconByType[message.type] || "i"}</span>
      <span className="status-text">{message.text}</span>
    </div>
  );
}


function clubHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return Math.abs(h); }
function clubAutoText(hex) {
  if (typeof hex !== "string" || hex[0] !== "#") return "#ffffff";
  let h = hex.slice(1); if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.62 ? "#15172c" : "#ffffff";
}
function clubAutoAbbr(name) {
  const w = String(name).replace(/[^A-Za-zÇĞİÖŞÜçğıöşü\s]/g, "").trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return w.slice(0, 3).map((x) => x[0]).join("").toLocaleUpperCase("tr");
  return String(name).slice(0, 3).toLocaleUpperCase("tr");
}
function clubStyle(teamName) {
  const d = TEAM_LOGOS[teamName];
  if (d && d.primary) return { c1: d.primary, c2: d.secondary || "#ffffff", abbr: d.initials || clubAutoAbbr(teamName), text: clubAutoText(d.primary) };
  const hue = clubHash(teamName) % 360;
  return { c1: `hsl(${hue} 52% 36%)`, c2: `hsl(${hue} 68% 72%)`, abbr: clubAutoAbbr(teamName), text: "#ffffff" };
}

function TeamLogo({ teamName, size = "md" }) {
  const { c1, c2, abbr, text } = clubStyle(teamName);
  return (
    <div
      className={`team-logo size-${size}`}
      style={{ "--team-primary": c1, "--team-secondary": c2, "--team-text": text }}
      aria-label={teamName}
    >
      <span className="team-logo__bar" aria-hidden="true"></span>
      <span className="team-logo__abbr">{abbr}</span>
    </div>
  );
}

function CircularTimer({ value, max, urgent }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <div className={`circ-timer ${urgent ? "urgent" : ""}`}>
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r={radius} className="circ-track" />
        <circle
          cx="44"
          cy="44"
          r={radius}
          className="circ-progress"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="circ-content">
        <strong>{value}</strong>
        <em>{t("timer_seconds")}</em>
      </div>
    </div>
  );
}

function AcceptedPlayersBox({ title, players, actualAnswer, onReportPlayer }) {
  const resolvedTitle = title || t("accepted_players");
  if (!players?.length) return null;

  const normalizedActual = normalizeText(actualAnswer);
  const otherPlayers = players.filter((player) => normalizeText(player.name) !== normalizedActual);
  const visiblePlayers = otherPlayers.length ? otherPlayers : players;

  return (
    <div className="answers-box">
      <strong>{resolvedTitle}</strong>
      <div className="answer-tags">
        {visiblePlayers.slice(0, 12).map((player) => (
          <button key={player.name} type="button" onClick={() => onReportPlayer?.(player)} title={t("report_player_tooltip")}>
            {player.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function WrongExplanationCard({ report, onReport }) {
  if (!report) return null;

  return (
    <div className="wrong-explanation-card">
      <div className="wrong-icon" aria-hidden="true">!</div>
      <div className="wrong-content">
        <strong>{t("wrong_check_title")}</strong>
        <p>{report.feedback}</p>
        <button type="button" className="light-button compact" onClick={onReport}>
          {t("wrong_should_be_correct_btn")}
        </button>
      </div>
    </div>
  );
}

// Paylaşım canvas yardımcıları (drawScoreShareCard, shareScoreImage, drawDailyShareCard,
// ve dahili drawBrandMark/drawWordmarkLockup/drawGlassCTA/roundRectPath) ./utils/canvas.js
// modülüne taşındı. ~240 satır azalma, hala aynı görseli üretir.

function OnboardingOverlay({ onClose }) {
  const chip = { padding: "8px 14px", borderRadius: 12, background: "rgba(255,255,255,0.08)", fontWeight: 700, fontSize: 14 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(8,8,16,0.82)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420, background: "linear-gradient(160deg,#1d1430,#241a3e)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 24, padding: "26px 22px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", color: "#fff" }}>
        <div style={{ fontSize: 40, marginBottom: 6 }}>⚽</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>{t("onboard_title")}</h2>
        <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.5, color: "rgba(255,255,255,0.7)" }} dangerouslySetInnerHTML={{ __html: t("onboard_intro_html").replace('<strong>', '<strong style="color:#fff">') }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 }}>
          <span style={chip}>Chelsea</span>
          <span style={{ fontSize: 13, color: "#ffae00", fontWeight: 800 }}>VS</span>
          <span style={chip}>Real Madrid</span>
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>
          ✅ <strong>Eden Hazard</strong> <span style={{ color: "rgba(255,255,255,0.55)" }}>{t("onboard_played_both")}</span>
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 18 }}>
          {t("onboard_flex")}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginBottom: 20 }}>
          <span>{t("onboard_mode_daily")}</span>
          <span>·</span>
          <span>{t("onboard_mode_marathon")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ width: "100%", padding: 14, borderRadius: 14, border: "none", background: "#aa3bff", color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer" }}
        >
          {t("onboard_btn")}
        </button>
        <div style={{ marginTop: 14, paddingTop: 14, textAlign: "center", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: 0.3 }}>
          <a href="/about.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_about")}</a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_privacy")}</a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_terms")}</a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a href="/how-to-play.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_how")}</a>
        </div>
      </div>
    </div>
  );
}

function ChallengeGameOver({
  score, best, isNewBest, lastWrongAnswer, correctPlayers,
  teamA, teamB, wrongReport, reportStatus,
  onSubmitWrongReport, onReportAcceptedPlayer, onRestart,
  onSaveScore, scoreSaved, playerName, onPlayerNameChange, difficulty, onShare, nearMiss
}) {
  const showWrongReport = wrongReport && lastWrongAnswer;
  const playerCount = correctPlayers?.length || 0;
  const diffLabel = difficulty === "easy" ? t("diff_easy") : difficulty === "hard" ? t("diff_hard") : t("diff_medium");

  return (
    <div className="challenge-gameover">
      <div className="gameover-header">
        <div className={`gameover-icon ${isNewBest ? "trophy" : ""}`}>
          {isNewBest ? "🏆" : "🎯"}
        </div>
        <div className="gameover-headline">
          <h3>{isNewBest ? t("gover_new_record") : t("gover_streak_over")}</h3>
          {lastWrongAnswer && (
            <p className="gameover-detail">
              {renderWithBoldAnswer(t("gover_not_in_pair", { answer: lastWrongAnswer }), lastWrongAnswer)}
            </p>
          )}
        </div>
      </div>

      <div className="gameover-stats">
        <div className="gameover-stat">
          <span>{t("gover_this_streak")}</span>
          <strong>{score}</strong>
        </div>
        <div className={`gameover-stat ${isNewBest ? "highlight" : ""}`}>
          <span>{isNewBest ? t("gover_new_best") : t("info_best")}</span>
          <strong>{best}</strong>
        </div>
      </div>

      {nearMiss && (
        <div
          className="gameover-nearmiss"
          style={{
            margin: "2px 0 14px",
            padding: "11px 16px",
            borderRadius: "14px",
            fontWeight: 600,
            fontSize: "15px",
            lineHeight: 1.35,
            background:
              nearMiss.tone === "record"
                ? "rgba(255,216,77,0.18)"
                : nearMiss.tone === "close"
                ? "rgba(255,107,53,0.16)"
                : nearMiss.tone === "today"
                ? "rgba(46,204,113,0.15)"
                : "rgba(255,255,255,0.06)",
            color: nearMiss.tone === "record" ? "#ffd84d" : "inherit",
            border: "1px solid rgba(255,255,255,0.12)"
          }}
        >
          {nearMiss.text}
        </div>
      )}

      {/* Skor kaydetme */}
      {score >= 1 && (
        <div className="gameover-section score-save-section">
          {!scoreSaved ? (
            <>
              <input
                type="text"
                className="score-name-input"
                placeholder={t("gover_name_placeholder")}
                value={playerName}
                onChange={(e) => onPlayerNameChange(e.target.value)}
                maxLength={30}
              />
              <button type="button" onClick={onSaveScore} className="primary-button save-score-btn">
                {t("gover_save_score")}
              </button>
            </>
          ) : (
            <div className="score-saved-msg">{t("gover_score_saved")}</div>
          )}
        </div>
      )}

      {/* Paylaş */}
      {score >= 1 && (
        <button type="button" onClick={onShare} className="light-button big share-score-btn">
          {t("gover_share_story")}
        </button>
      )}

      {playerCount > 0 && (
        <div className="gameover-section">
          <span className="gameover-label">
            {t("gover_correct_answers")} <span className="answers-count">({playerCount})</span>
          </span>
          <div className="gameover-players scrollable">
            {correctPlayers.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => onReportAcceptedPlayer?.(p)}
                title={t("gover_wrong_click_report")}
                className="gameover-player-chip"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showWrongReport && (
        <button
          type="button"
          className="gameover-report-button"
          onClick={onSubmitWrongReport}
        >
          <span className="gameover-report-label">
            <span className="gameover-report-icon" aria-hidden="true">❗</span>
            <span className="gameover-report-text">
              <span>
                {renderWithBoldAnswer(t("gover_should_be_correct", { answer: lastWrongAnswer }), lastWrongAnswer)}
              </span>
            </span>
          </span>
          <span className="gameover-report-cta">{t("gover_report")}</span>
        </button>
      )}

      <StatusMessage message={reportStatus} />

      <button
        type="button"
        onClick={onRestart}
        className="primary-button big gameover-restart"
      >
        {t("gover_new_marathon")}
      </button>
    </div>
  );
}

function MatchSummary({ playerNames, scores, winner, targetScore, seriesWins, currentCorrectRounds = [] }) {
  if (winner === null || winner === undefined) return null;

  return (
    <div className="match-summary-card">
      <div className="summary-grid">
        <div>
          <span>{t("ms_winner")}</span>
          <strong>{playerNames[winner]}</strong>
        </div>
        <div>
          <span>{t("ms_score")}</span>
          <strong>{scores[0]} - {scores[1]}</strong>
        </div>
        <div>
          <span>{t("ms_target")}</span>
          <strong>{targetScore}</strong>
        </div>
        <div>
          <span>{t("ms_series")}</span>
          <strong>{seriesWins[0]} - {seriesWins[1]}</strong>
        </div>
      </div>

      {currentCorrectRounds.length > 0 && (
        <div className="correct-rounds-summary">
          <strong>{t("gover_correct_answers")} <span className="answers-count">({currentCorrectRounds.length})</span></strong>
          <div className="correct-rounds-list scrollable">
            {currentCorrectRounds.map((item, index) => (
              <div className="correct-round-item" key={`${item.teamA}-${item.teamB}-${item.answer}-${index}`}>
                <span className="round-pair">{item.teamA} × {item.teamB}</span>
                <span className="round-answer">{item.answer}</span>
                <span className="round-player">{item.playerName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =================== SES SİSTEMİ ===================
// HTML5 Audio kullanıyor — iOS Safari Web Audio API'yi engellediği için.
// Tüm sesler inline base64 (sounds.js içinde), dosya yükleme yok.

const _audioPool = {};

function initAudioPool() {
  if (typeof window === "undefined") return;
  Object.keys(SOUND_FILES).forEach((name) => {
    if (_audioPool[name]) return;
    try {
      const audio = new Audio(SOUND_FILES[name]);
      audio.preload = "auto";
      audio.volume = 0.55;
      _audioPool[name] = audio;
    } catch (e) {
      logSwallowed("audio_pool_init", e, { sound: name });
    }
  });
}

let _audioUnlocked = false;
function unlockAudio() {
  if (_audioUnlocked) return;
  initAudioPool();
  // iOS unlock — her audio'yu user gesture içinde bir kez "uyandır"
  Object.values(_audioPool).forEach((audio) => {
    try {
      const muted = audio.muted;
      audio.muted = true;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = muted;
          })
          .catch(() => {
            audio.muted = muted;
          });
      }
    } catch {}
  });
  _audioUnlocked = true;
}

// İlk user interaction'da audio'yu unlock et
if (typeof window !== "undefined") {
  const events = ["touchstart", "touchend", "click", "keydown", "pointerdown"];
  const onFirst = () => {
    unlockAudio();
    events.forEach((e) => window.removeEventListener(e, onFirst));
  };
  events.forEach((e) => window.addEventListener(e, onFirst, { passive: true }));
}

function playGameSound(soundName) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem("footballGameMuted") === "true") return;

  // Çeşitli oyun seslerini dosya isimlerine eşle
  const soundMap = {
    ownGoal: "correct",
    opponentGoal: "wrong",
    wrong: "wrong",
    matchEnd: "matchEnd",
    countdown: "countdown",
    tap: "countdown",
    combo: "combo",
    urgentTick: "urgentTick"
  };

  const fileKey = soundMap[soundName] || soundName;
  initAudioPool();
  const audio = _audioPool[fileKey];
  if (!audio) return;

  try {
    // Aynı sesi tekrar çalmadan önce başa sar
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch {}
}

export default function App() {
  const [lang, setLang] = useLang();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef(null);

  // Dropdown dışına tıklayınca kapat
  useEffect(() => {
    if (!langMenuOpen) return;
    const onDocClick = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, [langMenuOpen]);

  // Klavye-farkında viewport yüksekliğini CSS değişkenine yaz.
  // window.visualViewport klavye açıldığında otomatik küçülen "görünen alan"
  // değerini verir — autocomplete dropdown'ın max-height'ı bunu kullanarak
  // klavyenin tam üstünde duracak şekilde ayarlanır.
  // Modern tarayıcılarda destekli (iOS Safari 13+, Chrome 61+, Android WebView).
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const update = () => {
      const h = window.visualViewport.height;
      document.documentElement.style.setProperty("--vv-height", `${h}px`);
    };
    update();
    window.visualViewport.addEventListener("resize", update);
    window.visualViewport.addEventListener("scroll", update);
    return () => {
      window.visualViewport.removeEventListener("resize", update);
      window.visualViewport.removeEventListener("scroll", update);
    };
  }, []);

  // ============ ROUTE: /admin ============
  // Watch URL pathname and render AdminPanel for /admin
  // This is a lightweight router — no react-router dependency
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Analytics init (admin paneli için tracking yapmıyor — kendi check'i var)
  useEffect(() => {
    initAnalytics();
  }, []);

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return <AdminPanel />;
  }
  // ========================================

  // clientId'yi localStorage'da tut: refresh sonrası aynı slot'a dönebilmek için
  const clientIdRef = useRef(null);
  if (!clientIdRef.current) {
    let cid = null;
    try { cid = window.localStorage.getItem("pairfc_client_id"); } catch (e) {}
    if (!cid) {
      cid = makeClientId();
      try { window.localStorage.setItem("pairfc_client_id", cid); } catch (e) {}
    }
    clientIdRef.current = cid;
  }
  const channelRef = useRef(null);
  const stateRef = useRef(null);
  // Düello modu: hangi clientId 2. slot'u (rakip slotu) tutuyor. Aynı odaya
  // 3. kişi gelirse reddedilir; aksi halde 2 kişiden fazla oyuncu aynı kodla
  // girebiliyor ve hepsi aynı slot'tan cevap verebiliyordu.
  const opponentClientIdRef = useRef(null);

  const [screen, setScreen] = useState("home");
  const [mainTab, setMainTab] = useState("home"); // "home" | "leaderboard"
  const [lbPlayerName, setLbPlayerName] = useState(() => localStorage.getItem("pairfc_player_name") || "");
  const [lbData, setLbData] = useState([]);
  const [lbDifficulty, setLbDifficulty] = useState("medium");
  const [lbPeriod, setLbPeriod] = useState("today");
  const [lbLoading, setLbLoading] = useState(false);
  const [scoreSaved, setScoreSaved] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => window.localStorage.getItem("footballGameMuted") !== "true");
  const [connectionStatus, setConnectionStatus] = useState("offline");
  const [playerName, setPlayerName] = useState("Oyuncu");
  const [roomInput, setRoomInput] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [playerIndex, setPlayerIndex] = useState(null);

  // PostHog identify: clientId her zaman set edilir, nickname/lang değişince güncellenir.
  // Cross-device tracking yok — aynı clientId aynı browser/cihaz demek.
  useEffect(() => {
    if (!clientIdRef.current) return;
    identify(clientIdRef.current, {
      lang,
      nickname: lbPlayerName || null,
      sound_enabled: soundEnabled
    });
  }, [lang, lbPlayerName, soundEnabled]);

  const [targetScore, setTargetScore] = useState(3);
  const [playerNames, setPlayerNames] = useState([t("default_player_1"), t("default_player_2")]);
  const [playersReady, setPlayersReady] = useState([false, false]);
  const [opponentJoined, setOpponentJoined] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);

  const [scores, setScores] = useState([0, 0]);
  const [scoreFlash, setScoreFlash] = useState([null, null]);
  const prevScoresRef = useRef([0, 0]);
  const [round, setRound] = useState(() => getRandomRound());
  const [usedRoundKeys, setUsedRoundKeys] = useState([]);
  const [answerInput, setAnswerInput] = useState("");
  const [focusedInput, setFocusedInput] = useState(false);
  const [message, setMessage] = useState(null);
  const [winner, setWinner] = useState(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [roundLocked, setRoundLocked] = useState(false);
  const [roundEndsAt, setRoundEndsAt] = useState(null);
  const [preRoundEndsAt, setPreRoundEndsAt] = useState(null);
  // =================== DIFFICULTY ===================
  // "easy" | "medium" | "hard"
  const [challengeDifficulty, setChallengeDifficulty] = useState(() => {
    try { return window.localStorage.getItem("pairfc_difficulty_challenge") || "medium"; }
    catch { return "medium"; }
  });
  const [challengeEffectiveDifficulty, setChallengeEffectiveDifficulty] = useState("medium");
  const [onlineDifficulty, setOnlineDifficulty] = useState("medium");
  // Düello eşleşme tipi: "difficulty" = zorluk seç (lig filtresi yok),
  // "custom" = özel mod (lig filtresi var, zorluk uygulanmaz).
  // localStorage'da persist; STATE_SYNC ile guest'e taşınır.
  const [onlineMatchMode, setOnlineMatchMode] = useState(() => {
    try { return window.localStorage.getItem("pairfc_online_match_mode") || "difficulty"; }
    catch (e) { return "difficulty"; }
  });
  const persistOnlineMatchMode = (mode) => {
    setOnlineMatchMode(mode);
    try { window.localStorage.setItem("pairfc_online_match_mode", mode); } catch (e) {}
  };

  // Lig filtresi: boş array = tüm ligler. localStorage'da persist.
  // Düello'da host'unkini guest'e STATE_SYNC ile gönderiyoruz; guest tarafında
  // ekrandan çıkınca kendi kayıtlı tercihine dönülüyor.
  const [selectedLeagues, setSelectedLeagues] = useState(() => {
    try {
      const stored = window.localStorage.getItem("pairfc_selected_leagues");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });
  const persistLeagues = (leagues) => {
    setSelectedLeagues(leagues);
    try { window.localStorage.setItem("pairfc_selected_leagues", JSON.stringify(leagues)); } catch (e) {}
  };
  // Allowed teams Set'i — pair seçim helper'larına geçilir
  const allowedTeamsSet = useMemo(() => buildAllowedTeams(selectedLeagues), [selectedLeagues]);
  // Düello için mode-aware allowed teams: "difficulty" mod'da filtre yok,
  // "custom" mod'da kayıtlı liglere göre filtre.
  const effectiveOnlineAllowedTeams = useMemo(
    () => (onlineMatchMode === "custom" ? allowedTeamsSet : null),
    [onlineMatchMode, allowedTeamsSet]
  );
  // Düello için mode-aware difficulty: "custom" mod'da zorluk filtresi yok
  // (= "hard" → isPairInDifficulty her zaman true). "difficulty" mod'da seçilen zorluk.
  // Maraton'daki confirmStartChallenge davranışıyla bire bir aynı.
  const effectiveOnlineDifficulty = useMemo(
    () => (onlineMatchMode === "custom" ? "hard" : onlineDifficulty),
    [onlineMatchMode, onlineDifficulty]
  );
  const [duelVariant, setDuelVariant] = useState(null); // null | "auto" | "strategic"
  const [teamSelectEndsAt, setTeamSelectEndsAt] = useState(null);
  const [teamPicks, setTeamPicks] = useState([null, null]);
  const [teamSelectLeft, setTeamSelectLeft] = useState(TEAM_SELECT_SECONDS);
  const [teamSearch, setTeamSearch] = useState("");
  const [showChallengeStartScreen, setShowChallengeStartScreen] = useState(false);
  // Maraton mod seçimi: null = picker ekranı, "difficulty" = zorluk seç,
  // "custom" = özel mod (lig filtresi). null'a dönmek picker'ı tekrar gösterir.
  const [challengeMode, setChallengeMode] = useState(null);
  const [showOnlineSetup, setShowOnlineSetup] = useState(false);
  const [onlineSetupMode, setOnlineSetupMode] = useState(null); // null | "create" | "join"

  // Splash screen — her açılışta 2.2sn gösterilir
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (!showSplash) return;
    const t = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(t);
  }, [showSplash]);

  // PWA Install
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(display-mode: standalone)").matches ||
           window.navigator.standalone === true;
  });

  // Push bildirimleri
  const [pushState, setPushState] = useState(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission; // default | granted | denied
  });
  const [pushBannerDismissed, setPushBannerDismissed] = useState(() => {
    try { return localStorage.getItem("pairfc_push_dismissed") === "1"; } catch (e) { return false; }
  });
  const [pushOn, setPushOn] = useState(() => {
    try { return localStorage.getItem("pairfc_push_on") === "1"; } catch (e) { return false; }
  });

  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const goOnline = () => {
      setIsOffline(false);
      track("online_restored");
    };
    const goOffline = () => {
      setIsOffline(true);
      track("offline_detected", { screen });
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [screen]);

  const enableNotifications = async () => {
    // iOS Safari'de push SADECE ana ekrana eklenmiş (standalone) modda çalışır
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (isIOS && !isInstalled) {
      setShowInstallModal(true);
      return;
    }

    const result = await subscribeToPush();
    if (!result.ok) {
      if (result.reason === "denied") {
        setPushState("denied");
        alert(t("notify_denied_hint"));
        try { track("push_denied"); } catch (e) {}
      }
      return;
    }
    if (!supabase) return;

    // ON CONFLICT DO NOTHING (ignoreDuplicates) — sadece INSERT policy gerektirir.
    const { error: upErr } = await supabase.from("push_subscriptions").upsert({
      endpoint: result.subscription.endpoint,
      p256dh: result.subscription.p256dh,
      auth: result.subscription.auth,
      lang: lang,
      user_agent: (navigator.userAgent || "").slice(0, 200),
      last_seen: new Date().toISOString(),
    }, { onConflict: "endpoint", ignoreDuplicates: true });

    if (upErr) {
      console.warn("[push] subscription save failed:", upErr);
      return;
    }
    setPushState("granted");
    setPushOn(true);
    try { localStorage.setItem("pairfc_push_on", "1"); } catch (e) {}
    try { track("push_enabled", { lang }); } catch (e) {}
  };

  const disableNotifications = async () => {
    // Tarayıcı aboneliğini iptal et. Supabase'deki kayıt, gönderici script bir
    // sonraki denemede 410 alınca otomatik silinir (DELETE policy gerekmez).
    try { await unsubscribeFromPush(); } catch (e) {}
    setPushOn(false);
    try { localStorage.setItem("pairfc_push_on", "0"); } catch (e) {}
    try { track("push_disabled"); } catch (e) {}
  };

  const toggleNotifications = () => {
    if (pushOn) disableNotifications();
    else enableNotifications();
  };

  const dismissPushBanner = () => {
    setPushBannerDismissed(true);
    try { localStorage.setItem("pairfc_push_dismissed", "1"); } catch (e) {}
  };

  // Otomatik onarım: izin verilmiş VE kullanıcı kapatmamışsa, aboneliğin
  // Supabase'e kayıtlı olduğundan emin ol. (Kullanıcı kapatmışsa otomatik açma.)
  useEffect(() => {
    if (!isPushSupported() || !supabase) return;
    if (Notification.permission !== "granted") return;
    let userTurnedOff = false;
    try { userTurnedOff = localStorage.getItem("pairfc_push_on") === "0"; } catch (e) {}
    if (userTurnedOff) return;
    (async () => {
      const result = await subscribeToPush();
      if (!result.ok || !result.subscription) return;
      const { error } = await supabase.from("push_subscriptions").upsert({
        endpoint: result.subscription.endpoint,
        p256dh: result.subscription.p256dh,
        auth: result.subscription.auth,
        lang: lang,
        user_agent: (navigator.userAgent || "").slice(0, 200),
        last_seen: new Date().toISOString(),
      }, { onConflict: "endpoint", ignoreDuplicates: true });
      if (error) {
        console.warn("[push] auto-heal save failed:", error);
      } else {
        setPushState("granted");
        setPushOn(true);
        try { localStorage.setItem("pairfc_push_on", "1"); } catch (e) {}
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    const installed = () => setIsInstalled(true);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const triggerInstall = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      track("pwa_install_attempted", { outcome });
      if (outcome === "accepted") setIsInstalled(true);
      setDeferredInstallPrompt(null);
      setShowInstallModal(false);
    } else {
      // iOS Safari veya destek yoksa modal göster
      setShowInstallModal(true);
    }
  };

  // Değer-anı install nudge'ı (günlük bitince) — kapatınca 4 gün soğur
  const [showInstallNudge, setShowInstallNudge] = useState(() => {
    try {
      const last = Number(window.localStorage.getItem("pairfc_install_nudge") || 0);
      return Date.now() - last > 4 * 24 * 60 * 60 * 1000;
    } catch (e) { return true; }
  });
  const dismissInstallNudge = () => {
    try { window.localStorage.setItem("pairfc_install_nudge", String(Date.now())); } catch (e) {}
    try { track("install_nudge_dismissed"); } catch (e) {}
    setShowInstallNudge(false);
  };

  useEffect(() => {
    try { window.localStorage.setItem("pairfc_difficulty_challenge", challengeDifficulty); }
    catch {}
  }, [challengeDifficulty]);

  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [preRoundLeft, setPreRoundLeft] = useState(ROUND_REVEAL_SECONDS);
  const [wrongAttempts, setWrongAttempts] = useState([0, 0]);
  const [lastAction, setLastAction] = useState(null);
  const [lastWrongReport, setLastWrongReport] = useState(null);
  const [reportStatus, setReportStatus] = useState(null);
  const [seriesWins, setSeriesWins] = useState([0, 0]);
  const [matchHistory, setMatchHistory] = useState([]);
  const [correctRounds, setCorrectRounds] = useState([]);

  const [challengeScore, setChallengeScore] = useState(0);
  const [challengeBest, setChallengeBest] = useState(() => {
    const stored = window.localStorage.getItem("footballChallengeBest");
    return stored ? Number(stored) || 0 : 0;
  });
  const [challengeBestByDiff, setChallengeBestByDiff] = useState(() => {
    try {
      const s = window.localStorage.getItem("pairfc_best_by_diff");
      const o = s ? JSON.parse(s) : null;
      return o && typeof o === "object" ? { easy: 0, medium: 0, hard: 0, ...o } : { easy: 0, medium: 0, hard: 0 };
    } catch (e) { return { easy: 0, medium: 0, hard: 0 }; }
  });
  const [challengeDailyBest, setChallengeDailyBest] = useState(() => {
    try {
      const s = window.localStorage.getItem("pairfc_daily_best");
      const o = s ? JSON.parse(s) : null;
      return o && typeof o === "object" ? { date: "", easy: 0, medium: 0, hard: 0, ...o } : { date: "", easy: 0, medium: 0, hard: 0 };
    } catch (e) { return { date: "", easy: 0, medium: 0, hard: 0 }; }
  });
  const [challengeNearMiss, setChallengeNearMiss] = useState(null);
  const [challengeLastScore, setChallengeLastScore] = useState(null);
  const [challengeRound, setChallengeRound] = useState(() => getRandomRound([]));
  const [challengeUsedRoundKeys, setChallengeUsedRoundKeys] = useState([]);
  const [challengeInput, setChallengeInput] = useState("");
  const [challengeFocused, setChallengeFocused] = useState(false);
  const [challengeMessage, setChallengeMessage] = useState(null);
  const [challengeRoundLocked, setChallengeRoundLocked] = useState(false);
  const [challengeShowAnswers, setChallengeShowAnswers] = useState(false);
  const [challengeRoundEndsAt, setChallengeRoundEndsAt] = useState(null);
  const [challengePreRoundEndsAt, setChallengePreRoundEndsAt] = useState(null);
  const [challengeTimeLeft, setChallengeTimeLeft] = useState(ROUND_SECONDS);
  const [challengePreRoundLeft, setChallengePreRoundLeft] = useState(ROUND_REVEAL_SECONDS);
  const [challengeLastAction, setChallengeLastAction] = useState(null);
  const [challengeLastWrongReport, setChallengeLastWrongReport] = useState(null);
  const [challengeReportStatus, setChallengeReportStatus] = useState(null);
  const [challengeFirstLetterUsed, setChallengeFirstLetterUsed] = useState(false);
  const [challengeSwapUsed, setChallengeSwapUsed] = useState(false);
  const [challengeTimeAddUsed, setChallengeTimeAddUsed] = useState(false);
  const [challengeJokerHint, setChallengeJokerHint] = useState(null);
  const [challengeFeedback, setChallengeFeedback] = useState(null); // "correct" | "wrong" | null
  const [comboBurst, setComboBurst] = useState(null); // { tier, label, key }
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !window.localStorage.getItem("pairfc_onboarded"); } catch (e) { return false; }
  });
  const dismissOnboarding = () => {
    try { window.localStorage.setItem("pairfc_onboarded", "1"); } catch (e) {}
    setShowOnboarding(false);
    try { track("onboarding_done"); } catch (e) {}
  };

  // =================== DAILY PUZZLE STATE ===================
  const [dailyHistory, setDailyHistory] = useState(() => {
    try {
      const stored = window.localStorage.getItem("pairfc_daily_history");
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });
  const dailyStreak = useMemo(() => calculateStreak(dailyHistory), [dailyHistory]);

  const [dailyData, setDailyData] = useState(null); // { date, puzzles: [{teams, key}] }
  const [dailyIndex, setDailyIndex] = useState(0);
  const [dailyWrongCount, setDailyWrongCount] = useState(0);
  const [dailyResults, setDailyResults] = useState([]); // ["correct"|"failed", ...]
  const [dailyInput, setDailyInput] = useState("");
  const [dailyFocused, setDailyFocused] = useState(false);
  const [dailyMessage, setDailyMessage] = useState(null);
  const [dailyDone, setDailyDone] = useState(false);
  const [dailyAcceptedThisRound, setDailyAcceptedThisRound] = useState([]);
  const [dailyShowAnswers, setDailyShowAnswers] = useState(false);
  const [dailyFeedback, setDailyFeedback] = useState(null);
  const [dailyCountdown, setDailyCountdown] = useState(""); // "5sa 23dk" gibi

  // Ana sayfa Hero için: bugün daily çözüldü mü?
  const dailyDoneToday = useMemo(() => {
    const today = getTodayKey();
    const entry = dailyHistory[today];
    return entry && (entry.done || entry.completed || entry.correct >= 5 || entry.finished);
  }, [dailyHistory]);

  // Ana sayfa "featured hero" — Daily HER ZAMAN kahraman ("günün olayı")
  const heroConfig = useMemo(() => {
    const today = getTodayKey();
    const entry = dailyHistory[today];
    const attempts = (entry && entry.attempts) || [];
    const total = (dailyData && dailyData.puzzles.length) || 5;
    const correctCount = attempts.filter((a) => a === "correct").length;
    const isNewUser = challengeBest === 0 && dailyStreak === 0 && !dailyDoneToday;

    if (dailyDoneToday) {
      return {
        done: true,
        attempts,
        eyebrow: t("hero_done_eyebrow"),
        title: correctCount === total ? t("hero_done_title_perfect") : t("hero_done_title_score", { n: correctCount, total }),
        sub: dailyCountdown ? t("hero_done_sub_countdown", { time: dailyCountdown }) : t("hero_done_sub_tomorrow"),
        cta: t("hero_done_cta")
      };
    }
    return {
      done: false,
      attempts: [],
      eyebrow: isNewUser ? t("hero_eyebrow_new") : t("hero_eyebrow_today"),
      title: isNewUser ? t("hero_title_new") : t("hero_title_today"),
      sub: t("hero_sub"),
      cta: isNewUser ? t("hero_cta_new") : t("hero_cta_today")
    };
  }, [dailyDoneToday, dailyHistory, dailyData, dailyStreak, challengeBest, dailyCountdown, lang]);

  // Daily kimlik bilgisi: tarih + günlük numara
  const dailyMeta = useMemo(() => {
    const d = dailyData ? new Date(dailyData.date) : new Date();
    const epoch = new Date("2026-01-01T00:00:00Z").getTime();
    const localeTag = LOCALE_TAGS[lang] || "tr-TR";
    return {
      date: new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "long" }).format(d),
      num: Math.floor((d.getTime() - epoch) / 86400000) + 1
    };
  }, [dailyData, lang]);

  const secondaryModes = useMemo(() => ["online", "arena"], []);

  // Challenge (Maraton) hero — yeni ana kahraman
  const challengeHero = useMemo(() => {
    const isNewUser = challengeBest === 0 && dailyStreak === 0 && !dailyDoneToday;
    return {
      eyebrow: isNewUser ? t("challenge_hero_eyebrow_new") : t("challenge_hero_eyebrow"),
      title: isNewUser ? t("challenge_hero_title_new") : t("challenge_hero_title"),
      sub: challengeBest > 0
        ? t("challenge_hero_sub_best", { n: challengeBest })
        : t("challenge_hero_sub"),
      cta: isNewUser ? t("challenge_hero_cta_new") : t("challenge_hero_cta")
    };
  }, [challengeBest, dailyStreak, dailyDoneToday, lang]);

  // Leaderboard verisini yükle
  useEffect(() => {
    if (mainTab !== "leaderboard") return;
    let cancelled = false;
    setLbLoading(true);
    fetchLeaderboard(lbDifficulty, lbPeriod).then((data) => {
      if (!cancelled) { setLbData(data); setLbLoading(false); }
    });
    return () => { cancelled = true; };
  }, [mainTab, lbDifficulty, lbPeriod]);

  // Challenge skoru kaydet
  const handleSaveScore = async () => {
    if (scoreSaved) return;
    const name = lbPlayerName.trim() || "Anonim";
    const finalScore = challengeLastScore ?? challengeScore ?? 0;
    localStorage.setItem("pairfc_player_name", name);
    setScoreSaved(true);
    await saveScore(name, finalScore, challengeDifficulty);
    // Leaderboard filtresi kaydedilen zorlukla senkronize et
    setLbDifficulty(challengeDifficulty);
    // Leaderboard'ı yenile
    fetchLeaderboard(challengeDifficulty, lbPeriod).then(setLbData);
  };

  // Ana sayfaya dönüşte scoreSaved reset
  const goHome = () => {
    setScreen("home");
    setScoreSaved(false);
    setMainTab("home");
  };

  const suggestions = useMemo(() => getPlayerSuggestions(answerInput), [answerInput]);
  const correctPlayers = useMemo(() => getCorrectPlayersForRound(round), [round]);
  const challengeSuggestions = useMemo(() => getPlayerSuggestions(challengeInput), [challengeInput]);
  const challengeCorrectPlayers = useMemo(() => getCorrectPlayersForRound(challengeRound), [challengeRound]);
  const challengeIsPreRound = Boolean(challengePreRoundEndsAt && !challengeRoundEndsAt && !challengeRoundLocked);
  const challengeCanAnswer = screen === "challenge" && !challengeIsPreRound && !challengeRoundLocked;

  useEffect(() => {
    if (!lastAction) return;

    if (lastAction.type === "correct") {
      if (lastAction.playerIndex === playerIndex) {
        playGameSound("ownGoal");
      } else {
        playGameSound("opponentGoal");
      }
    }

    if (lastAction.type === "wrong" && lastAction.playerIndex === playerIndex) {
      playGameSound("wrong");
    }

    if (lastAction.type === "timeout") {
      playGameSound("wrong");
    }
  }, [lastAction, playerIndex]);

  useEffect(() => {
    if (!challengeLastAction) return;

    if (challengeLastAction.type === "correct") {
      // Streak combo: her 3 doğruda özel ses + floating burst
      if (challengeScore > 0 && challengeScore % 3 === 0) {
        playGameSound("combo");
        let tier, label;
        if (challengeScore >= 12) { tier = "legendary"; label = t("combo_legendary", { n: challengeScore }); }
        else if (challengeScore >= 9) { tier = "fire"; label = t("combo_fire", { n: challengeScore }); }
        else if (challengeScore >= 6) { tier = "orange"; label = t("combo_orange", { n: challengeScore }); }
        else { tier = "blue"; label = t("combo_blue", { n: challengeScore }); }
        setComboBurst({ tier, label, key: Date.now() });
      } else {
        playGameSound("ownGoal");
      }
    }

    if (challengeLastAction.type === "wrong") {
      playGameSound("wrong");
    }
  }, [challengeLastAction]);

  // Combo burst otomatik temizle (1.4s görünür kalır)
  useEffect(() => {
    if (!comboBurst) return;
    const id = setTimeout(() => setComboBurst(null), 1400);
    return () => clearTimeout(id);
  }, [comboBurst]);

  useEffect(() => {
    if (screen === "winner" && winner !== null) {
      playGameSound("matchEnd");
      if (winner === playerIndex) {
        triggerConfetti();
        // Multi-burst for extra celebration
        setTimeout(() => triggerConfetti(), 400);
        setTimeout(() => triggerConfetti(), 800);
      }
      track("online_match_completed", {
        won: winner === playerIndex,
        own_score: scores[playerIndex],
        opponent_score: scores[1 - playerIndex],
        target_score: targetScore,
        duration_seconds: endTimer("online_match")
      });
    }
  }, [screen, winner, playerIndex]);

  // Score flash effect — kim puan aldıysa onun tarafı parlasın
  useEffect(() => {
    const prev = prevScoresRef.current;
    if (scores[0] === prev[0] && scores[1] === prev[1]) return;

    const newFlash = [null, null];
    if (scores[0] > prev[0]) newFlash[0] = "gain";
    if (scores[1] > prev[1]) newFlash[1] = "gain";
    setScoreFlash(newFlash);
    prevScoresRef.current = [scores[0], scores[1]];

    const t = setTimeout(() => setScoreFlash([null, null]), 800);
    return () => clearTimeout(t);
  }, [scores]);

  useEffect(() => {
    stateRef.current = {
      screen,
      playerNames,
      playersReady,
      opponentJoined,
      gameStarted,
      targetScore,
      scores,
      round,
      usedRoundKeys,
      message,
      winner,
      showAnswers,
      roundLocked,
      roundEndsAt,
      preRoundEndsAt,
      wrongAttempts,
      lastAction,
      seriesWins,
      matchHistory,
      correctRounds,
      duelVariant,
      teamSelectEndsAt,
      teamPicks
    };
  }, [
    screen, playerNames, playersReady, opponentJoined, gameStarted, targetScore,
    scores, round, usedRoundKeys, message, winner, showAnswers, roundLocked,
    roundEndsAt, preRoundEndsAt, wrongAttempts, lastAction, seriesWins,
    matchHistory, correctRounds, duelVariant, teamSelectEndsAt, teamPicks
  ]);

  const applyGameState = (gameState) => {
    if (!gameState) return;

    // Tur ortasında (kilitli değil, ön-tur değil, oyun ekranı) gelen senkronda
    // yerel oyuncunun yazmakta olduğu cevabı SİLME — rakibin hamlesi onu etkilemesin.
    const preserveInput =
      Boolean(gameState.gameStarted) &&
      !gameState.roundLocked &&
      !gameState.preRoundEndsAt &&
      (gameState.screen === "game" || !gameState.screen);

    setScreen(gameState.screen || "game");
    setPlayerNames(gameState.playerNames || [t("default_player_1"), t("default_player_2")]);
    setPlayersReady(gameState.playersReady || [false, false]);
    setOpponentJoined(Boolean(gameState.opponentJoined) || playerIndex === 1);
    setGameStarted(Boolean(gameState.gameStarted));
    setTargetScore(gameState.targetScore || 3);
    setScores(gameState.scores || [0, 0]);
    setRound(gameState.round || getRandomRound([], "hard", effectiveOnlineAllowedTeams));
    setUsedRoundKeys(gameState.usedRoundKeys || []);
    if (!preserveInput) {
      setAnswerInput("");
      setFocusedInput(false);
    }
    setMessage(gameState.message || null);
    setWinner(gameState.winner ?? null);
    setShowAnswers(Boolean(gameState.showAnswers));
    setRoundLocked(Boolean(gameState.roundLocked));
    setRoundEndsAt(gameState.roundEndsAt || null);
    setPreRoundEndsAt(gameState.preRoundEndsAt || null);
    setTimeLeft(gameState.roundEndsAt ? Math.max(0, Math.ceil((gameState.roundEndsAt - Date.now()) / 1000)) : ROUND_SECONDS);
    setPreRoundLeft(gameState.preRoundEndsAt ? Math.max(0, Math.ceil((gameState.preRoundEndsAt - Date.now()) / 1000)) : ROUND_REVEAL_SECONDS);
    setWrongAttempts(gameState.wrongAttempts || [0, 0]);
    setLastAction(gameState.lastAction || null);
    setSeriesWins(gameState.seriesWins || [0, 0]);
    setMatchHistory(gameState.matchHistory || []);
    setCorrectRounds(gameState.correctRounds || []);
    if (gameState.duelVariant !== undefined) setDuelVariant(gameState.duelVariant || "auto");
    setTeamSelectEndsAt(gameState.teamSelectEndsAt || null);
    setTeamPicks(gameState.teamPicks || [null, null]);
    // Düello/Arena'da host'un lig filtresini in-memory uygula (persist etme —
    // guest kendi tercihine odadan çıkınca dönebilsin).
    if (Array.isArray(gameState.selectedLeagues)) {
      setSelectedLeagues(gameState.selectedLeagues);
    }
    // Eşleşme tipi (Zorluk Seç / Özel Mod) de host'tan gelir.
    if (gameState.onlineMatchMode) {
      setOnlineMatchMode(gameState.onlineMatchMode);
    }
  };

  const sendRoomEvent = async (payload) => {
    if (!channelRef.current) return;

    await channelRef.current.send({
      type: "broadcast",
      event: "game",
      payload: {
        ...payload,
        senderId: clientIdRef.current
      }
    });
  };

  const buildGameState = (overrides = {}) => ({
    screen, playerNames, playersReady, opponentJoined, gameStarted, targetScore,
    scores, round, usedRoundKeys, message, winner, showAnswers, roundLocked,
    roundEndsAt, preRoundEndsAt, wrongAttempts, lastAction, seriesWins,
    matchHistory, correctRounds, duelVariant, teamSelectEndsAt, teamPicks,
    // Düello'da host'un lig filtresi guest'e taşınır. Guest kendi kayıtlı
    // tercihini odadan çıkana kadar kullanmıyor — applyGameState'te sadece
    // in-memory state set ediliyor, localStorage'a yazılmıyor.
    selectedLeagues,
    onlineMatchMode,
    ...overrides
  });

  const broadcastGameState = async (overrides = {}) => {
    await sendRoomEvent({ type: "STATE_SYNC", gameState: buildGameState(overrides) });
  };

  useEffect(() => {
    if (!roomCode || !supabase) return;

    setConnectionStatus("connecting");

    const channel = supabase.channel(`football-room-${roomCode}`, {
      config: { broadcast: { self: false } }
    });

    channelRef.current = channel;

    channel.on("broadcast", { event: "game" }, async ({ payload }) => {
      if (!payload || payload.senderId === clientIdRef.current) return;

      if (payload.type === "PLAYER_JOINED") {
        if (!stateRef.current) return;

        // Slot rezervasyonu: 2. slot'u tutan clientId varsa ve yeni gelen
        // farklı bir clientId ise, üçüncü oyuncuyu reddet.
        // (Aynı senderId tekrar gelirse → refresh/yeniden bağlantı, kabul et.)
        if (playerIndex === 0
            && opponentClientIdRef.current
            && opponentClientIdRef.current !== payload.senderId) {
          await sendRoomEvent({
            type: "ROOM_FULL",
            targetSenderId: payload.senderId
          });
          return;
        }
        // Slot'u bu joiner'a ata
        if (playerIndex === 0) {
          opponentClientIdRef.current = payload.senderId;
        }

        const joinedName = payload.name || t("default_player_2");
        const nextNames = [...stateRef.current.playerNames];
        nextNames[1] = joinedName;

        const nextState = {
          ...stateRef.current,
          screen: "game",
          playerNames: nextNames,
          opponentJoined: true,
          playersReady: [false, false],
          gameStarted: false,
          preRoundEndsAt: null,
          roundEndsAt: null,
          wrongAttempts: [0, 0],
          lastAction: null,
          seriesWins,
          matchHistory,
          correctRounds,
          message: { type: "info", text: t("status_player_joined", { name: joinedName }) }
        };

        applyGameState(nextState);
        await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
      }

      // 3. oyuncu girmek istedi, host tarafından reddedildi
      if (payload.type === "ROOM_FULL") {
        if (payload.targetSenderId !== clientIdRef.current) return;
        // TODO: i18n → status_room_full
        setMessage({ type: "error", text: "Bu oda dolu. Başka bir kod kullan veya yeni oda oluştur." });
        try { if (channelRef.current) supabase.removeChannel(channelRef.current); } catch (e) {}
        channelRef.current = null;
        setRoomCode("");
        setRoomInput("");
        setPlayerIndex(null);
        setOpponentJoined(false);
        setGameStarted(false);
        setConnectionStatus("offline");
        setScreen("home");
        return;
      }

      if (payload.type === "REQUEST_STATE") {
        if (playerIndex === 0 && stateRef.current) {
          await sendRoomEvent({ type: "STATE_SYNC", gameState: stateRef.current });
        }
      }

      if (payload.type === "STATE_SYNC") {
        applyGameState(payload.gameState);
      }
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        setConnectionStatus("online");

        if (playerIndex === 1) {
          await sendRoomEvent({ type: "PLAYER_JOINED", name: playerName || t("default_player_2") });
          await sendRoomEvent({ type: "REQUEST_STATE" });
        }

        if (playerIndex === 0) {
          await broadcastGameState();
        }
      }
    });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  const createRoom = () => {
    if (!supabase) {
      setMessage({ type: "error", text: "Supabase ayarları eksik. .env.local dosyasını kontrol et." });
      return;
    }

    const code = makeRoomCode();
    const firstRound = getRandomRound([], effectiveOnlineDifficulty, effectiveOnlineAllowedTeams) || { teams: ["Fenerbahçe", "Galatasaray"] };
    const name = playerName.trim() || t("default_player_1");

    opponentClientIdRef.current = null; // yeni oda → rakip slotu boş
    setRoomCode(code);
    setRoomInput(code);
    setPlayerIndex(0);
    setTargetScore(Number(targetScore));
    setPlayerNames([name, t("default_opponent_waiting")]);
    setPlayersReady([false, false]);
    setOpponentJoined(false);
    setGameStarted(false);
    setScores([0, 0]);
    setRound(firstRound);
    setUsedRoundKeys([getRoundKey(firstRound)]);
    setAnswerInput("");
    setFocusedInput(false);
    setWinner(null);
    setShowAnswers(false);
    setRoundLocked(false);
    setRoundEndsAt(null);
    setPreRoundEndsAt(null);
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(ROUND_REVEAL_SECONDS);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setCorrectRounds([]);
    setLastWrongReport(null);
    setReportStatus(null);
    setTeamSelectEndsAt(null);
    setTeamPicks([null, null]);
    setMessage({ type: "info", text: `Oda oluşturuldu: ${code}. Rakip bağlanana kadar takımlar gizli.` });
    setScreen("game");
    track("mode_started", { mode: "online" });
    track("room_created", { target_score: Number(targetScore) });
    startTimer("online_match");
  };

  const joinRoom = () => {
    if (!supabase) {
      setMessage({ type: "error", text: "Supabase ayarları eksik. .env.local dosyasını kontrol et." });
      return;
    }

    const code = roomInput.trim().toUpperCase();

    if (!code) {
      setMessage({ type: "error", text: t("err_join_no_code") });
      return;
    }

    const name = playerName.trim() || t("default_player_2");

    setRoomCode(code);
    setPlayerIndex(1);
    setPlayerNames([t("default_player_1"), name]);
    setPlayersReady([false, false]);
    setOpponentJoined(true);
    setGameStarted(false);
    setAnswerInput("");
    setFocusedInput(false);
    setRoundEndsAt(null);
    setPreRoundEndsAt(null);
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(ROUND_REVEAL_SECONDS);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setLastWrongReport(null);
    setReportStatus(null);
    setMessage({ type: "info", text: `${code} odasına bağlanılıyor...` });
    setScreen("game");
    track("mode_started", { mode: "online" });
    track("room_joined", { room_code: code });
    startTimer("online_match");
  };

  const copyInvite = async () => {
    const url = `${window.location.origin}?room=${roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ type: "success", text: t("status_invite_copied") });
    } catch {
      setMessage({ type: "info", text: t("status_invite_link", { url }) });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomInput(roomFromUrl.toUpperCase());
    }
  }, []);

  const readyStatusText = () => {
    if (!opponentJoined) return t("status_waiting_opp");
    if (playersReady[0] && playersReady[1]) return t("status_both_ready");
    if (playersReady[playerIndex]) return t("status_you_ready");
    const opponentIndex = playerIndex === 0 ? 1 : 0;
    if (playersReady[opponentIndex]) return t("status_opp_ready");
    return t("status_both_press");
  };

  const pressStartGame = async () => {
    if (!opponentJoined) {
      setMessage({ type: "info", text: t("status_opp_not_joined") });
      return;
    }

    const nextReady = [...playersReady];
    nextReady[playerIndex] = true;

    const bothReady = nextReady[0] && nextReady[1];
    const isStrategic = duelVariant === "strategic";
    // Stratejikte takım seçim fazına gir, otomatikte direkt pre-round'a
    const nextTeamSelectEndsAt = bothReady && isStrategic ? Date.now() + TEAM_SELECT_SECONDS * 1000 : null;
    const nextPreRoundEndsAt = bothReady && !isStrategic ? Date.now() + ROUND_REVEAL_SECONDS * 1000 : null;
    const nextScreen = bothReady && isStrategic ? "team_select" : "game";
    const nextMessage = bothReady
      ? { type: "success", text: t("status_both_ready_starting") }
      : { type: "info", text: t("status_player_ready", { name: playerNames[playerIndex] }) };

    const nextState = {
      screen: nextScreen,
      playerNames,
      playersReady: nextReady,
      opponentJoined: true,
      gameStarted: bothReady,
      targetScore, scores, round, usedRoundKeys,
      message: nextMessage,
      winner: null, showAnswers: false, roundLocked: false,
      roundEndsAt: null,
      preRoundEndsAt: nextPreRoundEndsAt,
      teamSelectEndsAt: nextTeamSelectEndsAt,
      teamPicks: bothReady && isStrategic ? [null, null] : teamPicks,
      duelVariant,
      wrongAttempts: [0, 0], lastAction: null,
      seriesWins, matchHistory, correctRounds
    };

    setPlayersReady(nextReady);
    setGameStarted(bothReady);
    setRoundEndsAt(null);
    setPreRoundEndsAt(nextPreRoundEndsAt);
    setTeamSelectEndsAt(nextTeamSelectEndsAt);
    if (bothReady && isStrategic) {
      setScreen("team_select");
      setTeamPicks([null, null]);
    }
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(ROUND_REVEAL_SECONDS);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setLastWrongReport(null);
    setReportStatus(null);
    setMessage(nextMessage);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  // Stratejik mod: takım seçimini yayınla
  const pickTeam = async (teamName) => {
    if (screen !== "team_select") return;
    if (teamPicks[playerIndex]) return;
    const newPicks = [...teamPicks];
    newPicks[playerIndex] = teamName;
    setTeamPicks(newPicks);
    const nextState = { ...stateRef.current, teamPicks: newPicks };
    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  // Stratejik mod: takım seçimi sonlandır (sadece host)
  const finalizeTeamSelect = async () => {
    if (playerIndex !== 0) return;
    if (screen !== "team_select") return;
    // Random fallback havuzu — lig filtresi varsa o liglere sınırla.
    // Filtre boşsa veya hiç takım kalmıyorsa tüm TEAM_LOGOS'a düş.
    const filteredPool = effectiveOnlineAllowedTeams
      ? Object.keys(TEAM_LOGOS).filter((tn) => effectiveOnlineAllowedTeams.has(tn))
      : Object.keys(TEAM_LOGOS);
    const pool = filteredPool.length > 0 ? filteredPool : Object.keys(TEAM_LOGOS);
    if (!pool.length) return;

    const origP0 = teamPicks[0];
    const origP1 = teamPicks[1];

    // Her iki oyuncu da farklı takımlar seçtiyse ama bu eşleşmede ortak
    // oyuncu yoksa: SESSİZCE bir takımı değiştirmek yerine seçim ekranını
    // sıfırla. Aksi halde oyuncu seçmediği bir takımı ekranda görür
    // (örn. Beşiktaş × Rizespor seçildi ama Beşiktaş × Chelsea çıktı bug'ı).
    if (origP0 && origP1 && origP0 !== origP1) {
      if (getRoundAnswers({ teams: [origP0, origP1] }).length === 0) {
        const nextState = {
          ...stateRef.current,
          teamPicks: [null, null],
          teamSelectEndsAt: Date.now() + TEAM_SELECT_SECONDS * 1000,
          // TODO: i18n'e taşı → ts_no_common_warning
          message: { type: "warning", text: t("ts_no_shared_player") }
        };
        applyGameState(nextState);
        await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
        return;
      }
    }

    let p0 = origP0;
    let p1 = origP1;
    // Timeout fallback: seçilmeyen yere rastgele
    if (!p0) p0 = pool[Math.floor(Math.random() * pool.length)];
    if (!p1) p1 = pool[Math.floor(Math.random() * pool.length)];
    if (p0 === p1) {
      const alt = pool.filter((tn) => tn !== p0);
      if (alt.length) p1 = alt[Math.floor(Math.random() * alt.length)];
    }
    // Ortak oyuncu yoksa SADECE timeout ile gelen (yani gerçek pick olmayan)
    // tarafı değiştir. Böylece gerçek pick'e dokunulmaz.
    let candidate = { teams: [p0, p1] };
    let attempts = 0;
    while (getRoundAnswers(candidate).length === 0 && attempts < 10) {
      const alt = pool.filter((tn) => tn !== p0 && tn !== p1);
      if (!alt.length) break;
      if (!origP1) {
        p1 = alt[Math.floor(Math.random() * alt.length)];
      } else if (!origP0) {
        p0 = alt[Math.floor(Math.random() * alt.length)];
      } else {
        // İkisi de gerçek pick — yukarıda yakalanmış olmalı, savunma amaçlı break
        break;
      }
      candidate = { teams: [p0, p1] };
      attempts++;
    }
    if (getRoundAnswers(candidate).length === 0) {
      // Toplam fallback: rastgele bilinen bir çift
      candidate = getRandomRound([], "hard", effectiveOnlineAllowedTeams) || { teams: ["Fenerbahçe", "Galatasaray"] };
    }
    const nextPreRoundEndsAt = Date.now() + ROUND_REVEAL_SECONDS * 1000;
    const nextState = {
      ...stateRef.current,
      screen: "game",
      round: candidate,
      usedRoundKeys: [...(stateRef.current.usedRoundKeys || []), getRoundKey(candidate)],
      gameStarted: true,
      preRoundEndsAt: nextPreRoundEndsAt,
      roundEndsAt: null,
      roundLocked: false,
      showAnswers: false,
      wrongAttempts: [0, 0],
      lastAction: null,
      teamSelectEndsAt: null,
      teamPicks: candidate.teams,
      message: null
    };
    setLastWrongReport(null);
    setReportStatus(null);
    applyGameState(nextState);
    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const nextRound = async () => {
    if (playerIndex !== 0) {
      setMessage({ type: "info", text: t("status_only_host_next") });
      return;
    }

    // Stratejik mod: yeni tur = takım seçim fazına geri dön
    if (duelVariant === "strategic") {
      const nextState = {
        ...stateRef.current,
        screen: "team_select",
        teamSelectEndsAt: Date.now() + TEAM_SELECT_SECONDS * 1000,
        teamPicks: [null, null],
        preRoundEndsAt: null,
        roundEndsAt: null,
        roundLocked: false,
        showAnswers: false,
        wrongAttempts: [0, 0],
        lastAction: null,
        message: null
      };
      setLastWrongReport(null);
      setReportStatus(null);
      applyGameState(nextState);
      await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
      return;
    }

    const next = getRandomRound(usedRoundKeys, effectiveOnlineDifficulty, effectiveOnlineAllowedTeams) || { teams: ["Fenerbahçe", "Galatasaray"] };
    const nextPreRoundEndsAt = Date.now() + ROUND_REVEAL_SECONDS * 1000;
    const nextKey = getRoundKey(next);
    const playableCount = getPlayableTeamPairs(effectiveOnlineAllowedTeams).length;
    const nextUsed = usedRoundKeys.length >= playableCount ? [nextKey] : [...usedRoundKeys, nextKey];

    const nextState = {
      screen: "game",
      playerNames, playersReady, opponentJoined,
      gameStarted: true,
      targetScore, scores,
      round: next,
      usedRoundKeys: nextUsed,
      message: null, winner: null,
      showAnswers: false, roundLocked: false,
      roundEndsAt: null,
      preRoundEndsAt: nextPreRoundEndsAt,
      wrongAttempts: [0, 0], lastAction: null,
      seriesWins, matchHistory, correctRounds
    };

    setRound(next);
    setUsedRoundKeys(nextUsed);
    setAnswerInput("");
    setFocusedInput(false);
    setMessage(null);
    setShowAnswers(false);
    setRoundLocked(false);
    setRoundEndsAt(null);
    setPreRoundEndsAt(nextPreRoundEndsAt);
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(ROUND_REVEAL_SECONDS);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setLastWrongReport(null);
    setReportStatus(null);
    setWinner(null);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  // Düello: tur kilitlenince oda sahibi otomatik sonraki tura geçer.
  // Doğru bilindiyse hızlı (3sn); yanlış/süre dolduysa cevaplara bakmak için 5sn.
  useEffect(() => {
    if (playerIndex !== 0 || screen !== "game" || !roundLocked) return;
    const delay = lastAction?.type === "correct" ? 3000 : 5000;
    const timer = window.setTimeout(() => { nextRound(); }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundLocked, screen, playerIndex, lastAction]);

  // Stratejik mod: takım seçim countdown
  useEffect(() => {
    if (screen !== "team_select" || !teamSelectEndsAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((teamSelectEndsAt - Date.now()) / 1000));
      setTeamSelectLeft(remaining);
      if (remaining <= 0 && playerIndex === 0) {
        finalizeTeamSelect();
      }
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, teamSelectEndsAt, playerIndex]);

  // Stratejik mod: iki oyuncu da seçince host finalize eder (kısa reveal beklemesiyle)
  useEffect(() => {
    if (playerIndex !== 0) return;
    if (screen !== "team_select") return;
    if (!teamPicks[0] || !teamPicks[1]) return;

    // ÇAKIŞMA: Aynı takım seçildi — host her ikisini de sıfırlasın, oyuncular yeniden seçsin
    if (teamPicks[0] === teamPicks[1]) {
      const timer = window.setTimeout(async () => {
        const nextState = {
          ...stateRef.current,
          teamPicks: [null, null],
          teamSelectEndsAt: Date.now() + TEAM_SELECT_SECONDS * 1000,
          message: { type: "warning", text: t("ts_collision_warning") }
        };
        applyGameState(nextState);
        await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
      }, 800);
      return () => window.clearTimeout(timer);
    }

    // Normal: finalize
    const timer = window.setTimeout(() => { finalizeTeamSelect(); }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamPicks, screen, playerIndex]);

  const resetGame = async () => {
    const firstRound = getRandomRound([], effectiveOnlineDifficulty, effectiveOnlineAllowedTeams) || { teams: ["Fenerbahçe", "Galatasaray"] };
    const nextState = {
      screen: "game", playerNames,
      playersReady: [false, false],
      opponentJoined, gameStarted: false,
      targetScore, scores: [0, 0],
      round: firstRound,
      usedRoundKeys: [getRoundKey(firstRound)],
      message: { type: "info", text: t("status_game_restarted") },
      winner: null, showAnswers: false, roundLocked: false,
      roundEndsAt: null, preRoundEndsAt: null,
      wrongAttempts: [0, 0], lastAction: null,
      seriesWins: [0, 0], matchHistory: [], correctRounds: []
    };

    setScores([0, 0]);
    setPlayersReady([false, false]);
    setGameStarted(false);
    setRound(firstRound);
    setUsedRoundKeys([getRoundKey(firstRound)]);
    setAnswerInput("");
    setFocusedInput(false);
    setMessage(nextState.message);
    setWinner(null);
    setShowAnswers(false);
    setRoundLocked(false);
    setRoundEndsAt(null);
    setPreRoundEndsAt(null);
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(ROUND_REVEAL_SECONDS);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setLastWrongReport(null);
    setReportStatus(null);
    setScreen("game");

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const isPreRound = Boolean(gameStarted && preRoundEndsAt && !roundEndsAt && !roundLocked);
  const myWrongAttemptUsed = playerIndex !== null && wrongAttempts[playerIndex] >= 1;
  const canAnswer = gameStarted && !isPreRound && !roundLocked && !myWrongAttemptUsed;

  const updateAnswerInput = (value) => {
    if (!canAnswer) return;
    setAnswerInput(value);
    setFocusedInput(true);
  };

  const selectSuggestion = (playerNameValue) => {
    if (!canAnswer) return;
    setAnswerInput(playerNameValue);
    setFocusedInput(false);
  };

  const checkAnswer = async () => {
    setFocusedInput(false);

    if (!gameStarted) {
      setMessage({ type: "info", text: t("err_game_not_started") });
      return;
    }
    if (roundLocked) {
      setMessage({ type: "info", text: t("err_round_over") });
      return;
    }
    if (isPreRound) {
      setMessage({ type: "info", text: t("err_teams_not_open") });
      return;
    }
    if (myWrongAttemptUsed) {
      setMessage({ type: "info", text: t("err_no_tries_wait") });
      return;
    }

    const raw = answerInput;
    const normalized = normalizeText(raw);

    if (!normalized) {
      setMessage({ type: "error", text: t("err_type_player_first") });
      return;
    }

    logAnswerAttempt("online", round, raw);

    if (isCorrectAnswer(round, raw)) {
      const newScores = [...scores];
      newScores[playerIndex] += 1;

      const hasWinner = newScores[playerIndex] >= targetScore;
      const nextSeriesWins = [...seriesWins];
      const correctEntry = {
        teamA: round.teams[0],
        teamB: round.teams[1],
        answer: raw,
        playerIndex,
        playerName: playerNames[playerIndex],
        roundNumber: usedRoundKeys.length,
        answeredAt: new Date().toISOString()
      };
      const nextCorrectRounds = [...correctRounds, correctEntry];
      const nextMatchHistory = [...matchHistory];

      if (hasWinner) {
        nextSeriesWins[playerIndex] += 1;
        nextMatchHistory.push({
          winnerIndex: playerIndex,
          winnerName: playerNames[playerIndex],
          score: newScores,
          correctRounds: nextCorrectRounds,
          finishedAt: new Date().toISOString()
        });
      }

      const nextMessage = {
        type: "success",
        text: `${playerNames[playerIndex]} doğru bildi: ${raw}!`
      };

      const nextState = {
        screen: hasWinner ? "winner" : "game",
        playerNames, playersReady, opponentJoined, gameStarted, targetScore,
        scores: newScores, round, usedRoundKeys,
        message: nextMessage,
        winner: hasWinner ? playerIndex : null,
        showAnswers: true, roundLocked: true,
        roundEndsAt: null, preRoundEndsAt: null,
        wrongAttempts,
        lastAction: { type: "correct", playerIndex, answer: raw },
        seriesWins: nextSeriesWins,
        matchHistory: nextMatchHistory,
        correctRounds: nextCorrectRounds
      };

      setScores(newScores);
      setRoundLocked(true);
      setShowAnswers(true);
      setRoundEndsAt(null);
      setPreRoundEndsAt(null);
      setTimeLeft(0);
      setLastAction({ type: "correct", playerIndex, answer: raw });
      setCorrectRounds(nextCorrectRounds);
      setLastWrongReport(null);
      setReportStatus(null);
      setMessage(nextMessage);
      setAnswerInput("");

      if (hasWinner) {
        setWinner(playerIndex);
        setScreen("winner");
        setSeriesWins(nextSeriesWins);
        setMatchHistory(nextMatchHistory);
      }

      await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
      return;
    }

    const newWrongAttempts = [...wrongAttempts];
    newWrongAttempts[playerIndex] += 1;

    const bothPlayersUsedWrong = newWrongAttempts[0] >= 1 && newWrongAttempts[1] >= 1;
    const wrongExplanation = getWrongAnswerExplanation(round, raw);
    const ownWrongMessage = {
      type: "error",
      text: bothPlayersUsedWrong
        ? t("wrong_both_used", { base: wrongExplanation })
        : t("wrong_no_tries_left", { base: wrongExplanation })
    };
    const sharedWrongMessage = {
      type: bothPlayersUsedWrong ? "error" : "info",
      text: bothPlayersUsedWrong
        ? t("shared_both_used", { base: wrongExplanation })
        : t("shared_opp_wrong", { name: playerNames[playerIndex] || t("default_opponent") })
    };

    const nextState = {
      screen: "game",
      playerNames, playersReady, opponentJoined, gameStarted, targetScore,
      scores, round, usedRoundKeys,
      message: sharedWrongMessage,
      winner: null,
      showAnswers: bothPlayersUsedWrong,
      roundLocked: bothPlayersUsedWrong,
      roundEndsAt: bothPlayersUsedWrong ? null : roundEndsAt,
      preRoundEndsAt: null,
      wrongAttempts: newWrongAttempts,
      lastAction: { type: "wrong", playerIndex, answer: raw },
      seriesWins, matchHistory,
      correctRounds
    };

    setWrongAttempts(newWrongAttempts);
    setLastAction({ type: "wrong", playerIndex, answer: raw });
    setLastWrongReport({
      mode: "online",
      teamA: round.teams[0],
      teamB: round.teams[1],
      answer: raw,
      feedback: ownWrongMessage.text,
      roomCode,
      playerName: playerNames[playerIndex] || playerName || "Oyuncu"
    });
    setReportStatus(null);
    setMessage(ownWrongMessage);
    setAnswerInput("");

    if (bothPlayersUsedWrong) {
      setShowAnswers(true);
      setRoundLocked(true);
      setRoundEndsAt(null);
      setTimeLeft(0);
    }

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const skipRound = async () => {
    if (playerIndex !== 0) {
      setMessage({ type: "info", text: t("err_only_host_reveal") });
      return;
    }

    if (roundLocked) return;

    const nextMessage = { type: "info", text: t("status_round_skipped") };
    const nextState = {
      screen: "game",
      playerNames, playersReady, opponentJoined, gameStarted, targetScore,
      scores, round, usedRoundKeys,
      message: nextMessage,
      winner: null,
      showAnswers: true, roundLocked: true,
      roundEndsAt: null, preRoundEndsAt: null,
      wrongAttempts,
      lastAction: { type: "timeout" },
      seriesWins, matchHistory, correctRounds
    };

    setMessage(nextMessage);
    setShowAnswers(true);
    setRoundLocked(true);
    setRoundEndsAt(null);
    setPreRoundEndsAt(null);
    setTimeLeft(0);
    setLastAction({ type: "timeout" });
    setFocusedInput(false);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const startAnswerPhase = async () => {
    if (!gameStarted || roundLocked || !preRoundEndsAt || roundEndsAt || screen !== "game") return;

    const nextRoundEndsAt = Date.now() + ROUND_SECONDS * 1000;
    const nextState = {
      screen: "game",
      playerNames, playersReady, opponentJoined, gameStarted, targetScore,
      scores, round, usedRoundKeys,
      message: null, winner: null,
      showAnswers: false, roundLocked: false,
      roundEndsAt: nextRoundEndsAt,
      preRoundEndsAt: null,
      wrongAttempts: [0, 0], lastAction: null
    };

    setRoundEndsAt(nextRoundEndsAt);
    setPreRoundEndsAt(null);
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(0);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setMessage(null);

    if (playerIndex === 0) {
      await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
    }
  };

  useEffect(() => {
    if (preRoundLeft > 0 && preRoundLeft <= ROUND_REVEAL_SECONDS && screen === "game") {
      playGameSound("countdown");
    }
  }, [preRoundLeft, screen]);

  // Online round son 5sn tick
  useEffect(() => {
    if (timeLeft > 0 && timeLeft <= 5 && screen === "game" && !roundLocked && gameStarted) {
      playGameSound("urgentTick");
    }
  }, [timeLeft, screen, roundLocked, gameStarted]);

  useEffect(() => {
    if (!gameStarted || roundLocked || !preRoundEndsAt || screen !== "game") return;

    const updatePreRoundTimer = () => {
      const remaining = Math.max(0, Math.ceil((preRoundEndsAt - Date.now()) / 1000));
      setPreRoundLeft(remaining);

      if (remaining <= 0) {
        startAnswerPhase();
      }
    };

    updatePreRoundTimer();
    const intervalId = window.setInterval(updatePreRoundTimer, 200);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, roundLocked, preRoundEndsAt, screen]);

  const handleTimeUp = async () => {
    if (!gameStarted || roundLocked || screen !== "game") return;

    const nextMessage = { type: "info", text: t("time_over_round_end") };
    const nextState = {
      screen: "game",
      playerNames, playersReady, opponentJoined, gameStarted, targetScore,
      scores, round, usedRoundKeys,
      message: nextMessage, winner: null,
      showAnswers: true, roundLocked: true,
      roundEndsAt: null, preRoundEndsAt: null,
      wrongAttempts,
      lastAction: { type: "timeout" },
      seriesWins, matchHistory
    };

    setMessage(nextMessage);
    setShowAnswers(true);
    setRoundLocked(true);
    setRoundEndsAt(null);
    setPreRoundEndsAt(null);
    setTimeLeft(0);
    setLastAction({ type: "timeout" });
    setFocusedInput(false);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  useEffect(() => {
    if (!gameStarted || roundLocked || !roundEndsAt || screen !== "game") return;

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000));
      setTimeLeft(remaining);

      if (remaining <= 0) {
        handleTimeUp();
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, roundLocked, roundEndsAt, screen]);

  const startChallenge = () => {
    // Önce mod seçim ekranı (zorluk vs özel mod)
    setShowChallengeStartScreen(true);
    setChallengeMode(null); // picker'ı göster
    setScreen("challenge");
  };

  // Zorluk path'i: lig filtresi UYGULANMAZ, tüm takımlardan eşleşme gelir.
  // Özel mod path'i (mode="custom"): seçili ligler kullanılır, zorluk
  // dahili olarak "hard" (= isPairInDifficulty(_, "hard") her zaman true,
  // yani zorluk filtresi yok). challengeMode state'i akış boyunca tutulur.
  const confirmStartChallenge = (mode, difficulty) => {
    const effectiveMode = mode === "custom" ? "custom" : "difficulty";
    const effectiveDifficulty = effectiveMode === "custom" ? "hard" : difficulty;
    const filterTeams = effectiveMode === "custom" ? allowedTeamsSet : null;

    setChallengeMode(effectiveMode);
    setChallengeDifficulty(effectiveDifficulty);
    setChallengeEffectiveDifficulty(effectiveDifficulty);
    setScoreSaved(false);
    setShowChallengeStartScreen(false);
    const firstRound = getRandomRound([], effectiveDifficulty, filterTeams) || { teams: ["Fenerbahçe", "Galatasaray"] };
    setChallengeScore(0);
    setChallengeLastScore(null);
    setChallengeRound(firstRound);
    setChallengeUsedRoundKeys([getRoundKey(firstRound)]);
    setChallengeInput("");
    setChallengeFocused(false);
    setChallengeMessage({ type: "info", text: t("marathon_started") });
    setChallengeRoundLocked(false);
    setChallengeShowAnswers(false);
    setChallengeRoundEndsAt(null);
    setChallengePreRoundEndsAt(Date.now() + ROUND_REVEAL_SECONDS * 1000);
    setChallengeTimeLeft(ROUND_SECONDS);
    setChallengePreRoundLeft(ROUND_REVEAL_SECONDS);
    setChallengeLastAction(null);
    setChallengeLastWrongReport(null);
    setChallengeReportStatus(null);
    setChallengeFirstLetterUsed(false);
    setChallengeSwapUsed(false);
    setChallengeTimeAddUsed(false);
    setChallengeJokerHint(null);
    track("mode_started", { mode: "challenge", difficulty: effectiveDifficulty, marathonMode: effectiveMode });
    startTimer("challenge");
  };

  const backToHomeFromChallenge = () => {
    setChallengeRoundEndsAt(null);
    setChallengePreRoundEndsAt(null);
    setChallengeFocused(false);
    setScreen("home");
  };

  // =================== DAILY PUZZLE FUNCTIONS ===================
  const startDaily = () => {
    const today = getTodayKey();
    const existingToday = dailyHistory[today];
    const annotatedPairs = WEIGHTED_TEAM_PAIRS.map((p) => ({
      teams: p.teams,
      bucket: isPairInDifficulty(p, "easy") ? 1 : isPairInDifficulty(p, "medium") ? 2 : 3
    }));
    const data = getDailyPuzzle(annotatedPairs);
    setDailyData(data);

    if (existingToday && existingToday.completed) {
      // Bugün zaten oynanmış — direkt sonuç ekranı
      setDailyResults(existingToday.attempts || []);
      setDailyIndex(data.puzzles.length);
      setDailyDone(true);
    } else {
      setDailyIndex(0);
      setDailyResults([]);
      setDailyDone(false);
    }
    setDailyWrongCount(0);
    setDailyInput("");
    setDailyFocused(false);
    setDailyMessage(null);
    setDailyAcceptedThisRound([]);
    setDailyShowAnswers(false);
    setDailyFeedback(null);
    setScreen("daily");
    track("mode_started", { mode: "daily", already_completed: !!(existingToday && existingToday.completed) });
    startTimer("daily");
  };

  const advanceDailyToNext = (resultType) => {
    const newResults = [...dailyResults, resultType];
    setDailyResults(newResults);

    const nextIdx = dailyIndex + 1;
    const isLast = nextIdx >= (dailyData?.puzzles?.length || 5);

    if (isLast) {
      // Oyun bitti, kaydet
      const today = getTodayKey();
      const newHistory = {
        ...dailyHistory,
        [today]: { attempts: newResults, completed: true, finishedAt: Date.now() }
      };
      setDailyHistory(newHistory);
      window.localStorage.setItem("pairfc_daily_history", JSON.stringify(newHistory));
      setDailyDone(true);
      const correctCount = newResults.filter((r) => r === "correct").length;
      track("daily_completed", {
        correct: correctCount,
        total: newResults.length,
        streak: calculateStreak(newHistory),
        duration_seconds: endTimer("daily"),
        date: today
      });
    } else {
      setDailyIndex(nextIdx);
      setDailyWrongCount(0);
      setDailyInput("");
      setDailyMessage(null);
      setDailyShowAnswers(false);
      setDailyAcceptedThisRound([]);
      setDailyFeedback(null);
    }
  };

  const submitDailyAnswer = () => {
    if (!dailyData || dailyDone) return;
    const currentPuzzle = dailyData.puzzles[dailyIndex];
    if (!currentPuzzle) return;

    const raw = dailyInput.trim();
    if (!raw) return;

    const round = { teams: currentPuzzle.teams };
    logAnswerAttempt("daily", round, raw);
    const acceptedName = findAcceptedAnswer(round, raw);

    if (acceptedName) {
      if (dailyAcceptedThisRound.includes(acceptedName)) {
        setDailyMessage({ type: "warning", text: t("daily_already_given") });
        setDailyInput("");
        return;
      }
      // Doğru!
      setDailyAcceptedThisRound([...dailyAcceptedThisRound, acceptedName]);
      setDailyInput("");
      setDailyMessage({ type: "success", text: t("daily_correct", { name: acceptedName }) });
      setDailyFeedback("correct");
      triggerConfetti();
      triggerScreenFlash("success");
      playGameSound("ownGoal");
      setTimeout(() => {
        setDailyFeedback(null);
        advanceDailyToNext("correct");
      }, 1200);
    } else {
      // Yanlış
      const nextWrong = dailyWrongCount + 1;
      setDailyWrongCount(nextWrong);
      setDailyInput("");
      setDailyFeedback("wrong");
      triggerScreenFlash("error");
      playGameSound("wrong");
      setTimeout(() => setDailyFeedback(null), 600);
      if (nextWrong >= 3) {
        // 3 yanlış — bu puzzle X, sonraki
        setDailyShowAnswers(true);
        setDailyMessage({ type: "error", text: t("daily_3wrong_msg") });
        setTimeout(() => advanceDailyToNext("failed"), 1800);
      } else {
        setDailyMessage({ type: "error", text: t("daily_wrong_msg", { n: 3 - nextWrong }) });
      }
    }
  };

  const skipDailyPuzzle = () => {
    setDailyShowAnswers(true);
    setDailyMessage({ type: "info", text: t("daily_skip_msg") });
    setTimeout(() => advanceDailyToNext("failed"), 1200);
  };

  const buildDailyShareText = () => {
    if (!dailyData || !dailyResults.length) return "";
    const correctCount = dailyResults.filter((r) => r === "correct").length;
    const total = dailyData.puzzles.length;
    const grid = dailyResults.map((r) => (r === "correct" ? "🟩" : "🟥")).join("");
    // Günü 1'den başlat (2026-01-01 = gün 1)
    const epoch = new Date("2026-01-01T00:00:00Z").getTime();
    const today = new Date(dailyData.date).getTime();
    const dayNum = Math.floor((today - epoch) / 86400000) + 1;
    const streakLine = dailyStreak > 1 ? `\n🔥 ${dailyStreak} gün üst üste` : "";
    return `PairFC #${dayNum} — ${correctCount}/${total}\n\n${grid}${streakLine}\n\npairfc.com`;
  };

  const [dailyShareStatus, setDailyShareStatus] = useState(null);
  const shareDailyResult = async () => {
    const text = buildDailyShareText();
    if (!text) return;

    let blob = null;
    try {
      const correctCount = dailyResults.filter((r) => r === "correct").length;
      const total = dailyData.puzzles.length;
      const epoch = new Date("2026-01-01T00:00:00Z").getTime();
      const dayNum = Math.floor((new Date(dailyData.date).getTime() - epoch) / 86400000) + 1;
      const canvas = drawDailyShareCard({ dayNum, correctCount, total, results: dailyResults, streak: dailyStreak });
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } catch (e) {
      blob = null;
    }

    try {
      if (blob && navigator.canShare) {
        const file = new File([blob], "pairfc-gunluk.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text });
          setDailyShareStatus({ type: "success", text: t("share_ok") });
          track("daily_shared", { method: "native_image" });
          setTimeout(() => setDailyShareStatus(null), 2500);
          return;
        }
      }
      if (navigator.share) {
        await navigator.share({ title: "PairFC", text });
        setDailyShareStatus({ type: "success", text: t("share_ok") });
        track("daily_shared", { method: "native" });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "pairfc-gunluk.png";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        setDailyShareStatus({ type: "success", text: t("share_copied_dl") });
        track("daily_shared", { method: "clipboard" });
      } else {
        setDailyShareStatus({ type: "info", text: t("share_unsupported") });
        track("daily_shared", { method: "unsupported" });
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setDailyShareStatus({ type: "error", text: t("share_failed") });
        track("daily_shared", { method: "failed" });
      }
    }
    setTimeout(() => setDailyShareStatus(null), 2500);
  };

  const dailySuggestions = useMemo(() => getPlayerSuggestions(dailyInput), [dailyInput]);
  const updateDailyInput = (value) => {
    setDailyInput(value);
    if (value && value.length > 0) setDailyFocused(true);
  };
  const selectDailySuggestion = (name) => {
    setDailyInput(name);
    setDailyFocused(false);
  };

  // Countdown timer to next puzzle (her zaman çalışır — anasayfa ve sonuç ekranı için)
  useEffect(() => {
    const update = () => {
      const ms = getMsUntilNextPuzzle();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setDailyCountdown(t("countdown_format", { h, m }));
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const goToHome = () => {
    track("home_button_clicked", {
      from_screen: screen,
      mid_game: screen !== "home"
    });
    setMainTab("home");
    setScoreSaved(false);
    if (screen === "challenge") {
      backToHomeFromChallenge();
      return;
    }
    if (screen === "daily") {
      setScreen("home");
      return;
    }
    if (screen === "game" || screen === "winner" || screen === "team_select") {
      // Online oyundan ayrıl
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      opponentClientIdRef.current = null; // odadan çıkıldı → slot rezervasyonunu bırak
      setRoomCode("");
      setRoundEndsAt(null);
      setPreRoundEndsAt(null);
      setTeamSelectEndsAt(null);
      setTeamPicks([null, null]);
      // Düello'da host'un filtresi in-memory uygulanmıştı; ayrılırken kendi
      // kayıtlı tercihine geri dön.
      try {
        const saved = window.localStorage.getItem("pairfc_selected_leagues");
        setSelectedLeagues(saved ? JSON.parse(saved) : []);
      } catch (e) { setSelectedLeagues([]); }
      try {
        const savedMode = window.localStorage.getItem("pairfc_online_match_mode");
        setOnlineMatchMode(savedMode || "difficulty");
      } catch (e) { setOnlineMatchMode("difficulty"); }
    }
    setShowOnlineSetup(false);
    setOnlineSetupMode(null);
    setDuelVariant(null);
    setScreen("home");
  };

  const startChallengeAnswerPhase = () => {
    if (screen !== "challenge" || challengeRoundLocked || !challengePreRoundEndsAt || challengeRoundEndsAt) return;

    setChallengeRoundEndsAt(Date.now() + ROUND_SECONDS * 1000);
    setChallengePreRoundEndsAt(null);
    setChallengeTimeLeft(ROUND_SECONDS);
    setChallengePreRoundLeft(0);
    setChallengeMessage(null);
    setChallengeLastAction(null);
  };

  useEffect(() => {
    if (challengePreRoundLeft > 0 && challengePreRoundLeft <= ROUND_REVEAL_SECONDS && screen === "challenge") {
      playGameSound("countdown");
    }
  }, [challengePreRoundLeft, screen]);

  // Challenge round son 5sn tick
  useEffect(() => {
    if (challengeTimeLeft > 0 && challengeTimeLeft <= 5 && screen === "challenge" && !challengeRoundLocked) {
      playGameSound("urgentTick");
    }
  }, [challengeTimeLeft, screen, challengeRoundLocked]);

  useEffect(() => {
    if (screen !== "challenge" || challengeRoundLocked || !challengePreRoundEndsAt) return;

    const updatePreRoundTimer = () => {
      const remaining = Math.max(0, Math.ceil((challengePreRoundEndsAt - Date.now()) / 1000));
      setChallengePreRoundLeft(remaining);

      if (remaining <= 0) {
        startChallengeAnswerPhase();
      }
    };

    updatePreRoundTimer();
    const intervalId = window.setInterval(updatePreRoundTimer, 200);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, challengeRoundLocked, challengePreRoundEndsAt, challengeRoundEndsAt]);

  const endChallenge = (reasonText, reportAnswer = null, reportRound = challengeRound) => {
    const finalScore = challengeScore;
    const diff = challengeDifficulty;
    const diffLabel = diff === "easy" ? "Kolay" : diff === "hard" ? "Zor" : "Orta";
    const todayKey = getTodayKey();

    // Rekorlar — GÜNCELLEMEDEN ÖNCEKİ değerler.
    // "Tüm zamanlar rekoru" = genel en iyi (tüm zorluklar) — güvenilir referans.
    // "Bugünkü" = zorluk bazlı günlük en iyi.
    const prevOverall = challengeBest;
    const dailyValid = challengeDailyBest.date === todayKey;
    const prevToday = dailyValid ? (challengeDailyBest[diff] || 0) : 0;

    // Near-miss / motivasyon mesajı
    let nm = null;
    if (finalScore > 0) {
      if (finalScore > prevOverall) {
        nm = { tone: "record", text: t("near_record") + (prevOverall > 0 ? t("near_record_prev", { n: prevOverall }) : "") };
      } else if (prevOverall - finalScore <= 2 && prevOverall > 0) {
        nm = { tone: "close", text: t("near_close_past", { n: prevOverall - finalScore, best: prevOverall }) };
      } else if (finalScore > prevToday) {
        nm = { tone: "today", text: t("near_today_best", { diff: diffLabel }) + (prevOverall > 0 ? t("near_today_rec", { n: prevOverall }) : "") };
      } else if (prevToday - finalScore <= 2 && prevToday > 0) {
        nm = { tone: "close", text: t("near_close_today", { diff: diffLabel, prev: prevToday, n: prevToday - finalScore }) };
      } else {
        nm = { tone: "info", text: t("near_info", { diff: diffLabel, today: prevToday, best: prevOverall }) };
      }
    }
    setChallengeNearMiss(nm);

    // Zorluk bazlı rekorları kaydet
    const nextByDiff = { ...challengeBestByDiff, [diff]: Math.max(challengeBestByDiff[diff] || 0, finalScore) };
    setChallengeBestByDiff(nextByDiff);
    try { window.localStorage.setItem("pairfc_best_by_diff", JSON.stringify(nextByDiff)); } catch (e) {}
    const baseDaily = dailyValid ? challengeDailyBest : { date: todayKey, easy: 0, medium: 0, hard: 0 };
    const nextDaily = { ...baseDaily, date: todayKey, [diff]: Math.max(prevToday, finalScore) };
    setChallengeDailyBest(nextDaily);
    try { window.localStorage.setItem("pairfc_daily_best", JSON.stringify(nextDaily)); } catch (e) {}

    const nextBest = Math.max(challengeBest, finalScore);

    setChallengeLastScore(finalScore);
    setChallengeBest(nextBest);
    window.localStorage.setItem("footballChallengeBest", String(nextBest));
    track("challenge_finished", {
      score: finalScore,
      is_new_best: finalScore > challengeBest,
      duration_seconds: endTimer("challenge"),
      reason: reasonText ? "wrong_answer" : "timeout"
    });
    setChallengeScore(0);
    setChallengeRoundLocked(true);
    setChallengeShowAnswers(true);
    setChallengeRoundEndsAt(null);
    setChallengePreRoundEndsAt(null);
    setChallengeTimeLeft(0);
    setChallengeFocused(false);
    setChallengeLastAction({ type: "wrong", answer: reportAnswer });
    setChallengeFeedback("wrong");
    triggerScreenFlash("error");
    setTimeout(() => setChallengeFeedback(null), 600);
    if (reportAnswer) {
      setChallengeLastWrongReport({
        mode: "challenge",
        teamA: reportRound.teams[0],
        teamB: reportRound.teams[1],
        answer: reportAnswer,
        feedback: `${reasonText} Seri bitti. Üst üste doğru sayın: ${finalScore}.`,
        roomCode: null,
        playerName: playerName || "Oyuncu"
      });
      setChallengeReportStatus(null);
    }
    setChallengeMessage({
      type: "error",
      text: `${reasonText} Seri bitti. Doğru sayın: ${finalScore}.`
    });
  };

  useEffect(() => {
    if (screen !== "challenge" || challengeRoundLocked || !challengeRoundEndsAt) return;

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((challengeRoundEndsAt - Date.now()) / 1000));
      setChallengeTimeLeft(remaining);

      if (remaining <= 0) {
        endChallenge(t("time_over"));
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, challengeRoundLocked, challengeRoundEndsAt, challengeScore]);

  const updateChallengeInput = (value) => {
    if (!challengeCanAnswer) return;
    setChallengeInput(value);
    setChallengeFocused(true);
  };

  const selectChallengeSuggestion = (playerNameValue) => {
    if (!challengeCanAnswer) return;
    setChallengeInput(playerNameValue);
    setChallengeFocused(false);
  };

  // ===== JOKER: İlk Harf =====
  const useFirstLetterJoker = () => {
    if (challengeFirstLetterUsed) {
      setChallengeMessage({ type: "info", text: t("joker_first_used") });
      return;
    }
    if (challengeIsPreRound || challengeRoundLocked) {
      setChallengeMessage({ type: "info", text: t("joker_only_active") });
      return;
    }
    const first = challengeCorrectPlayers[0];
    if (!first) {
      setChallengeMessage({ type: "info", text: t("joker_no_hint") });
      return;
    }
    const parts = first.name.split(" ").filter(Boolean);
    const last = parts[parts.length - 1] || first.name;
    const hint = t("joker_first_hint", { first: first.name[0]?.toUpperCase() || "?", last: last[0]?.toUpperCase() || "?" });
    setChallengeFirstLetterUsed(true);
    setChallengeJokerHint(hint);
    setChallengeMessage({ type: "info", text: t("joker_hint", { hint }) });
    track("joker_used", { type: "firstLetter" });
  };

  // ===== JOKER: Çift Değiştir =====
  const useSwapPairJoker = () => {
    if (challengeSwapUsed) {
      setChallengeMessage({ type: "info", text: t("joker_swap_used") });
      return;
    }
    if (challengeIsPreRound || challengeRoundLocked) {
      setChallengeMessage({ type: "info", text: t("joker_only_active") });
      return;
    }
    const currentKey = getRoundKey(challengeRound);
    const nextUsed = [...challengeUsedRoundKeys, currentKey];
    const challengeAllowed = challengeMode === "custom" ? allowedTeamsSet : null;
    const result = getNextChallengeRound(nextUsed, challengeEffectiveDifficulty || challengeDifficulty, challengeAllowed);
    if (result.escalated) setChallengeEffectiveDifficulty(result.newDifficulty);
    setChallengeSwapUsed(true);
    setChallengeRound(result.round);
    setChallengeUsedRoundKeys(result.reset ? [getRoundKey(result.round)] : nextUsed);
    setChallengeInput("");
    setChallengeFocused(false);
    setChallengeRoundLocked(false);
    setChallengeShowAnswers(false);
    setChallengeRoundEndsAt(null);
    setChallengePreRoundEndsAt(Date.now() + ROUND_REVEAL_SECONDS * 1000);
    setChallengeTimeLeft(ROUND_SECONDS);
    setChallengePreRoundLeft(ROUND_REVEAL_SECONDS);
    setChallengeLastAction(null);
    setChallengeLastWrongReport(null);
    setChallengeReportStatus(null);
    setChallengeJokerHint(null);
    setChallengeMessage({ type: "info", text: t("joker_swap_done") });
    track("joker_used", { type: "swap" });
  };

  // ===== JOKER: Süre +5 =====
  const useTimeAddJoker = () => {
    if (challengeTimeAddUsed) {
      setChallengeMessage({ type: "info", text: t("joker_time_used") });
      return;
    }
    if (challengeIsPreRound || challengeRoundLocked || !challengeRoundEndsAt) {
      setChallengeMessage({ type: "info", text: t("joker_only_active") });
      return;
    }
    setChallengeTimeAddUsed(true);
    setChallengeRoundEndsAt((prev) => prev + 5000);
    setChallengeTimeLeft((prev) => prev + 5);
    setChallengeMessage({ type: "info", text: t("joker_time_added") });
    track("joker_used", { type: "timeAdd" });
  };

  const revealChallengeAnswerAndEnd = () => {
    const first = challengeCorrectPlayers[0];
    const reason = first
      ? `Cevap gösterildi. Örnek: ${first.name}.`
      : t("fallback_no_answer");

    endChallenge(reason, null, challengeRound);
    setChallengeShowAnswers(true);
    setChallengeMessage({
      type: "info",
      text: `${reason} Doğru sayın: ${challengeScore}.`
    });
  };

  const submitChallengeAnswer = () => {
    setChallengeFocused(false);

    if (challengeIsPreRound) {
      setChallengeMessage({ type: "info", text: t("err_teams_not_open") });
      return;
    }

    if (challengeRoundLocked) {
      setChallengeMessage({ type: "info", text: t("marathon_ended_msg") });
      return;
    }

    const raw = challengeInput;
    const normalized = normalizeText(raw);

    if (!normalized) {
      setChallengeMessage({ type: "error", text: t("err_type_player_first") });
      return;
    }

    logAnswerAttempt("maraton", challengeRound, raw);

    if (isCorrectAnswer(challengeRound, raw)) {
      const nextScore = challengeScore + 1;

      // Mikro-dopamin (gerçek veriden): nadir oyuncu / zor eşleşme / hızlı cevap
      const answerCount = getCorrectPlayersForRound(challengeRound).length;
      const matchedName = findAcceptedAnswer(challengeRound, raw);
      const playerFreq = matchedName ? (PLAYER_PAIR_FREQ.get(normalizeText(matchedName)) || 0) : 99;
      const answeredFast = challengeTimeLeft >= ROUND_SECONDS - 4;
      let bonus = null;
      if (playerFreq > 0 && playerFreq <= 2) bonus = { tier: "legendary", label: t("bonus_rare") };
      else if (answerCount > 0 && answerCount <= 3) bonus = { tier: "orange", label: t("bonus_hard") };
      else if (answeredFast) bonus = { tier: "blue", label: t("bonus_fast") };

      const challengeAllowed = challengeMode === "custom" ? allowedTeamsSet : null;
      const result = getNextChallengeRound(challengeUsedRoundKeys, challengeEffectiveDifficulty || challengeDifficulty, challengeAllowed);
      const nextKey = getRoundKey(result.round);
      let nextUsed = result.reset ? [nextKey] : [...challengeUsedRoundKeys, nextKey];

      // Zorluk yükseldi mi?
      let msg = t("gool_seri_detail", { n: nextScore });
      if (result.escalated) {
        msg = `🔥 ${DIFFICULTY_LABELS[challengeDifficulty]} eşleşmeler tükendi! ${result.escalatedLabel} zorluğa geçiliyor. Seri: ${nextScore}`;
        setChallengeEffectiveDifficulty(result.newDifficulty);
      }

      setChallengeScore(nextScore);
      setChallengeBest((currentBest) => {
        const nextBest = Math.max(currentBest, nextScore);
        window.localStorage.setItem("footballChallengeBest", String(nextBest));
        return nextBest;
      });
      setChallengeRound(result.round);
      setChallengeUsedRoundKeys(nextUsed);
      setChallengeInput("");
      setChallengeFocused(false);
      setChallengeRoundLocked(false);
      setChallengeShowAnswers(false);
      setChallengeRoundEndsAt(null);
      setChallengePreRoundEndsAt(Date.now() + ROUND_REVEAL_SECONDS * 1000);
      setChallengeTimeLeft(ROUND_SECONDS);
      setChallengePreRoundLeft(ROUND_REVEAL_SECONDS);
      setChallengeLastAction({ type: "correct", answer: raw });
      if (bonus && nextScore % 3 !== 0) setComboBurst({ ...bonus, key: Date.now() });
      setChallengeLastWrongReport(null);
      setChallengeReportStatus(null);
      setChallengeJokerHint(null);
      setChallengeFeedback("correct");
      triggerConfetti();
      triggerScreenFlash("success");
      setTimeout(() => setChallengeFeedback(null), 800);
      setChallengeMessage({ type: "success", text: msg });
      return;
    }

    endChallenge(getWrongAnswerExplanation(challengeRound, raw), raw, challengeRound);
  };

  const startRematch = async () => {
    const next = getRandomRound([], effectiveOnlineDifficulty, effectiveOnlineAllowedTeams) || { teams: ["Fenerbahçe", "Galatasaray"] };
    const nextState = {
      screen: "game",
      playerNames,
      playersReady: [false, false],
      opponentJoined: true, gameStarted: false,
      targetScore, scores: [0, 0],
      round: next,
      usedRoundKeys: [getRoundKey(next)],
      message: { type: "info", text: t("status_rematch_ready") },
      winner: null, showAnswers: false, roundLocked: false,
      roundEndsAt: null, preRoundEndsAt: null,
      wrongAttempts: [0, 0], lastAction: null,
      seriesWins, matchHistory
    };

    setScreen("game");
    setPlayersReady([false, false]);
    setGameStarted(false);
    setScores([0, 0]);
    setRound(next);
    setUsedRoundKeys([getRoundKey(next)]);
    setMessage(nextState.message);
    setWinner(null);
    setShowAnswers(false);
    setRoundLocked(false);
    setRoundEndsAt(null);
    setPreRoundEndsAt(null);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setCorrectRounds([]);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const reportAcceptedPlayer = (mode, reportRound, player) => {
    const report = {
      mode,
      teamA: reportRound.teams[0],
      teamB: reportRound.teams[1],
      answer: player.name,
      feedback: `${player.name} kabul edilen cevaplar listesinde görünüyor ama hatalı olabilir.`,
      roomCode: mode === "online" ? roomCode : null,
      playerName: playerName || "Oyuncu"
    };

    if (mode === "challenge") {
      submitAnswerReport(report, setChallengeReportStatus, () => {});
    } else {
      submitAnswerReport(report, setReportStatus, () => {});
    }
  };

  const submitAnswerReport = async (report, setStatus, clearReport) => {
    if (!report) return;

    if (!supabase) {
      setStatus({ type: "error", text: "Supabase bağlantısı yok. Bildirim kaydedilemedi." });
      return;
    }

    setStatus({ type: "info", text: t("status_report_sending") });

    const payload = {
      mode: report.mode,
      team_a: report.teamA,
      team_b: report.teamB,
      answer: report.answer,
      feedback: report.feedback,
      room_code: report.roomCode,
      player_name: report.playerName,
      page_url: window.location.href,
      user_agent: window.navigator.userAgent
    };

    const { error } = await supabase.from("answer_reports").insert(payload);

    if (error) {
      setStatus({ type: "error", text: t("status_report_failed", { error: error.message }) });
      return;
    }

    setStatus({ type: "success", text: t("status_report_thanks") });
    track("report_submitted", {
      mode: payload.mode || "unknown",
      team_a: payload.team_a || null,
      team_b: payload.team_b || null
    });
    clearReport();
  };

  const toggleSound = () => {
    setSoundEnabled((current) => {
      const next = !current;
      window.localStorage.setItem("footballGameMuted", next ? "false" : "true");
      if (next) {
        playGameSound("countdown");
      }
      track("sound_toggled", { new_state: next });
      return next;
    });
  };

  useEffect(() => {
    window.localStorage.setItem("footballGameMuted", soundEnabled ? "false" : "true");
  }, [soundEnabled]);

  const isHome = screen === "home";
  const isGameLike = screen === "game" || screen === "winner" || screen === "team_select";
  const isChallenge = screen === "challenge";
  const isDaily = screen === "daily";
  const isArena = screen === "arena";

  return (
    <div className={`app-shell ${isHome ? `home-screen home-tab-${mainTab}${showOnlineSetup ? " online-setup-open" : ""}` : "play-screen"}`}>
      {showOnboarding && <OnboardingOverlay onClose={dismissOnboarding} />}
      <style>{css}</style>

      {isOffline && (
        <div className="offline-bar" role="status">
          <span className="offline-bar-dot"></span>
          {t("offline_banner")}
        </div>
      )}

      {showSplash && (
        <div className="splash-screen">
          <div className="splash-content">
            <div className="splash-logo">
              <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="8" y="31" width="38" height="38" rx="10" fill="#9b2dff"/>
                <rect x="54" y="31" width="38" height="38" rx="10" fill="#f5a524"/>
                <rect x="39" y="39" width="22" height="22" rx="3.5" transform="rotate(45 50 50)" fill="#ffffff" stroke="#0e1022" strokeWidth="2.5"/>
              </svg>
            </div>
            <h1 className="splash-title">Pair<span className="brand-fc">FC</span></h1>
            <p className="splash-tagline">{t("tagline_short")}</p>
            <p className="splash-tagline-sub">{t("tagline_action")}</p>
            <div className="splash-loader"><span></span><span></span><span></span></div>
          </div>
        </div>
      )}

      {showInstallModal && (
        <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
          <div className="modal-content install-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setShowInstallModal(false)}>✕</button>
            <h2>{t("modal_install_title")}</h2>
            <p>{t("modal_install_intro")}</p>

            <div className="install-platform">
              <h3>{t("modal_install_ios")}</h3>
              <ol>
                <li dangerouslySetInnerHTML={{ __html: t("modal_ios_s1") + ' <span class="install-icon">⬆️</span>' }} />
                <li dangerouslySetInnerHTML={{ __html: t("modal_ios_s2") }} />
                <li dangerouslySetInnerHTML={{ __html: t("modal_ios_s3") }} />
              </ol>
            </div>

            <div className="install-platform">
              <h3>{t("modal_install_android")}</h3>
              <ol>
                <li dangerouslySetInnerHTML={{ __html: t("modal_and_s1") + ' <span class="install-icon">⋮</span>' }} />
                <li dangerouslySetInnerHTML={{ __html: t("modal_and_s2") }} />
                <li dangerouslySetInnerHTML={{ __html: t("modal_and_s3") }} />
              </ol>
            </div>

            <button type="button" onClick={() => setShowInstallModal(false)} className="primary-button big" style={{ width: "100%", marginTop: 12 }}>
              {t("btn_got_it")}
            </button>
            <div style={{ marginTop: 14, paddingTop: 14, textAlign: "center", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: 0.3 }}>
          <a href="/about.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_about")}</a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_privacy")}</a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_terms")}</a>
          <span style={{ opacity: 0.5 }}>·</span>
          <a href="/how-to-play.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 6px" }}>{t("footer_how")}</a>
        </div>
          </div>
        </div>
      )}

      <div className="app-frame">
        <header className={`topbar ${isHome ? "" : "topbar-compact"}`}>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="10" width="12" height="12" rx="3.2" fill="#9b2dff"/>
                <rect x="17" y="10" width="12" height="12" rx="3.2" fill="#f5a524"/>
                <rect x="12" y="12" width="8" height="8" rx="1.6" transform="rotate(45 16 16)" fill="#ffffff" stroke="#0e1022" strokeWidth="1"/>
              </svg>
            </span>
            <div className="brand-text">
              <strong>Pair<span className="brand-fc">FC</span></strong>
            </div>
          </div>
          <div className="topbar-actions">
            {/* Anasayfa butonu: aktif sayfa anasayfanın 'home' tab'ı DEĞİLSE göster.
                Yani leaderboard tab'ındayken de görünür (önceden gizleniyordu). */}
            {!(isHome && mainTab === "home") && (
              <button type="button" onClick={goToHome} className="icon-button home-button" aria-label={t("home_menu")} title={t("home_menu")}>
                🏠
              </button>
            )}
            <div ref={langMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setLangMenuOpen((o) => !o)}
                className="icon-button lang-switcher"
                aria-label={t("lang_switch_aria")}
                aria-haspopup="menu"
                aria-expanded={langMenuOpen}
                title={t("lang_switch_aria")}
                style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em" }}
              >
                {lang.toUpperCase()}
              </button>
              {langMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    background: "linear-gradient(160deg,#1d1430,#241a3e)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 14,
                    padding: 6,
                    minWidth: 160,
                    boxShadow: "0 14px 36px rgba(0,0,0,0.55)",
                    zIndex: 200
                  }}
                >
                  {SUPPORTED_LANGS.map((l) => {
                    const active = l.code === lang;
                    return (
                      <button
                        key={l.code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          if (l.code !== lang) {
                            track("language_changed", { from: lang, to: l.code });
                          }
                          setLang(l.code);
                          setLangMenuOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          padding: "10px 12px",
                          background: active ? "rgba(155,45,255,0.22)" : "transparent",
                          border: "none",
                          borderRadius: 10,
                          color: "#fff",
                          fontSize: 14,
                          fontWeight: 600,
                          textAlign: "left",
                          cursor: "pointer",
                          letterSpacing: "normal"
                        }}
                      >
                        <span style={{ fontSize: 18, lineHeight: 1 }}>{l.flag}</span>
                        <span style={{ flex: 1 }}>{l.label}</span>
                        {active && <span style={{ color: "#9b2dff", fontWeight: 800 }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button type="button" onClick={toggleSound} className="icon-button" aria-label={soundEnabled ? t("sound_off_label") : t("sound_on_label")} title={soundEnabled ? t("sound_on_status") : t("sound_off_status")}>
              {soundEnabled ? "🔊" : "🔇"}
            </button>
            {isPushSupported() && (
              <button
                type="button"
                onClick={toggleNotifications}
                className="icon-button"
                aria-label={pushOn ? t("notify_off_label") : t("notify_on_label")}
                title={pushOn ? t("notify_on_status") : t("notify_off_status")}
                style={pushOn ? {} : { opacity: 0.55 }}
              >
                {pushOn ? "🔔" : "🔕"}
              </button>
            )}
          </div>
        </header>

        <main className="app-main">
          {isHome && (
            <section className="home-content">
              {showOnlineSetup && (
                <div className="online-setup-header">
                  <button type="button" onClick={() => {
                    if (onlineSetupMode) {
                      setOnlineSetupMode(null);
                    } else {
                      setShowOnlineSetup(false);
                    }
                  }} className="back-button">
                    {t("btn_back")}
                  </button>
                  <div className="online-setup-title">
                    <h2>🌍 Düello</h2>
                    <p>Ayarları yap, sonra oda kur veya bir koda katıl.</p>
                  </div>
                </div>
              )}

              {!showOnlineSetup && (
              <>
              {mainTab === "home" && (<>
              {/* Belirgin slogan + örnek köprü — yeni kullanıcı için "ne bu oyun?" cevabı */}
              <div style={{ textAlign: "center", padding: "2px 16px 6px", margin: "0 auto" }}>
                <p style={{ margin: "0 0 3px", fontSize: 16, fontWeight: 800, letterSpacing: -0.01, color: "#fff", lineHeight: 1.3 }}>
                  {t("tagline_short")} <span style={{ color: "#f5a524" }}>{t("tagline_action")}</span>
                </p>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: 0.2 }}>
                  Chelsea <span style={{ color: "#f5a524", margin: "0 4px" }}>×</span> Real Madrid <span style={{ margin: "0 4px" }}>→</span> <span style={{ color: "#7ee0a3", fontWeight: 700 }}>Eden Hazard</span>
                </p>
              </div>

              {/* HERO — Challenge (Maraton) */}
              <button
                type="button"
                onClick={startChallenge}
                className="hero-card hero-card--challenge"
              >
                <div className="hero-card-glow" aria-hidden="true"></div>
                <div className="hero-card-content">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, opacity: 0.85 }}>
                      🔥 {t("mode_marathon_title")}
                    </span>
                    {challengeBest > 0 && (
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "#fcd34d", textShadow: "0 0 14px rgba(245,158,11,0.6)" }}>🏆 {challengeBest}</span>
                    )}
                  </div>
                  <div className="hero-card-eyebrow">
                    <span className="hero-card-eyebrow-text">{challengeHero.eyebrow}</span>
                  </div>
                  <h2 className="hero-card-title">{challengeHero.title}</h2>
                  <p className="hero-card-sub">{challengeHero.sub}</p>
                  <span className="hero-card-cta">
                    {challengeHero.cta}
                    <span className="hero-card-arrow">→</span>
                  </span>
                </div>
              </button>

              {/* FEATURED — Günlük Bulmaca (ikincil ama kimlikli) */}
              <button
                type="button"
                onClick={startDaily}
                className="featured-daily"
              >
                <div className="featured-daily-glow" aria-hidden="true"></div>
                <div className="featured-daily-content">
                  <div className="featured-daily-top">
                    <span className="featured-daily-meta">
                      📅 {dailyMeta.date} · {t("daily_label")} #{dailyMeta.num}
                    </span>
                    {dailyStreak > 0 && (
                      <span className="featured-daily-streak">🔥 {dailyStreak}</span>
                    )}
                  </div>
                  <div className="featured-daily-main">
                    <div className="featured-daily-text">
                      <strong>{heroConfig.done ? heroConfig.title : t("hero_title_today")}</strong>
                      <small>{heroConfig.done
                        ? (dailyCountdown ? t("hero_done_sub_countdown", { time: dailyCountdown }) : t("hero_done_sub_tomorrow"))
                        : t("daily_new")}</small>
                    </div>
                    {heroConfig.done && heroConfig.attempts.length > 0 ? (
                      <div className="featured-daily-grid" aria-hidden="true">
                        {heroConfig.attempts.map((r, i) => (
                          <span key={i}>{r === "correct" ? "🟩" : "🟥"}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="featured-daily-cta">
                        {heroConfig.done ? t("hero_done_cta") : t("hero_cta_today")}
                        <span className="featured-daily-arrow">→</span>
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* 2 secondary mode card (Online + Arena) */}
              <div className="mode-grid-secondary">
                {secondaryModes.map((m) => {
                  if (m === "arena") {
                    return (
                      <button key="arena" type="button" onClick={() => { setScreen("arena"); }} className="mode-card mode-card-secondary mode-card-arena">
                        <span className="mode-icon">🏟️</span>
                        <strong>Arena</strong>
                        <small>{t("mode_arena_subtitle")}</small>
                        <em className="best-badge arena-new-badge">{t("badge_new")}</em>
                      </button>
                    );
                  }
                  return (
                    <button key="online" type="button" onClick={() => { setShowOnlineSetup(true); setOnlineSetupMode(null); setDuelVariant(null); }} className="mode-card mode-card-secondary mode-card-online">
                      <span className="mode-icon">🌍</span>
                      <strong>{t("mode_duel_title")}</strong>
                      <small>{t("mode_duel_subtitle")}</small>
                      <em className="best-badge online-cta">{t("duel_create_room")}</em>
                    </button>
                  );
                })}
              </div>

              {!isInstalled && (
                <button type="button" onClick={triggerInstall} className="install-banner">
                  <span className="install-banner-icon">📲</span>
                  <div className="install-banner-text">
                    <strong>{t("install_app")}</strong>
                    <small>{t("install_subtitle")}</small>
                  </div>
                  <span className="install-banner-arrow">→</span>
                </button>
              )}

              {isPushSupported() && !pushOn && pushState === "default" && !pushBannerDismissed && (
                <div className="notify-banner">
                  <button type="button" onClick={enableNotifications} className="notify-banner-main">
                    <span className="notify-banner-icon">🔔</span>
                    <div className="notify-banner-text">
                      <strong>{t("notify_title")}</strong>
                      <small>{t("notify_subtitle")}</small>
                    </div>
                  </button>
                  <button type="button" onClick={dismissPushBanner} className="notify-banner-x" aria-label={t("notify_dismiss")}>×</button>
                </div>
              )}
              </>)}

              {mainTab === "leaderboard" && (
                <div className="leaderboard-page">
                  <div className="lb-header">
                    <h2>{t("lb_title")}</h2>
                    <p className="lb-subtitle">{t("lb_subtitle")}</p>
                  </div>

                  <div className="lb-filters">
                    <div className="lb-difficulty-tabs">
                      {[
                        { key: "easy", label: t("diff_easy"), emoji: "🟢" },
                        { key: "medium", label: t("diff_medium"), emoji: "🟡" },
                        { key: "hard", label: t("diff_hard"), emoji: "🔴" }
                      ].map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          className={`lb-tab ${lbDifficulty === d.key ? "active" : ""}`}
                          onClick={() => setLbDifficulty(d.key)}
                        >
                          {d.emoji} {d.label}
                        </button>
                      ))}
                    </div>
                    <div className="lb-period-toggle">
                      <button
                        type="button"
                        className={`lb-period-btn ${lbPeriod === "today" ? "active" : ""}`}
                        onClick={() => setLbPeriod("today")}
                      >{t("lb_period_today")}</button>
                      <button
                        type="button"
                        className={`lb-period-btn ${lbPeriod === "alltime" ? "active" : ""}`}
                        onClick={() => setLbPeriod("alltime")}
                      >{t("lb_period_alltime")}</button>
                    </div>
                  </div>

                  {lbLoading ? (
                    <div className="lb-loading">{t("lb_loading")}</div>
                  ) : lbData.length === 0 ? (
                    <div className="lb-empty">
                      <span className="lb-empty-icon">🏟️</span>
                      <p>{t("lb_empty")}</p>
                    </div>
                  ) : (
                    <div className="lb-list">
                      {lbData.map((entry, i) => (
                        <div key={entry.id} className={`lb-row ${i < 3 ? "lb-row-top" : ""}`}>
                          <span className="lb-rank">
                            {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                          </span>
                          <span className="lb-name">{entry.player_name}</span>
                          <strong className="lb-score">{entry.score}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}


              {/* Alt tab bar — her zaman görünür */}
              <div className="bottom-tab-bar">
                <button
                  type="button"
                  className={`tab-btn ${mainTab === "home" ? "tab-active" : ""}`}
                  onClick={() => setMainTab("home")}
                >
                  <span className="tab-icon">🏠</span>
                  <span className="tab-label">{t("tab_home")}</span>
                </button>
                <button
                  type="button"
                  className={`tab-btn ${mainTab === "leaderboard" ? "tab-active" : ""}`}
                  onClick={() => {
                    setMainTab("leaderboard");
                    track("leaderboard_viewed", { difficulty: lbDifficulty, period: lbPeriod });
                  }}
                >
                  <span className="tab-icon">🏆</span>
                  <span className="tab-label">{t("tab_leaderboard")}</span>
                </button>
              </div>

              {/* Yasal sayfa linkleri — en altta, her tab'ta görünür */}
              <div style={{ marginTop: 8, paddingTop: 8, paddingBottom: 4, textAlign: "center", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: 0.3 }}>
                <a href="/about.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 8px" }}>{t("footer_about")}</a>
                <span style={{ opacity: 0.5 }}>·</span>
                <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 8px" }}>{t("footer_privacy")}</a>
                <span style={{ opacity: 0.5 }}>·</span>
                <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 8px" }}>{t("footer_terms")}</a>
                <span style={{ opacity: 0.5 }}>·</span>
                <a href="/how-to-play.html" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", margin: "0 8px" }}>{t("footer_how")}</a>
              </div>
              </>
              )}

              {showOnlineSetup && (
              <>
              {!duelVariant && (
                <div className="online-mode-picker">
                  <button type="button" onClick={() => setDuelVariant("auto")} className="online-action-card create">
                    <span className="online-action-icon">⚡</span>
                    <strong>{t("duel_variant_auto")}</strong>
                    <small>{t("duel_variant_auto_sub")}</small>
                    <span className="online-action-arrow">→</span>
                  </button>
                  <button type="button" onClick={() => setDuelVariant("strategic")} className="online-action-card join">
                    <span className="online-action-icon">🎯</span>
                    <strong>{t("duel_variant_strategic")}</strong>
                    <small>{t("duel_variant_strategic_sub")}</small>
                    <span className="online-action-arrow">→</span>
                  </button>
                </div>
              )}
              {duelVariant && !onlineSetupMode && (
                <div className="online-mode-picker">
                  <button type="button" onClick={() => setOnlineSetupMode("create")} className="online-action-card create">
                    <span className="online-action-icon">✨</span>
                    <strong>{t("online_create_title")}</strong>
                    <small>{t("online_create_sub")}</small>
                    <span className="online-action-arrow">→</span>
                  </button>
                  <button type="button" onClick={() => setOnlineSetupMode("join")} className="online-action-card join">
                    <span className="online-action-icon">🔗</span>
                    <strong>{t("online_join_title")}</strong>
                    <small>{t("online_join_sub")}</small>
                    <span className="online-action-arrow">→</span>
                  </button>
                </div>
              )}

              {onlineSetupMode === "create" && (
                <div className="online-form">
                  <div className="input-card">
                    <label htmlFor="playerNameInput">{t("form_player_name")}</label>
                    <input
                      id="playerNameInput"
                      value={playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder={t("form_name_placeholder")}
                      maxLength={20}
                    />
                  </div>

                  <div className="input-card">
                    <label>{t("form_end_score")}</label>
                    <div className="score-options">
                      {[3, 5, 7].map((score) => (
                        <button
                          key={score}
                          type="button"
                          onClick={() => setTargetScore(score)}
                          className={targetScore === score ? "score-option active" : "score-option"}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Eşleşme tipi sekmeleri — Zorluk Seç vs Özel Mod */}
                  <div className="input-card">
                    <label>{t("match_type_label")}</label>
                    <div className="match-mode-tabs">
                      <button
                        type="button"
                        onClick={() => persistOnlineMatchMode("difficulty")}
                        className={`match-mode-tab ${onlineMatchMode === "difficulty" ? "active" : ""}`}
                      >
                        {t("match_type_difficulty")}
                      </button>
                      <button
                        type="button"
                        onClick={() => persistOnlineMatchMode("custom")}
                        className={`match-mode-tab ${onlineMatchMode === "custom" ? "active" : ""}`}
                      >
                        {t("match_type_custom")}
                      </button>
                    </div>
                    <small className="match-mode-hint">
                      {onlineMatchMode === "difficulty"
                        ? t("match_type_difficulty_hint_duel")
                        : t("match_type_custom_hint_duel")}
                    </small>
                  </div>

                  {/* Zorluk Seç sekmesi — sadece auto modda zorluk seçimi var */}
                  {onlineMatchMode === "difficulty" && duelVariant !== "strategic" && (
                    <div className="input-card">
                      <label>{t("form_difficulty_label")}</label>
                      <div className="score-options">
                        {[
                          { v: "easy", label: t("form_diff_easy") },
                          { v: "medium", label: t("form_diff_medium") },
                          { v: "hard", label: t("form_diff_hard") }
                        ].map((opt) => (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={() => setOnlineDifficulty(opt.v)}
                            className={onlineDifficulty === opt.v ? "score-option active" : "score-option"}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Özel Mod sekmesi — lig filtresi */}
                  {onlineMatchMode === "custom" && (
                    <div className="input-card">
                      <LeagueFilter
                        selectedLeagues={selectedLeagues}
                        onChange={persistLeagues}
                      />
                    </div>
                  )}

                  <button type="button" onClick={createRoom} className="primary-button big full-width">
                    {t("btn_create_room")}
                  </button>
                </div>
              )}

              {onlineSetupMode === "join" && (
                <div className="online-form">
                  <div className="input-card">
                    <label htmlFor="playerNameInput2">{t("form_player_name")}</label>
                    <input
                      id="playerNameInput2"
                      value={playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder={t("form_name_placeholder")}
                      maxLength={20}
                    />
                  </div>

                  <div className="input-card">
                    <label htmlFor="roomCodeInput">{t("form_room_code")}</label>
                    <input
                      id="roomCodeInput"
                      value={roomInput}
                      onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
                      placeholder={t("form_room_placeholder")}
                      maxLength={6}
                      style={{ textTransform: "uppercase", letterSpacing: 4, fontSize: 18, fontWeight: 800, textAlign: "center" }}
                    />
                  </div>

                  <button type="button" onClick={joinRoom} className="primary-button big full-width">
                    {t("btn_join_room")}
                  </button>
                </div>
              )}

              {!supabase && (
                <div className="setup-warning">
                  Supabase bağlantısı yok. <strong>.env.local</strong> kontrol et.
                </div>
              )}

              <StatusMessage message={message} />
              </>
              )}
            </section>
          )}

          {isChallenge && (
            <section className="play-content">
              {showChallengeStartScreen ? (
                <div className="panel difficulty-picker">
                  {/* Mod picker — iki yol seçimi */}
                  {challengeMode === null && (
                    <>
                      <div className="difficulty-header">
                        <h2>🔥 {t("mode_marathon_title")}</h2>
                        <p>{t("challenge_mode_picker_question")}</p>
                      </div>
                      <div className="difficulty-options">
                        <button
                          type="button"
                          onClick={() => setChallengeMode("difficulty")}
                          className="difficulty-card mode-card-pick"
                        >
                          <span className="difficulty-emoji">🎯</span>
                          <strong>{t("challenge_mode_difficulty")}</strong>
                          <small>{t("challenge_mode_difficulty_desc")}</small>
                        </button>
                        <button
                          type="button"
                          onClick={() => setChallengeMode("custom")}
                          className="difficulty-card mode-card-pick"
                        >
                          <span className="difficulty-emoji">🏆</span>
                          <strong>{t("challenge_mode_custom")}</strong>
                          <small>{t("challenge_mode_custom_desc")}</small>
                        </button>
                      </div>
                    </>
                  )}

                  {/* Zorluk seçim ekranı */}
                  {challengeMode === "difficulty" && (
                    <>
                      <div className="difficulty-header">
                        <button
                          type="button"
                          onClick={() => setChallengeMode(null)}
                          className="picker-back"
                          aria-label={t("aria_back")}
                        >{t("btn_back")}</button>
                        <h2>{t("match_type_difficulty")}</h2>
                        <p>{t("marathon_choose_difficulty")}</p>
                      </div>
                      <div className="difficulty-options">
                        <button type="button" onClick={() => confirmStartChallenge("difficulty", "easy")} className="difficulty-card easy">
                          <span className="difficulty-emoji">🟢</span>
                          <strong>{t("diff_easy")}</strong>
                          <small>{t("diff_easy_desc")}</small>
                          <em>{t("diff_easy_examples")}</em>
                        </button>
                        <button type="button" onClick={() => confirmStartChallenge("difficulty", "medium")} className="difficulty-card medium">
                          <span className="difficulty-emoji">🟡</span>
                          <strong>{t("diff_medium")}</strong>
                          <small>{t("diff_medium_desc")}</small>
                          <em>{t("diff_medium_examples")}</em>
                        </button>
                        <button type="button" onClick={() => confirmStartChallenge("difficulty", "hard")} className="difficulty-card hard">
                          <span className="difficulty-emoji">🔴</span>
                          <strong>{t("diff_hard")}</strong>
                          <small>{t("diff_hard_desc")}</small>
                          <em>{t("diff_hard_examples", { n: Object.keys(TEAM_LOGOS).length })}</em>
                        </button>
                      </div>
                    </>
                  )}

                  {/* Özel mod: lig filtresi */}
                  {challengeMode === "custom" && (() => {
                    const allowed = buildAllowedTeams(selectedLeagues);
                    const matchCount = allowed
                      ? WEIGHTED_TEAM_PAIRS.filter((p) => pairAllowed(p, allowed)).length
                      : WEIGHTED_TEAM_PAIRS.length;
                    const canStart = matchCount >= 2;
                    return (
                      <>
                        <div className="difficulty-header">
                          <button
                            type="button"
                            onClick={() => setChallengeMode(null)}
                            className="picker-back"
                            aria-label={t("aria_back")}
                          >{t("btn_back")}</button>
                          <h2>🏆 Özel Mod</h2>
                          <p>Oynamak istediğin ligleri seç. Boş bırakırsan tümü.</p>
                        </div>
                        <LeagueFilter
                          selectedLeagues={selectedLeagues}
                          onChange={persistLeagues}
                        />
                        <button
                          type="button"
                          onClick={() => confirmStartChallenge("custom", "hard")}
                          disabled={!canStart}
                          className="primary-button big full-width"
                          style={{ marginTop: 4 }}
                        >
                          {canStart ? t("challenge_start_btn", { n: matchCount }) : t("challenge_not_enough_matches")}
                        </button>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <>
              <div className="info-bar challenge-bar">
                <div className="info-chip">
                  <span>{t("info_mode")}</span><strong>{t("mode_marathon_title")}</strong>
                </div>
                <div className="info-chip">
                  <span>{t("info_difficulty")}</span><strong>
                    {challengeMode === "custom"
                      ? t("challenge_custom_chip")
                      : `${getDifficultyEmoji(challengeDifficulty)} ${getDifficultyLabel(challengeDifficulty)}`}
                  </strong>
                </div>
                <div className={`info-chip accent ${challengeScore >= 3 ? "on-fire" : ""} ${challengeScore >= 9 ? "fire-high" : ""}`}>
                  <span>{challengeScore >= 3 ? t("info_streak_hot") : t("info_streak")}</span><strong className={challengeFeedback === "correct" ? "score-pop" : ""}>{challengeScore}</strong>
                </div>
                <div className="info-chip">
                  <span>{t("info_best")}</span><strong>{challengeBest}</strong>
                </div>
              </div>

              {comboBurst && (
                <div key={comboBurst.key} className={`combo-burst combo-burst--${comboBurst.tier}`} aria-hidden="true">
                  {comboBurst.label}
                </div>
              )}

              {challengeIsPreRound ? (
                <div className="panel waiting-panel">
                  <div className="countdown-circle">{challengePreRoundLeft}</div>
                  <h2>{t("marathon_teams_opening")}</h2>
                  <p>{t("marathon_get_ready")}</p>
                </div>
              ) : (
                <div className={`play-panel ${challengeFeedback === "correct" ? "feedback-correct" : ""} ${challengeFeedback === "wrong" ? "feedback-wrong" : ""}`}>
                  <div className="play-header">
                    <CircularTimer value={challengeTimeLeft} max={ROUND_SECONDS} urgent={challengeTimeLeft <= 3 && !challengeRoundLocked} />
                    <div className="play-tools">
                      <div className="joker-buttons">
                        <button type="button" className="joker-button" onClick={useFirstLetterJoker} disabled={!challengeCanAnswer || challengeFirstLetterUsed} title={t("joker_first_letter")}>
                          <span className="joker-icon">🎯</span>
                          <span className="joker-label">{t("joker_first_letter")}</span>
                        </button>
                        <button type="button" className="joker-button" onClick={useSwapPairJoker} disabled={!challengeCanAnswer || challengeSwapUsed} title={t("joker_swap_pair")}>
                          <span className="joker-icon">🔄</span>
                          <span className="joker-label">{t("joker_swap_pair")}</span>
                        </button>
                        <button type="button" className="joker-button" onClick={useTimeAddJoker} disabled={!challengeCanAnswer || challengeTimeAddUsed} title={t("joker_time_tooltip")}>
                          <span className="joker-icon">⏱️</span>
                          <span className="joker-label">{t("joker_time_label")}</span>
                        </button>
                      </div>
                      <button type="button" className="light-button skip-button" onClick={revealChallengeAnswerAndEnd} disabled={challengeIsPreRound || challengeRoundLocked}>
                        {t("btn_dont_know")}
                      </button>
                    </div>
                  </div>

                  {challengeJokerHint && (
                    <div className="joker-hint">🃏 {challengeJokerHint}</div>
                  )}

                  <div className="teams-grid">
                    <div className="team-card">
                      <TeamLogo teamName={challengeRound.teams[0]} />
                      <strong>{challengeRound.teams[0]}</strong>
                    </div>
                    <div className="versus">VS</div>
                    <div className="team-card">
                      <TeamLogo teamName={challengeRound.teams[1]} />
                      <strong>{challengeRound.teams[1]}</strong>
                    </div>
                  </div>

                  {challengeRoundLocked ? (
                    <ChallengeGameOver
                      score={challengeLastScore ?? 0}
                      best={challengeBest}
                      nearMiss={challengeNearMiss}
                      isNewBest={(challengeLastScore ?? 0) >= challengeBest && (challengeLastScore ?? 0) > 0}
                      lastWrongAnswer={challengeLastAction?.type === "wrong" ? challengeLastAction.answer : null}
                      correctPlayers={challengeCorrectPlayers}
                      teamA={challengeRound.teams[0]}
                      teamB={challengeRound.teams[1]}
                      wrongReport={challengeLastWrongReport}
                      reportStatus={challengeReportStatus}
                      onSubmitWrongReport={() =>
                        submitAnswerReport(challengeLastWrongReport, setChallengeReportStatus, () => setChallengeLastWrongReport(null))
                      }
                      onReportAcceptedPlayer={(player) => reportAcceptedPlayer("challenge", challengeRound, player)}
                      onRestart={() => {
                        // Mevcut mod + zorlukla yeni maratonu direkt başlat.
                        // Zorluk picker'ına dönmek istemiyorsak — kullanıcının
                        // tercihi sürer. Mod seçici ekrana dönmek isterse
                        // "Geri" butonundan yapabilir.
                        if (challengeMode && challengeDifficulty) {
                          confirmStartChallenge(challengeMode, challengeDifficulty);
                        } else {
                          startChallenge();
                        }
                      }}
                      onSaveScore={handleSaveScore}
                      scoreSaved={scoreSaved}
                      playerName={lbPlayerName}
                      onPlayerNameChange={setLbPlayerName}
                      difficulty={challengeDifficulty}
                      onShare={() => {
                        const diffLabel = challengeDifficulty === "easy" ? t("diff_easy") : challengeDifficulty === "hard" ? t("diff_hard") : t("diff_medium");
                        const failedKey = getRoundKey(challengeRound);
                        const matchups = challengeUsedRoundKeys
                          .filter((k) => k !== failedKey)
                          .slice(-3)
                          .map((k) => k.split("|"));
                        shareScoreImage({
                          score: challengeLastScore ?? 0,
                          best: challengeBest,
                          diffLabel,
                          isNewBest: (challengeLastScore ?? 0) >= challengeBest && (challengeLastScore ?? 0) > 0,
                          matchups
                        }).then((result) => {
                          try { track("challenge_shared", { score: challengeLastScore ?? 0, has_image: !!result?.hasImage }); } catch (e) {}
                        });
                      }}
                    />
                  ) : (
                    <>
                      {challengeLastAction && challengeLastAction.type === "correct" && (
                        <div className="action-banner success">
                          <span className="action-emoji">⚽</span>
                          <strong>{t("goal_banner")}</strong>
                        </div>
                      )}

                      <div className="answer-card">
                        <div className="answer-row">
                          <div className="autocomplete-wrap">
                            <input
                              value={challengeInput}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              enterKeyHint="search"
                              disabled={!challengeCanAnswer}
                              onFocus={() => {
                                if (challengeCanAnswer && challengeInput) setChallengeFocused(true);
                              }}
                              onBlur={() => setTimeout(() => setChallengeFocused(false), 120)}
                              onChange={(event) => updateChallengeInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") submitChallengeAnswer();
                              }}
                              placeholder={t("input_placeholder_player")}
                            />

                            {challengeCanAnswer && challengeFocused && challengeSuggestions.length > 0 && (
                              <div className="suggestions">
                                {challengeSuggestions.map((player) => (
                                  <button
                                    key={player.name}
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      selectChallengeSuggestion(player.name);
                                    }}
                                    onClick={() => selectChallengeSuggestion(player.name)}
                                  >
                                    {player.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={!challengeCanAnswer}
                            onClick={submitChallengeAnswer}
                            className="primary-button"
                          >
                            {t("btn_check")}
                          </button>
                        </div>
                      </div>

                      <StatusMessage message={challengeMessage} />
                    </>
                  )}
                </div>
              )}
                </>
              )}
            </section>
          )}

          {isDaily && (
            <section className="play-content">
              <div className="info-bar">
                <div className="info-chip">
                  <span>📅 {t("daily_chip")}</span>
                </div>
                {!dailyDone && dailyData && (
                  <div className="info-chip">
                    <span>{t("daily_puzzle_label")}</span>
                    <strong>{dailyIndex + 1} / {dailyData.puzzles.length}</strong>
                  </div>
                )}
                {!dailyDone && dailyData && dailyData.puzzles[dailyIndex] && (
                  <div className="info-chip">
                    <span>
                      {["", t("difficulty_warmup"), t("difficulty_heating"), t("difficulty_final")][dailyData.puzzles[dailyIndex].difficulty] || "⭐"}
                    </span>
                  </div>
                )}
                {dailyStreak > 0 && (
                  <div className="info-chip">
                    <span>{t("daily_streak_chip")}</span>
                    <strong>{dailyStreak}</strong>
                  </div>
                )}
              </div>

              {!dailyData && (
                <div className="panel">
                  <p>{t("daily_loading")}</p>
                </div>
              )}

              {dailyData && !dailyDone && dailyData.puzzles[dailyIndex] && (
                <div className={`play-panel ${dailyFeedback === "correct" ? "feedback-correct" : ""} ${dailyFeedback === "wrong" ? "feedback-wrong" : ""}`}>
                  <div className="play-header daily-header">
                    <div className="daily-progress-dots">
                      {dailyData.puzzles.map((_, i) => {
                        const r = dailyResults[i];
                        return (
                          <span
                            key={i}
                            className={`daily-dot ${i === dailyIndex ? "current" : ""} ${r === "correct" ? "correct" : ""} ${r === "failed" ? "failed" : ""} ${i === dailyData.puzzles.length - 1 ? "final" : ""}`}
                          />
                        );
                      })}
                    </div>
                    <div className="daily-wrong-meter">
                      <span>{t("daily_wrong_meter")}</span>
                      <strong className={dailyWrongCount >= 2 ? "danger" : ""}>{3 - dailyWrongCount}</strong>
                    </div>
                  </div>

                  <div className="teams-grid">
                    <div className="team-card">
                      <TeamLogo teamName={dailyData.puzzles[dailyIndex].teams[0]} />
                      <strong>{dailyData.puzzles[dailyIndex].teams[0]}</strong>
                    </div>
                    <div className="versus">VS</div>
                    <div className="team-card">
                      <TeamLogo teamName={dailyData.puzzles[dailyIndex].teams[1]} />
                      <strong>{dailyData.puzzles[dailyIndex].teams[1]}</strong>
                    </div>
                  </div>

                  {!dailyShowAnswers ? (
                    <div className="answer-card">
                      <div className="answer-row">
                        <div className="autocomplete-wrap">
                          <input
                            value={dailyInput}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            enterKeyHint="search"
                            onFocus={() => { if (dailyInput) setDailyFocused(true); }}
                            onBlur={() => setTimeout(() => setDailyFocused(false), 120)}
                            onChange={(event) => updateDailyInput(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") submitDailyAnswer(); }}
                            placeholder={t("input_placeholder_player")}
                          />
                          {dailyFocused && dailySuggestions.length > 0 && (
                            <div className="suggestions">
                              {dailySuggestions.map((player) => (
                                <button
                                  key={player.name}
                                  type="button"
                                  onMouseDown={(e) => { e.preventDefault(); selectDailySuggestion(player.name); }}
                                  onClick={() => selectDailySuggestion(player.name)}
                                >
                                  {player.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button type="button" onClick={submitDailyAnswer} className="primary-button">
                          {t("btn_check")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="action-banner error">
                      <span className="action-emoji">❌</span>
                      <strong>{t("daily_3wrong")}</strong>
                    </div>
                  )}

                  <StatusMessage message={dailyMessage} />

                  {!dailyShowAnswers && (
                    <button type="button" onClick={skipDailyPuzzle} className="light-button compact daily-skip">
                      {t("btn_skip")}
                    </button>
                  )}
                </div>
              )}

              {dailyDone && dailyData && (
                <div className="challenge-gameover">
                  <div className="gameover-header">
                    <div className="gameover-icon trophy">📅</div>
                    <div className="gameover-headline">
                      <h3>{dailyResults.filter((r) => r === "correct").length === dailyData.puzzles.length ? t("daily_perfect") : (dailyHistory[dailyData.date]?.completed ? t("daily_today_finished") : t("daily_complete"))}</h3>
                      <p className="gameover-detail">{new Intl.DateTimeFormat(LOCALE_TAGS[lang] || "tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(dailyData.date))}</p>
                    </div>
                  </div>

                  <div className="gameover-stats">
                    <div className="gameover-stat">
                      <span>{t("stat_correct")}</span>
                      <strong>{dailyResults.filter((r) => r === "correct").length} / {dailyData.puzzles.length}</strong>
                    </div>
                    <div className="gameover-stat highlight">
                      <span>{t("daily_streak_chip")}</span>
                      <strong>{dailyStreak}</strong>
                    </div>
                  </div>

                  <div className="gameover-section">
                    <span className="gameover-label">{t("daily_grid_label")}</span>
                    <div className="daily-grid-emoji">
                      {dailyResults.map((r, i) => (
                        <span key={i}>{r === "correct" ? "🟩" : "🟥"}</span>
                      ))}
                    </div>
                  </div>

                  <button type="button" onClick={shareDailyResult} className="primary-button big daily-share-button">
                    {t("daily_share_button")}
                  </button>

                  <StatusMessage message={dailyShareStatus} />

                  <div className="gameover-section daily-countdown-box">
                    <span className="gameover-label">{t("daily_countdown_label")}</span>
                    <strong className="daily-countdown-value">{dailyCountdown}</strong>
                  </div>

                  {!isInstalled && showInstallNudge && !showInstallModal && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "rgba(170,59,255,0.12)", border: "1px solid rgba(170,59,255,0.35)", color: "#fff" }}>
                      <span style={{ fontSize: 24 }}>📲</span>
                      <div style={{ flex: 1, textAlign: "left", lineHeight: 1.3 }}>
                        <strong style={{ display: "block", fontSize: 14.5, color: "#fff" }}>
                          {dailyStreak >= 2 ? t("install_nudge_streak", { n: dailyStreak }) : t("install_nudge_tomorrow")}
                        </strong>
                        <small style={{ color: "rgba(255,255,255,0.6)", fontSize: 12.5 }}>{t("install_nudge_sub")}</small>
                      </div>
                      <button
                        type="button"
                        onClick={() => { try { track("install_nudge_accepted"); } catch (e) {} triggerInstall(); }}
                        style={{ padding: "9px 14px", borderRadius: 12, border: "none", background: "#aa3bff", color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {t("btn_add")}
                      </button>
                      <button
                        type="button"
                        onClick={dismissInstallNudge}
                        aria-label={t("btn_close")}
                        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer", padding: 4 }}
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  <button type="button" onClick={goToHome} className="light-button big">
                    🏠 {t("home_menu")}
                  </button>
                </div>
              )}
            </section>
          )}

          {isArena && (
            <section className="play-content arena-section">
              <Arena
                supabase={supabase}
                onExit={() => {
                  setScreen("home");
                  setMainTab("home");
                }}
                selectedLeagues={selectedLeagues}
                onLeaguesChange={persistLeagues}
              />
            </section>
          )}

          {isGameLike && (
            <section className="play-content">
              <div className="info-bar">
                <div className="info-chip">
                  <span>{t("online_room")}</span><strong>{roomCode}</strong>
                </div>
                <div className={`info-chip status-${connectionStatus}`}>
                  <span className="status-dot" aria-hidden="true"></span>
                  <strong>{connectionStatus === "online" ? "Online" : t("online_connecting")}</strong>
                </div>
                <div className="info-chip">
                  <span>{t("online_target")}</span><strong>{targetScore}</strong>
                </div>
                {/* Eşleşme tipi göstergesi — host'un seçtiği mod + difficulty veya ligler.
                    Guest STATE_SYNC'ten alıyor, böylece neyle oynadığını biliyor. */}
                <div
                  className="info-chip"
                  style={
                    onlineMatchMode === "custom"
                      ? { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.45)" }
                      : null
                  }
                  title={
                    onlineMatchMode === "custom" && selectedLeagues.length > 0
                      ? selectedLeagues.join(", ")
                      : undefined
                  }
                >
                  {onlineMatchMode === "custom" ? (
                    <>
                      <span>🏆</span>
                      <strong>
                        {selectedLeagues.length === 0
                          ? t("league_filter_all")
                          : selectedLeagues.length <= 2
                          ? selectedLeagues.join(" + ")
                          : t("league_filter_n_selected", { n: selectedLeagues.length })}
                      </strong>
                    </>
                  ) : (
                    <>
                      <span>{getDifficultyEmoji(onlineDifficulty)}</span>
                      <strong>{getDifficultyLabel(onlineDifficulty)}</strong>
                    </>
                  )}
                </div>
                {duelVariant === "strategic" && (
                  <div className="info-chip" style={{ background: "rgba(155,45,255,0.15)", border: "1px solid rgba(155,45,255,0.45)" }}>
                    <span>🎯</span><strong>{t("duel_variant_strategic")}</strong>
                  </div>
                )}
                <button type="button" onClick={copyInvite} className="mini-button">📋 Link</button>
              </div>

              <div className="score-bar">
                <div className={`score-side ${playerIndex === 0 ? "me" : ""} ${winner === 0 ? "winner" : ""} ${scoreFlash[0] === "gain" ? "flash-gain" : ""}`}>
                  <span className="score-name">{playerNames[0]}</span>
                  <strong className="score-value">{scores[0]}</strong>
                  <em className="score-meta">{t("online_series_meta", { n: seriesWins[0] })}</em>
                </div>
                <div className="score-vs">vs</div>
                <div className={`score-side ${playerIndex === 1 ? "me" : ""} ${winner === 1 ? "winner" : ""} ${scoreFlash[1] === "gain" ? "flash-gain" : ""}`}>
                  <span className="score-name">{playerNames[1]}</span>
                  <strong className="score-value">{scores[1]}</strong>
                  <em className="score-meta">{t("online_series_meta", { n: seriesWins[1] })}</em>
                </div>
              </div>

              {screen === "team_select" && (
                <div className="panel" style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#fff" }}>{t("ts_title")}</h2>
                      <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.65)" }}>{t("ts_subtitle")}</p>
                    </div>
                    <div style={{ minWidth: 70, padding: "8px 12px", borderRadius: 14, background: "rgba(155, 45, 255, 0.18)", border: "1px solid rgba(155, 45, 255, 0.5)", textAlign: "center" }}>
                      <strong style={{ display: "block", fontSize: 22, fontWeight: 800, color: "#fff" }}>{teamSelectLeft}</strong>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>{t("timer_seconds")}</span>
                    </div>
                  </div>

                  {/* Pick durumu */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 14, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{t("ts_my_pick")}</div>
                      <strong style={{ display: "block", fontSize: 15, color: teamPicks[playerIndex] ? "#7ee0a3" : "rgba(255,255,255,0.4)", marginTop: 4 }}>
                        {teamPicks[playerIndex] || t("ts_no_pick")}
                      </strong>
                    </div>
                    <div style={{ width: 1, background: "rgba(255,255,255,0.1)" }} />
                    <div style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{t("ts_opp_pick")}</div>
                      <strong style={{ display: "block", fontSize: 15, color: teamPicks[1 - playerIndex] ? "#7ee0a3" : "rgba(255,255,255,0.4)", marginTop: 4 }}>
                        {teamPicks[1 - playerIndex] ? t("ts_picked_check") : t("ts_waiting")}
                      </strong>
                    </div>
                  </div>

                  {teamPicks[0] && teamPicks[1] ? (
                    <div style={{ padding: "16px 12px", textAlign: "center", borderRadius: 14, background: "rgba(46, 204, 113, 0.12)", border: "1px solid rgba(46, 204, 113, 0.4)", color: "#7ee0a3", fontWeight: 700 }}>
                      {t("ts_round_starting")}
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={teamSearch}
                        onChange={(e) => setTeamSearch(e.target.value)}
                        placeholder={t("ts_search")}
                        disabled={Boolean(teamPicks[playerIndex])}
                        style={{ width: "100%", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 14, marginBottom: 10, boxSizing: "border-box" }}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))", gap: 6, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                        {Object.keys(TEAM_LOGOS)
                          .filter((tn) => !effectiveOnlineAllowedTeams || effectiveOnlineAllowedTeams.has(tn))
                          .filter((tn) => !teamSearch || tn.toLowerCase().includes(teamSearch.toLowerCase()))
                          .map((tn) => {
                            const meta = TEAM_LOGOS[tn];
                            const picked = teamPicks[playerIndex] === tn;
                            return (
                              <button
                                key={tn}
                                type="button"
                                onClick={() => pickTeam(tn)}
                                disabled={Boolean(teamPicks[playerIndex])}
                                title={tn}
                                style={{
                                  position: "relative",
                                  padding: "8px 4px 6px",
                                  borderRadius: 10,
                                  border: picked ? "2px solid #7ee0a3" : "1px solid rgba(255,255,255,0.08)",
                                  background: meta?.primary || "#2a2a3a",
                                  color: meta?.secondary || "#fff",
                                  cursor: teamPicks[playerIndex] ? "default" : "pointer",
                                  opacity: teamPicks[playerIndex] && !picked ? 0.4 : 1,
                                  fontSize: 11,
                                  fontWeight: 800,
                                  letterSpacing: 0.3,
                                  textAlign: "center",
                                  transition: "transform 0.12s, opacity 0.12s",
                                  minHeight: 56,
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 2,
                                  overflow: "hidden"
                                }}
                              >
                                <span style={{ fontSize: 13, fontWeight: 900 }}>{meta?.initials || tn.slice(0, 3).toUpperCase()}</span>
                                <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{tn}</span>
                              </button>
                            );
                          })}
                      </div>
                    </>
                  )}

                  <StatusMessage message={message} />
                </div>
              )}

              {gameStarted && screen === "game" && winner === null && (scores[0] === targetScore - 1 || scores[1] === targetScore - 1) && (
                <div className={`match-point-banner ${scores[playerIndex] === targetScore - 1 ? "me" : "opp"}`}>
                  <span className="match-point-flag">⚡</span>
                  <strong>
                    {scores[playerIndex] === targetScore - 1 && scores[1 - playerIndex] === targetScore - 1
                      ? t("matchpoint_critical")
                      : scores[playerIndex] === targetScore - 1
                      ? t("matchpoint_mine")
                      : t("matchpoint_opp")}
                  </strong>
                </div>
              )}

              {screen !== "team_select" && (screen === "winner" && winner !== null ? (
                <div className={`panel winner-panel ${winner === playerIndex ? "you-won" : "you-lost"}`}>
                  {winner === playerIndex ? (
                    <>
                      <div className="trophy trophy-big" aria-hidden="true">🏆</div>
                      <h2>{t("winner_won_title")}</h2>
                      <p className="winner-subtitle">{t("winner_won_sub")}</p>
                    </>
                  ) : (
                    <>
                      <div className="trophy trophy-loser" aria-hidden="true">💪</div>
                      <h2>{t("winner_lost_title")}</h2>
                      <p className="winner-subtitle">{t("winner_lost_sub", { name: playerNames[winner] })}</p>
                    </>
                  )}
                  <div className="final-score-display">
                    <div className={`final-score-side ${winner === 0 ? "won" : "lost"}`}>
                      <span>{playerNames[0]}</span>
                      <strong>{scores[0]}</strong>
                    </div>
                    <span className="final-score-dash">-</span>
                    <div className={`final-score-side ${winner === 1 ? "won" : "lost"}`}>
                      <span>{playerNames[1]}</span>
                      <strong>{scores[1]}</strong>
                    </div>
                  </div>

                  <MatchSummary
                    playerNames={playerNames}
                    scores={scores}
                    winner={winner}
                    targetScore={targetScore}
                    seriesWins={seriesWins}
                    currentCorrectRounds={correctRounds}
                  />

                  <div className="winner-actions">
                    <button type="button" onClick={startRematch} className="primary-button big">
                      {t("winner_btn_rematch")}
                    </button>
                    <button type="button" onClick={resetGame} className="light-button big">
                      {t("winner_btn_reset")}
                    </button>
                  </div>
                </div>
              ) : !opponentJoined ? (
                <div className="panel waiting-panel">
                  <div className="waiting-icon" aria-hidden="true">⏳</div>
                  <h2>{t("lobby_waiting_title")}</h2>
                  <p>{t("lobby_waiting_sub")}</p>
                  <div className="room-code-display">
                    <span>{t("lobby_room_code")}</span>
                    <strong>{roomCode}</strong>
                  </div>
                  <button type="button" onClick={copyInvite} className="primary-button big">
                    {t("lobby_copy_invite")}
                  </button>
                  <StatusMessage message={message} />
                </div>
              ) : !gameStarted ? (
                <div className="panel waiting-panel">
                  <div className="waiting-icon" aria-hidden="true">⚽</div>
                  <h2>{t("lobby_ready_title")}</h2>
                  <p>{readyStatusText()}</p>

                  <div className="ready-grid">
                    <div className={playersReady[0] ? "ready-card active" : "ready-card"}>
                      <span className="ready-dot" aria-hidden="true"></span>
                      <strong>{playerNames[0]}</strong>
                      <em>{playersReady[0] ? t("lobby_ready_y") : t("lobby_ready_n")}</em>
                    </div>
                    <div className={playersReady[1] ? "ready-card active" : "ready-card"}>
                      <span className="ready-dot" aria-hidden="true"></span>
                      <strong>{playerNames[1]}</strong>
                      <em>{playersReady[1] ? t("lobby_ready_y") : t("lobby_ready_n")}</em>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={pressStartGame}
                    disabled={playersReady[playerIndex]}
                    className="primary-button big full-width"
                  >
                    {playersReady[playerIndex] ? t("lobby_btn_done") : t("lobby_btn_start")}
                  </button>

                  <StatusMessage message={message} />
                </div>
              ) : isPreRound ? (
                <div className="panel waiting-panel">
                  <div className="countdown-circle">{preRoundLeft}</div>
                  <h2>{t("marathon_teams_opening")}</h2>
                  <p>{t("marathon_get_ready")}</p>
                </div>
              ) : (
                <div className="play-panel">
                  <div className="play-header">
                    <CircularTimer value={timeLeft} max={ROUND_SECONDS} urgent={timeLeft <= 3 && !roundLocked} />
                    <div className="play-tools">
                      <div className="round-pill">{t("online_round", { n: usedRoundKeys.length || 1 })}</div>
                      <div className={`wrong-pill ${myWrongAttemptUsed ? "used" : ""}`}>
                        {t("online_wrong_tries")} <strong>{myWrongAttemptUsed ? 0 : 1}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="teams-grid">
                    <div className="team-card">
                      <TeamLogo teamName={round.teams[0]} />
                      <strong>{round.teams[0]}</strong>
                    </div>
                    <div className="versus">VS</div>
                    <div className="team-card">
                      <TeamLogo teamName={round.teams[1]} />
                      <strong>{round.teams[1]}</strong>
                    </div>
                  </div>

                  {lastAction && (
                    <div className={
                      lastAction.type === "correct" && lastAction.playerIndex === playerIndex
                        ? "action-banner success"
                        : lastAction.type === "correct"
                          ? "action-banner concede"
                          : lastAction.type === "wrong"
                            ? "action-banner error"
                            : "action-banner info"
                    }>
                      <span className="action-emoji">
                        {lastAction.type === "correct" ? "⚽" : lastAction.type === "wrong" ? "❌" : "⏱️"}
                      </span>
                      <strong>
                        {lastAction.type === "correct" && lastAction.playerIndex === playerIndex
                          ? t("online_action_goal", { answer: lastAction.answer })
                          : lastAction.type === "correct"
                            ? t("online_action_conceded", { answer: lastAction.answer })
                            : lastAction.type === "wrong" && lastAction.playerIndex === playerIndex
                              ? t("online_action_wrong")
                              : lastAction.type === "wrong"
                                ? t("online_action_opp_wrong")
                                : t("online_action_round_end")}
                      </strong>
                    </div>
                  )}

                  <div className="answer-card">
                    <div className="answer-row">
                      <div className="autocomplete-wrap">
                        <input
                          value={answerInput}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          enterKeyHint="search"
                          disabled={!canAnswer}
                          onFocus={() => {
                            if (canAnswer && answerInput) setFocusedInput(true);
                          }}
                          onBlur={() => setTimeout(() => setFocusedInput(false), 120)}
                          onChange={(event) => updateAnswerInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") checkAnswer();
                          }}
                          placeholder={t("input_placeholder_player")}
                        />

                        {canAnswer && focusedInput && suggestions.length > 0 && (
                          <div className="suggestions">
                            {suggestions.map((player) => (
                              <button
                                key={player.name}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  selectSuggestion(player.name);
                                }}
                                onClick={() => selectSuggestion(player.name)}
                              >
                                {player.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={!canAnswer}
                        onClick={checkAnswer}
                        className="primary-button"
                      >
                        Kontrol
                      </button>
                    </div>
                  </div>

                  {(!lastAction || lastAction.type !== "correct") && (
                    <StatusMessage message={message} />
                  )}

                  {lastWrongReport && (
                    <button
                      type="button"
                      className="report-link-button"
                      onClick={() => submitAnswerReport(lastWrongReport, setReportStatus, () => setLastWrongReport(null))}
                    >
                      <span className="report-link-icon">❗</span>
                      <span>
                        {renderWithBoldAnswer(t("gover_should_be_correct", { answer: lastWrongReport.answer }), lastWrongReport.answer)}
                      </span>
                      <span className="report-link-cta">{t("gover_report")}</span>
                    </button>
                  )}

                  <StatusMessage message={reportStatus} />

                  {showAnswers && (
                    <AcceptedPlayersBox
                      title={t("accepted_players")}
                      players={correctPlayers}
                      actualAnswer={lastAction?.answer}
                      onReportPlayer={(player) => reportAcceptedPlayer("online", round, player)}
                    />
                  )}

                  <p className="host-note">
                    {lastAction?.type === "correct"
                      ? t("online_advance_correct")
                      : t("online_advance_other")}
                  </p>
                </div>
              ))}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

const css = `
/* ========================================================================
   Design tokens
   ======================================================================== */
:root {
  --bg-0: #0a0f1f;
  --bg-1: #0f1729;
  --bg-2: #1a2540;
  --surface: #141d36;
  --surface-strong: #1c2748;
  --surface-soft: #0f1828;
  --border: #243151;
  --border-strong: #2e3a5b;

  --text: #f8fafc;
  --text-muted: rgba(248, 250, 252, 0.68);
  --text-dim: rgba(248, 250, 252, 0.48);

  --primary: #10b981;
  --primary-strong: #059669;
  --primary-soft: rgba(16, 185, 129, 0.16);
  --primary-text: #d1fae5;

  --player1: #10b981;
  --player2: #3b82f6;

  --accent: #f59e0b;
  --accent-soft: rgba(245, 158, 11, 0.16);

  --brand: #aa3bff;
  --daily: #b66bff;
  --daily-soft: rgba(170, 59, 255, 0.16);
  --challenge: #f59e0b;
  --challenge-soft: rgba(245, 158, 11, 0.16);
  --online: #3b9dff;
  --online-soft: rgba(59, 130, 246, 0.16);
  --font-display: "Oswald", "Inter", system-ui, sans-serif;
  --font-brand: "Saira Semi Condensed", "Oswald", system-ui, sans-serif;

  --danger: #ef4444;
  --danger-soft: rgba(239, 68, 68, 0.16);
  --danger-text: #fecaca;

  --info: #38bdf8;
  --info-soft: rgba(56, 189, 248, 0.14);

  --radius-sm: 10px;
  --radius: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;

  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.2);
  --shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 16px 60px rgba(0, 0, 0, 0.4);

  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;

  --ease: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg-0);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

#root {
  min-height: 100vh;
}

button, input {
  font: inherit;
  color: inherit;
}

button {
  cursor: pointer;
  border: none;
  background: none;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

input {
  outline: none;
}

input:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* ========================================================================
   App shell
   ======================================================================== */
.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  background:
    radial-gradient(ellipse 80% 60% at 20% 0%, rgba(16, 185, 129, 0.18), transparent 60%),
    radial-gradient(ellipse 80% 60% at 100% 100%, rgba(59, 130, 246, 0.16), transparent 60%),
    linear-gradient(160deg, #0a0f1f 0%, #0c2a24 50%, #0a0f1f 100%);
  color: var(--text);
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 12px;
  padding-top: max(16px, env(safe-area-inset-top, 50px));
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  padding-left: max(12px, env(safe-area-inset-left, 0px));
  padding-right: max(12px, env(safe-area-inset-right, 0px));
}

/* Anasayfa HOME tab'ı: içerik tek viewport'a sığar, scroll yok.
   LEADERBOARD tab'ı: liste uzun, normal scroll açık kalır.
   AMA Düello online setup (showOnlineSetup) açıkken kilit kalkar — özel mod lig
   filtresi açılınca form viewport'u aşıyor ve "Oda Kur" butonuna ulaşılamıyordu. */
.home-screen.home-tab-home:not(.online-setup-open) {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  overscroll-behavior: none;
}
.home-screen.home-tab-home:not(.online-setup-open) .app-frame {
  max-height: 100%;
  overflow: hidden;
}
.home-screen.home-tab-home.online-setup-open {
  min-height: 100dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.app-frame {
  width: 100%;
  max-width: 920px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100dvh - 24px);
}

/* Mobile-first tek sütun tasarım masaüstünde 920px'e gerilince kartlar yatayda
   esneyip içerik sola yapışıyor, sağda kocaman boşluk kalıyordu. Home ekranında
   frame'i telefona yakın bir sütuna sabitliyoruz; topbar, kartlar ve alt sekmeler
   aynı dar sütunda hizalı durur. Oyun ekranları (play-screen) etkilenmez. */
.home-screen .app-frame {
  max-width: 560px;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ========================================================================
   Topbar
   ======================================================================== */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  flex-shrink: 0;
}

.topbar-compact {
  padding: 8px 12px;
}

.topbar-compact .brand-mark {
  width: 22px;
  height: 22px;
}

.topbar-compact .brand strong {
  font-size: 15px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-mark {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
  animation: bob 3s ease-in-out infinite;
}

.brand-mark svg {
  width: 100%;
  height: 100%;
  display: block;
}

@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-text strong {
  font-family: var(--font-brand);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-text small {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.brand-fc { color: var(--challenge); }

.icon-button {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  font-size: 18px;
  transition: all 0.2s var(--ease);
}

.icon-button:hover {
  background: var(--primary-soft);
  border-color: var(--primary);
  transform: scale(1.05);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.topbar-actions .light-button {
  padding: 8px 10px;
  font-size: 12px;
  min-height: 36px;
  opacity: 0.85;
}

.topbar-actions .light-button:hover {
  opacity: 1;
}

.home-button {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.2);
}

.home-button:hover {
  background: rgba(16, 185, 129, 0.16);
}

/* ========================================================================
   Buttons
   ======================================================================== */
.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 20px;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-strong) 100%);
  color: #022c1e;
  border-radius: var(--radius);
  font-weight: 800;
  font-size: 15px;
  letter-spacing: -0.01em;
  transition: all 0.2s var(--ease);
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
  min-height: 46px;
  white-space: nowrap;
}

.primary-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
}

.primary-button:active:not(:disabled) {
  transform: translateY(0);
}

.primary-button.big {
  padding: 14px 24px;
  font-size: 16px;
  min-height: 52px;
}

.primary-button.full-width {
  width: 100%;
}

.light-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 11px 18px;
  background: var(--surface-strong);
  color: var(--text);
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 14px;
  border: 1px solid var(--border);
  transition: all 0.2s var(--ease);
  min-height: 44px;
  white-space: nowrap;
}

.light-button:hover:not(:disabled) {
  background: var(--surface);
  border-color: var(--border-strong);
}

.light-button.big {
  padding: 14px 22px;
  font-size: 15px;
  min-height: 50px;
}

.light-button.compact {
  padding: 8px 14px;
  font-size: 13px;
  min-height: 36px;
}

.light-button.danger {
  background: var(--danger-soft);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--danger-text);
}

.light-button.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.24);
  border-color: var(--danger);
}

.mini-button {
  padding: 7px 12px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  transition: all 0.2s var(--ease);
  white-space: nowrap;
}

.mini-button:hover:not(:disabled) {
  background: var(--primary-soft);
  border-color: var(--primary);
}

/* ========================================================================
   Home screen
   ======================================================================== */
.home-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
}

/* Home kartları (Maraton hero, Günlük, Düello/Arena, install) bir flex sütunun
   çocukları. Home tab'ı "tek viewport'a sığsın, scroll yok" diye overflow:hidden.
   Ama içerik viewport'tan uzunsa flex çocukları SIKIŞIP iç metinlerini (başlık,
   alt yazı, CTA) kırpıyordu — ekranda Maraton/Günlük tek satırlık banda dönüyordu.
   Çözüm: çocuklar küçülmesin (flex-shrink:0), içerik sığmazsa home-content kendi
   içinde scroll etsin. Böylece kartlar tam boyunda görünür. */
.home-content > * { flex-shrink: 0; }
.home-screen.home-tab-home:not(.online-setup-open) .home-content {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* ========================================================================
   Online Setup Header
   ======================================================================== */
.online-setup-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 4px;
  margin-bottom: 8px;
}

.online-setup-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.online-setup-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
}

.online-setup-title p {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.back-button {
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 14px;
  color: var(--text);
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  transition: all 0.18s var(--ease);
  flex-shrink: 0;
}

.back-button:hover {
  background: var(--surface-strong);
  transform: translateX(-2px);
}

/* Doğru cevaplar - scrollable */
.correct-rounds-list.scrollable {
  max-height: 140px;
  overflow-y: auto;
  padding-right: 4px;
}

.correct-rounds-list.scrollable::-webkit-scrollbar {
  width: 6px;
}

.correct-rounds-list.scrollable::-webkit-scrollbar-track {
  background: transparent;
}

.correct-rounds-list.scrollable::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.correct-rounds-list.scrollable::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

.answers-count {
  color: var(--text-muted);
  font-weight: 600;
  font-size: 12px;
  margin-left: 4px;
}

/* ========================================================================
   Splash Screen
   ======================================================================== */
.splash-screen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background:
    radial-gradient(ellipse 80% 60% at 30% 20%, rgba(16, 185, 129, 0.3), transparent 60%),
    radial-gradient(ellipse 80% 60% at 70% 80%, rgba(59, 130, 246, 0.25), transparent 60%),
    linear-gradient(160deg, #0a0f1f 0%, #0c2a24 50%, #0a0f1f 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: splashFadeOut 0.4s ease-out 1.8s forwards;
}

@keyframes splashFadeOut {
  to { opacity: 0; pointer-events: none; }
}

.splash-content {
  text-align: center;
  animation: splashIn 0.6s var(--ease-bounce);
}

@keyframes splashIn {
  0%   { transform: scale(0.85); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.splash-logo {
  width: 88px;
  height: 88px;
  margin: 0 auto;
  animation: splashLogoBounce 1.5s ease-in-out infinite;
  filter: drop-shadow(0 8px 20px rgba(16, 185, 129, 0.5));
}

.splash-logo svg {
  width: 100%;
  height: 100%;
}

@keyframes splashLogoBounce {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-10px); }
}

.splash-title {
  margin: 8px 0 4px;
  font-family: var(--font-brand);
  font-size: 50px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #f2f0ff;
}

.splash-tagline {
  margin: 0;
  font-size: 16px;
  color: var(--text-muted);
  font-weight: 600;
}

.splash-tagline-sub {
  margin: 0;
  font-size: 18px;
  color: var(--accent);
  font-weight: 800;
  letter-spacing: 0.02em;
}

.splash-loader {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 20px;
}

.splash-loader span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  animation: splashDot 1.2s ease-in-out infinite;
}

.splash-loader span:nth-child(2) { animation-delay: 0.15s; }
.splash-loader span:nth-child(3) { animation-delay: 0.3s; }

@keyframes splashDot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40%           { transform: scale(1.1); opacity: 1; }
}

/* ========================================================================
   PWA Install Banner + Modal
   ======================================================================== */
.install-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  width: 100%;
  background: linear-gradient(135deg, var(--primary-soft) 0%, rgba(16, 185, 129, 0.04) 100%);
  border: 1px solid rgba(16, 185, 129, 0.4);
  border-radius: 12px;
  color: var(--text);
  cursor: pointer;
  transition: all 0.18s var(--ease);
}

.install-banner:hover {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(16, 185, 129, 0.08) 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.18);
}

.install-banner-icon {
  font-size: 28px;
  flex-shrink: 0;
}

.install-banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  text-align: left;
  gap: 2px;
}

.install-banner-text strong {
  font-size: 14px;
  color: var(--primary);
  font-weight: 800;
}

.install-banner-text small {
  font-size: 12px;
  color: var(--text-muted);
}

.install-banner-arrow {
  font-size: 22px;
  color: var(--primary);
  font-weight: 800;
}

.notify-banner {
  display: flex;
  align-items: stretch;
  gap: 0;
  width: 100%;
  background: linear-gradient(135deg, rgba(155,45,255,0.16) 0%, rgba(155,45,255,0.04) 100%);
  border: 1px solid rgba(155,45,255,0.4);
  border-radius: 12px;
  margin-top: 8px;
  overflow: hidden;
}
.notify-banner-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  padding: 12px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text);
  text-align: left;
  transition: background 0.18s var(--ease);
}
.notify-banner-main:hover {
  background: rgba(155,45,255,0.10);
}
.notify-banner-icon { font-size: 26px; flex-shrink: 0; }
.notify-banner-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.notify-banner-text strong { font-size: 14px; color: #c08bff; font-weight: 800; }
.notify-banner-text small { font-size: 12px; color: var(--text-muted); }
.notify-banner-x {
  background: transparent;
  border: none;
  border-left: 1px solid rgba(155,45,255,0.25);
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  padding: 0 16px;
  cursor: pointer;
  flex-shrink: 0;
}
.notify-banner-x:hover { color: var(--text); }

.offline-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  /* position: fixed → flex layout'tan tamamen çıkar, viewport top'una yapışır.
     Önceden sticky idi ama .app-shell row-direction flex container olduğu için
     banner yatay olarak yer kaplıyor, oyun içeriğini sağa sıkıştırıyordu. */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #b4471f;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 12px;
  padding-top: calc(8px + env(safe-area-inset-top, 0px));
  text-align: center;
  z-index: 9999;
  letter-spacing: 0.2px;
  /* Tıklamaları engellemesin diye banner üzerinde değilse aşağıya geçsin —
     ama banner kendi içeriği tıklanmıyor zaten, bilgi amaçlı */
  pointer-events: none;
}
.offline-bar-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  flex-shrink: 0;
  animation: offlinePulse 1.4s ease-in-out infinite;
}
@keyframes offlinePulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.notify-on {
  font-size: 12.5px;
  font-weight: 700;
  color: #7ee0a3;
  text-align: center;
  padding: 10px 8px;
  margin-top: 8px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(10, 15, 31, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: modalFadeIn 0.2s ease-out;
}

@keyframes modalFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.modal-content {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  padding: 22px;
  max-width: 480px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
  animation: modalSlideUp 0.3s var(--ease-bounce);
}

@keyframes modalSlideUp {
  from { transform: scale(0.92) translateY(20px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  background: var(--surface-strong);
  color: var(--text);
}

.install-modal h2 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 800;
}

.install-modal > p {
  margin: 0 0 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.install-platform {
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}

.install-platform h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--primary);
  font-weight: 800;
}

.install-platform ol {
  margin: 0;
  padding-left: 18px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
}

.install-platform ol li {
  margin-bottom: 4px;
}

.install-icon {
  display: inline-block;
  background: var(--surface);
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 800;
  margin: 0 2px;
}

/* ========================================================================
   Difficulty Picker
   ======================================================================== */
.difficulty-picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

/* ===== Lig Filtresi ===== */
.league-filter {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
}
.league-filter.compact {
  padding: 10px 12px;
  gap: 8px;
}
.league-filter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.league-filter-label {
  font-size: 13px;
  font-weight: 700;
  color: #fcd34d;
  letter-spacing: 0.3px;
}
.league-filter-count {
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  font-weight: 600;
}
.league-filter-count.warn {
  color: #fbbf24;
}
.league-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.league-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.7);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
}
.league-chip:hover:not(:disabled) {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.18);
}
.league-chip:active:not(:disabled) {
  transform: scale(0.97);
}
.league-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.league-chip.active {
  background: rgba(155, 45, 255, 0.20);
  border-color: rgba(155, 45, 255, 0.55);
  color: #fff;
}
.league-chip.all-chip.active {
  background: rgba(245, 158, 11, 0.20);
  border-color: rgba(245, 158, 11, 0.55);
  color: #fff;
}
.league-chip-flag {
  font-size: 13px;
  line-height: 1;
}
.league-chip-count {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.6;
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(255,255,255,0.08);
}
.league-chip.active .league-chip-count {
  opacity: 0.9;
  background: rgba(255,255,255,0.15);
}
.league-filter-warn {
  display: block;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.10);
  border: 1px solid rgba(251, 191, 36, 0.30);
  color: #fbbf24;
  font-size: 11px;
  line-height: 1.4;
}

.difficulty-header {
  text-align: center;
}

/* Picker geri butonu — mod seçim ekranlarının başında */
.picker-back {
  position: absolute;
  left: 12px;
  top: 12px;
  padding: 6px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.8);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.picker-back:hover { background: rgba(255,255,255,0.12); }
.difficulty-picker { position: relative; }

/* Maraton mod picker kartları — Zorluk Seç / Özel Mod */
.difficulty-card.mode-card-pick {
  border: 1px solid rgba(155, 45, 255, 0.30);
  background: linear-gradient(135deg, rgba(155, 45, 255, 0.10), rgba(245, 158, 11, 0.06));
}
.difficulty-card.mode-card-pick:hover {
  border-color: rgba(155, 45, 255, 0.55);
  background: linear-gradient(135deg, rgba(155, 45, 255, 0.16), rgba(245, 158, 11, 0.10));
}

/* Düello / Arena: kompakt sekme — Zorluk Seç vs Özel Mod */
.match-mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 4px;
}
.match-mode-tab {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.7);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.match-mode-tab:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.18);
}
.match-mode-tab.active {
  background: linear-gradient(135deg, rgba(155, 45, 255, 0.22), rgba(245, 158, 11, 0.14));
  border-color: rgba(155, 45, 255, 0.55);
  color: #fff;
}
.match-mode-hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  line-height: 1.4;
}

.difficulty-header h2 {
  margin: 0 0 4px;
  font-size: 26px;
  font-weight: 900;
}

.difficulty-header p {
  margin: 0;
  color: var(--text-muted);
}

.difficulty-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.difficulty-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  color: var(--text);
  transition: all 0.18s var(--ease);
}

.difficulty-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}

.difficulty-card.easy:hover  { border-color: rgba(16, 185, 129, 0.5); }
.difficulty-card.medium:hover { border-color: rgba(245, 158, 11, 0.5); }
.difficulty-card.hard:hover   { border-color: rgba(239, 68, 68, 0.5); }

.difficulty-emoji {
  font-size: 24px;
}

.difficulty-card strong {
  font-size: 18px;
  font-weight: 800;
}

.difficulty-card small {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 600;
}

.difficulty-card em {
  font-size: 11px;
  color: var(--text-dim);
  font-style: normal;
  margin-top: 4px;
}


.mode-grid-3 {
  grid-template-columns: 1fr 1fr 1fr;
}

@media (max-width: 720px) {
  .mode-grid-3 {
    grid-template-columns: 1fr;
  }
}

.mode-card-daily {
  background: linear-gradient(135deg, var(--daily-soft) 0%, var(--surface) 100%);
  border-color: rgba(170, 59, 255, 0.3);
}

.streak-badge {
  background: linear-gradient(135deg, var(--daily-soft) 0%, rgba(170, 59, 255, 0.06) 100%);
  border: 1px solid rgba(170, 59, 255, 0.45);
  color: #c79bff;
}

.done-badge {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.08) 100%);
  border: 1px solid rgba(16, 185, 129, 0.45);
  color: #10b981;
}

.online-cta {
  background: linear-gradient(135deg, rgba(59, 157, 255, 0.2) 0%, rgba(37, 99, 235, 0.1) 100%);
  border: 1px solid rgba(59, 157, 255, 0.45);
  color: #6cb6ff;
  font-weight: 800;
}

/* Daily puzzle progress dots */
.daily-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.daily-progress-dots {
  display: flex;
  gap: 6px;
}

.daily-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  transition: all 0.2s var(--ease);
}

.daily-dot.current {
  background: var(--daily-soft);
  border-color: var(--daily);
  box-shadow: 0 0 8px rgba(170, 59, 255, 0.5);
  animation: dailyDotPulse 1.6s ease-in-out infinite;
}

@keyframes dailyDotPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 8px rgba(170, 59, 255, 0.5); }
  50%      { transform: scale(1.25); box-shadow: 0 0 14px rgba(170, 59, 255, 0.85); }
}

.daily-dot.correct {
  background: var(--primary);
  border-color: var(--primary);
}

.daily-dot.failed {
  background: var(--danger);
  border-color: var(--danger);
}

/* Final (5.) soru — "boss" dot: altın halka + yıldız */
.daily-dot.final {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-color: #ffce4d;
  box-shadow: 0 0 0 2px rgba(255, 206, 77, 0.30), 0 0 10px rgba(255, 206, 77, 0.45);
}
.daily-dot.final::after {
  content: "★";
  font-size: 10px;
  line-height: 1;
  color: #ffce4d;
}
.daily-dot.final.correct::after,
.daily-dot.final.failed::after {
  color: #fff;
}

.daily-wrong-meter {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.daily-wrong-meter span {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.daily-wrong-meter strong {
  font-size: 18px;
  color: var(--primary);
  font-weight: 800;
}

.daily-wrong-meter strong.danger {
  color: var(--danger);
}

.daily-skip {
  align-self: center;
  margin-top: 4px;
}

.daily-grid-emoji {
  font-size: 24px;
  letter-spacing: 6px;
  text-align: center;
  padding: 10px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.daily-share-button {
  width: 100%;
  background: linear-gradient(135deg, #1da1f2 0%, #25d366 100%);
  border: 1px solid rgba(29, 161, 242, 0.4);
  font-weight: 800;
}

.daily-share-button:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.daily-countdown-box {
  align-items: center;
  text-align: center;
  padding: 10px;
  background: linear-gradient(135deg, var(--daily-soft) 0%, rgba(170, 59, 255, 0.04) 100%);
  border: 1px solid rgba(170, 59, 255, 0.3);
  border-radius: 10px;
}

.daily-countdown-value {
  font-size: 22px !important;
  color: #c79bff !important;
  font-weight: 900 !important;
  letter-spacing: 0.02em;
}

/* Stats bar (anasayfa üst kısmı) */
/* =================== ANA SAYFA YENİ TASARIM =================== */

/* --- Mini Stat Strip (tek satır) --- */
.stats-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  margin-bottom: 14px;
}
.stats-strip-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
}
.stats-strip-item strong {
  color: var(--text);
  font-weight: 800;
  font-size: 14px;
}
.ssi-icon { font-size: 14px; }
.ssi-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  opacity: 0.75;
}
.stats-strip-sep {
  color: var(--text-muted);
  opacity: 0.4;
}
@media (max-width: 380px) {
  .stats-strip { gap: 8px; padding: 10px 12px; }
  .stats-strip-item { font-size: 12px; }
  .stats-strip-sep { display: none; }
}

/* --- Hero Card (büyük dinamik featured) --- */
.hero-card {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  padding: 18px 20px 16px;
  margin-bottom: 12px;
  overflow: hidden;
  cursor: pointer;
  background: var(--surface);
  transition: transform 0.22s var(--ease), box-shadow 0.22s var(--ease), border-color 0.22s var(--ease);
  isolation: isolate;
}
.hero-card-glow {
  position: absolute;
  inset: -40%;
  pointer-events: none;
  z-index: 0;
  opacity: 0.5;
  filter: blur(48px);
  transition: opacity 0.3s ease;
}
/* Ambient pattern — soccer ball hint, çok silik */
.hero-card::after {
  content: "";
  position: absolute;
  right: -30px;
  bottom: -30px;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  border: 2px solid currentColor;
  opacity: 0.04;
  pointer-events: none;
  z-index: 0;
}
.hero-card::before {
  content: "";
  position: absolute;
  right: 30px;
  top: -20px;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  opacity: 0.05;
  pointer-events: none;
  z-index: 0;
}
.hero-card--daily {
  background: linear-gradient(135deg, rgba(170, 59, 255, 0.16) 0%, rgba(170, 59, 255, 0.06) 100%);
  border-color: rgba(170, 59, 255, 0.4);
  color: #c79bff;
}
.hero-card--daily .hero-card-glow {
  background: radial-gradient(circle at 30% 20%, rgba(170, 59, 255, 0.45), transparent 55%),
              radial-gradient(circle at 80% 80%, rgba(140, 59, 255, 0.3), transparent 50%);
}
.hero-card--challenge {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.14) 0%, rgba(239, 68, 68, 0.1) 100%);
  border-color: rgba(245, 158, 11, 0.45);
  color: #f59e0b;
}
.hero-card--challenge .hero-card-glow {
  background: radial-gradient(circle at 25% 20%, rgba(245, 158, 11, 0.5), transparent 55%),
              radial-gradient(circle at 80% 80%, rgba(239, 68, 68, 0.32), transparent 50%);
}
.hero-card--online {
  background: linear-gradient(135deg, rgba(59, 157, 255, 0.14) 0%, rgba(59, 130, 246, 0.08) 100%);
  border-color: rgba(59, 157, 255, 0.4);
  color: #6cb6ff;
}
.hero-card--online .hero-card-glow {
  background: radial-gradient(circle at 25% 20%, rgba(59, 157, 255, 0.45), transparent 55%),
              radial-gradient(circle at 80% 80%, rgba(37, 99, 235, 0.3), transparent 50%);
}
.hero-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.hero-card:active {
  transform: translateY(0) scale(0.985);
  transition-duration: 0.08s;
}
.hero-card:hover .hero-card-glow { opacity: 0.75; }

.hero-card-content {
  position: relative;
  z-index: 1;
}
.hero-card-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.hero-card-icon {
  font-size: 22px;
  line-height: 1;
}
.hero-card-eyebrow-text {
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text);
  opacity: 0.9;
}
.hero-card--daily .hero-card-eyebrow-text { color: #10b981; }
.hero-card--challenge .hero-card-eyebrow-text { color: #fbbf24; }
.hero-card--online .hero-card-eyebrow-text { color: #22d3ee; }

.hero-card-title {
  font-size: 19px;
  font-weight: 800;
  line-height: 1.22;
  color: var(--text);
  margin: 0 0 4px 0;
  letter-spacing: -0.015em;
}
.hero-card-sub {
  font-size: 12.5px;
  color: var(--text-muted);
  margin: 0 0 12px 0;
  line-height: 1.45;
}
.hero-card-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.01em;
  background: var(--text);
  color: var(--bg);
  transition: gap 0.2s var(--ease);
}
.hero-card--daily .hero-card-cta { background: #10b981; color: #fff; }
.hero-card--challenge .hero-card-cta { background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff; }
.hero-card--online .hero-card-cta { background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: #fff; }
.hero-card:hover .hero-card-cta { gap: 10px; }
.hero-card-arrow {
  font-size: 14px;
  font-weight: 800;
  transition: transform 0.2s var(--ease);
}
.hero-card:hover .hero-card-arrow { transform: translateX(2px); }

@media (max-width: 480px) {
  .hero-card { padding: 16px 16px 14px; border-radius: 14px; }
  .hero-card-title { font-size: 17px; }
  .hero-card-sub { font-size: 12px; margin-bottom: 11px; }
  .hero-card-icon { font-size: 20px; }
  .hero-card-cta { padding: 7px 14px; font-size: 12.5px; }
  .hero-card::after { width: 120px; height: 120px; right: -20px; bottom: -20px; }
}

/* --- Mode Grid Secondary (2'li yatay - Online + Arena) --- */
.mode-grid-secondary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.mode-card-secondary {
  padding: 14px 10px 12px;
  min-height: 96px;
}
.mode-card-secondary .mode-icon { font-size: 22px; margin-bottom: 6px; }
.mode-card-secondary strong { font-size: 13px; }
.mode-card-secondary small { font-size: 10.5px; line-height: 1.35; }
.mode-card-secondary .best-badge { font-size: 10px; padding: 3px 7px; margin-top: 6px; }

.mode-card-challenge::before { background: linear-gradient(180deg, #f59e0b 0%, #ef4444 100%) !important; }
.mode-card-online::before { background: linear-gradient(180deg, #06b6d4 0%, #8b5cf6 100%) !important; }
.mode-card-daily::before { background: linear-gradient(180deg, #10b981 0%, #3b82f6 100%) !important; }
.mode-card-arena::before { background: linear-gradient(180deg, #f59e0b 0%, #d946ef 100%) !important; }
.arena-new-badge { background: rgba(245, 158, 11, 0.20); color: #fcd34d !important; }

@media (max-width: 360px) {
  .mode-grid-secondary { grid-template-columns: 1fr; }
}

/* --- Featured Daily Card (hero altında, ikincil kahraman) --- */
.featured-daily {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  background: linear-gradient(135deg, rgba(155, 45, 255, 0.12) 0%, rgba(124, 58, 237, 0.06) 100%);
  border: 1px solid rgba(170, 59, 255, 0.32);
  border-radius: 18px;
  padding: 14px 16px 16px;
  margin-bottom: 14px;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.featured-daily-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 20% 30%, rgba(170, 59, 255, 0.35), transparent 55%),
              radial-gradient(circle at 85% 80%, rgba(124, 58, 237, 0.22), transparent 50%);
  opacity: 0.55;
  transition: opacity 0.2s var(--ease);
  pointer-events: none;
}
.featured-daily:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
}
.featured-daily:hover .featured-daily-glow { opacity: 0.8; }
.featured-daily:active {
  transform: translateY(0) scale(0.988);
  transition-duration: 0.08s;
}
.featured-daily-content {
  position: relative;
  z-index: 1;
}
.featured-daily-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.featured-daily-meta {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: rgba(255, 255, 255, 0.78);
}
.featured-daily-streak {
  font-size: 12px;
  font-weight: 800;
  color: #ffd24d;
  text-shadow: 0 0 12px rgba(255, 174, 0, 0.65);
}
.featured-daily-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.featured-daily-text {
  flex: 1;
  min-width: 0;
}
.featured-daily-text strong {
  display: block;
  font-size: 17px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.01em;
  line-height: 1.2;
  margin-bottom: 2px;
}
.featured-daily-text small {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.3;
}
.featured-daily-grid {
  display: flex;
  gap: 4px;
  font-size: 18px;
  flex-shrink: 0;
}
.featured-daily-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(170, 59, 255, 0.22);
  border: 1px solid rgba(170, 59, 255, 0.4);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #d4b3ff;
  flex-shrink: 0;
}
.featured-daily-arrow {
  display: inline-block;
  transition: transform 0.2s var(--ease);
}
.featured-daily:hover .featured-daily-arrow { transform: translateX(3px); }

/* --- Activity Strip (kişisel istatistikler) --- */
.activity-strip {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  margin-top: 4px;
}
.activity-strip-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.activity-strip-icon { font-size: 16px; }
.activity-strip-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}
.activity-strip-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 12px;
}
.activity-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.activity-item strong {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}
.activity-item small {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: lowercase;
  letter-spacing: 0.01em;
}

/* =================== /ANA SAYFA YENİ TASARIM =================== */

.mode-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 18px 18px 18px 22px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, transparent 50%),
    var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  text-align: left;
  transition: all 0.22s var(--ease);
  min-height: 110px;
  overflow: hidden;
  cursor: pointer;
}

.mode-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0;
  width: 4px;
  height: 100%;
  background: var(--border-strong);
  opacity: 0.6;
  transition: all 0.22s var(--ease);
}

.mode-card:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, transparent 50%),
    var(--surface-strong);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
}

.mode-card:active {
  transform: translateY(-1px) scale(0.98);
  transition-duration: 0.08s;
}

.mode-card:hover::before {
  opacity: 1;
  width: 6px;
}

.mode-card-online::before { background: linear-gradient(180deg, var(--online) 0%, #06b6d4 100%); }
.mode-card-challenge::before { background: linear-gradient(180deg, var(--challenge) 0%, #ef4444 100%); }
.mode-card-daily::before { background: linear-gradient(180deg, #aa3bff 0%, #c084fc 100%); }

.mode-card.active {
  border-color: var(--primary);
  background: linear-gradient(135deg, var(--primary-soft) 0%, var(--surface) 100%);
  box-shadow: 0 8px 28px rgba(16, 185, 129, 0.2);
}

/* Online mode picker (Oda Kur / Odaya Katıl) */
.online-mode-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 4px;
}

@media (max-width: 540px) {
  .online-mode-picker {
    grid-template-columns: 1fr;
  }
}

.online-action-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 22px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, transparent 60%),
    var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  text-align: left;
  transition: all 0.22s var(--ease);
  cursor: pointer;
  overflow: hidden;
  min-height: 140px;
  color: var(--text);
}

.online-action-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
}

.online-action-card.create:hover {
  border-color: var(--primary);
  background:
    linear-gradient(135deg, var(--primary-soft) 0%, transparent 60%),
    var(--surface-strong);
}

.online-action-card.join:hover {
  border-color: #3b82f6;
  background:
    linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, transparent 60%),
    var(--surface-strong);
}

.online-action-icon {
  font-size: 36px;
  line-height: 1;
  margin-bottom: 4px;
}

.online-action-card strong {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.online-action-card small {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.4;
}

.online-action-arrow {
  position: absolute;
  bottom: 16px;
  right: 16px;
  font-size: 22px;
  font-weight: 800;
  color: var(--text-muted);
  transition: all 0.22s var(--ease);
}

.online-action-card:hover .online-action-arrow {
  transform: translateX(4px);
  color: var(--text);
}

/* Online form */
.online-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sub-back-button {
  align-self: flex-start;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 4px 0;
  transition: color 0.18s var(--ease);
}

.sub-back-button:hover {
  color: var(--text);
}

.primary-button.full-width {
  width: 100%;
}

.mode-icon {
  font-size: 30px;
  line-height: 1;
}

.mode-card strong {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.mode-card small {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.35;
}

.best-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 4px 10px;
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  font-style: normal;
}

.setup-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 12px;
}

.input-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-card label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.input-card input {
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 11px 14px;
  color: var(--text);
  font-size: 15px;
  transition: all 0.2s var(--ease);
}

.input-card input:focus {
  border-color: var(--primary);
  background: var(--surface);
}

.input-card input::placeholder {
  color: var(--text-dim);
}

.score-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.score-option {
  padding: 10px 0;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-weight: 700;
  font-size: 15px;
  transition: all 0.2s var(--ease);
}

.score-option:hover {
  background: var(--surface);
}

.score-option.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #022c1e;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
}

.room-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.join-box {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 8px;
}

.join-box input {
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 11px 14px;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  text-align: center;
}

.join-box input::placeholder {
  color: var(--text-dim);
  letter-spacing: normal;
  text-transform: none;
  font-weight: 400;
}

.setup-warning {
  padding: 12px 14px;
  background: var(--danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--danger-text);
}

/* ========================================================================
   Play screen common
   ======================================================================== */
.play-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.info-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.info-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
}

.info-chip span {
  color: var(--text-muted);
}

.info-chip strong {
  font-weight: 700;
  color: var(--text);
}

.info-chip.accent {
  background: var(--accent-soft);
  border-color: rgba(245, 158, 11, 0.3);
}

.info-chip.accent strong {
  color: var(--accent);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-dim);
}

.info-chip.status-online .status-dot {
  background: var(--primary);
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6);
  animation: pulse 2s infinite;
}

.info-chip.status-connecting .status-dot {
  background: var(--accent);
  animation: pulse-amber 1.2s infinite;
}

.info-chip.status-offline .status-dot {
  background: var(--danger);
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
  70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

@keyframes pulse-amber {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.info-bar .mini-button {
  margin-left: auto;
}

/* ========================================================================
   Score bar (game)
   ======================================================================== */
.score-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.score-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-radius: var(--radius);
  transition: all 0.3s var(--ease);
  position: relative;
}

.score-side.me::before {
  content: "Sen";
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  background: var(--primary);
  color: #022c1e;
  border-radius: 999px;
}

.score-side.winner {
  background: var(--accent-soft);
  box-shadow: 0 0 24px rgba(245, 158, 11, 0.25);
}

/* Score gain flash — kim puan aldıysa onun tarafı yeşil parlasın */
.score-side.flash-gain {
  animation: scoreGainFlash 0.8s var(--ease-out);
}

@keyframes scoreGainFlash {
  0% {
    background: var(--primary-soft);
    box-shadow: 0 0 0 rgba(16, 185, 129, 0);
    transform: scale(1);
  }
  30% {
    background: rgba(16, 185, 129, 0.35);
    box-shadow: 0 0 32px rgba(16, 185, 129, 0.55);
    transform: scale(1.06);
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 rgba(16, 185, 129, 0);
    transform: scale(1);
  }
}

.score-side.flash-gain .score-value {
  animation: scoreValuePop 0.6s var(--ease-bounce);
  color: var(--primary);
}

@keyframes scoreValuePop {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.35); }
  100% { transform: scale(1); }
}

/* Match point banner */
.match-point-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.02em;
  animation: matchPointPulse 1.4s ease-in-out infinite;
}

.match-point-banner.me {
  background: linear-gradient(135deg, var(--primary-soft) 0%, rgba(16, 185, 129, 0.08) 100%);
  border: 1px solid rgba(16, 185, 129, 0.45);
  color: var(--primary);
}

.match-point-banner.opp {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(239, 68, 68, 0.06) 100%);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}

.match-point-flag {
  font-size: 16px;
  animation: matchPointFlag 0.8s ease-in-out infinite alternate;
}

@keyframes matchPointPulse {
  0%, 100% { box-shadow: 0 0 0 rgba(245, 158, 11, 0); transform: scale(1); }
  50%      { box-shadow: 0 0 20px rgba(245, 158, 11, 0.3); transform: scale(1.02); }
}

@keyframes matchPointFlag {
  0%   { transform: scale(1) rotate(-8deg); }
  100% { transform: scale(1.15) rotate(8deg); }
}

.score-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.score-value {
  font-size: 32px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.score-side.winner .score-value {
  color: var(--accent);
}

.score-meta {
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 600;
  font-style: normal;
}

.score-vs {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-dim);
  letter-spacing: 0.1em;
}

/* ========================================================================
   Panels
   ======================================================================== */
.panel,
.play-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow);
  padding: 18px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.waiting-panel {
  align-items: center;
  text-align: center;
  justify-content: center;
  padding: 28px 22px;
}

.waiting-panel h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text);
}

.waiting-panel p {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  line-height: 1.45;
  max-width: 380px;
}

.waiting-icon {
  font-size: 52px;
  line-height: 1;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
}

.countdown-circle {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--primary-soft) 0%, transparent 70%);
  border: 3px solid var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  font-weight: 900;
  color: var(--primary);
  line-height: 1;
  animation: countdown-pulse 1s var(--ease) infinite;
  text-shadow: 0 2px 12px rgba(16, 185, 129, 0.4);
}

@keyframes countdown-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

.room-code-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 24px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin: 4px 0;
}

.room-code-display span {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.room-code-display strong {
  font-size: 32px;
  font-weight: 900;
  letter-spacing: 0.2em;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.ready-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
  max-width: 480px;
}

.ready-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 10px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  position: relative;
}

.ready-card.active {
  background: var(--primary-soft);
  border-color: var(--primary);
}

.ready-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-dim);
}

.ready-card.active .ready-dot {
  background: var(--primary);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.6);
}

.ready-card strong {
  font-size: 14px;
  font-weight: 700;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ready-card em {
  font-size: 11px;
  color: var(--text-muted);
  font-style: normal;
}

.ready-card.active em {
  color: var(--primary);
  font-weight: 700;
}

/* ========================================================================
   Play panel (active round)
   ======================================================================== */
.play-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.play-tools {
  display: flex;
  flex-direction: row;
  gap: 6px;
  align-items: center;
  flex: 1;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.play-tools .joker-buttons {
  flex-wrap: wrap;
}

.play-tools .light-button {
  min-height: 40px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.play-tools .light-button.danger {
  border-color: rgba(239, 68, 68, 0.3);
}

.round-pill,
.wrong-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.round-pill {
  background: var(--info-soft);
  border-color: rgba(56, 189, 248, 0.3);
  color: var(--info);
}

.wrong-pill strong {
  margin-left: 4px;
  color: var(--primary);
  font-weight: 800;
}

.wrong-pill.used {
  background: var(--danger-soft);
  border-color: rgba(239, 68, 68, 0.3);
}

.wrong-pill.used strong {
  color: var(--danger);
}

/* ---- Challenge variant: side-by-side tools ---- */
.challenge-bar {
  /* same as info-bar */
}

.play-content .play-panel .play-tools:has(.danger) {
  display: flex;
  flex-direction: row;
  gap: 6px;
}

/* ========================================================================
   Circular timer
   ======================================================================== */
.circ-timer {
  position: relative;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
}

.circ-timer svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.circ-track {
  fill: none;
  stroke: var(--surface-strong);
  stroke-width: 8;
}

.circ-progress {
  fill: none;
  stroke: var(--primary);
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.4s linear, stroke 0.3s var(--ease);
  filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.4));
}

.circ-timer.urgent .circ-progress {
  stroke: var(--danger);
  filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.5));
}

.circ-timer.urgent {
  animation: shake 0.4s var(--ease) infinite;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-2px); }
  75% { transform: translateX(2px); }
}

.circ-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.circ-content strong {
  font-size: 20px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.circ-timer.urgent .circ-content strong {
  color: var(--danger);
}

.circ-content em {
  font-size: 10px;
  font-style: normal;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-top: 2px;
}

/* ========================================================================
   Teams grid
   ======================================================================== */
.teams-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}

.team-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 8px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  text-align: center;
  min-height: 90px;
  justify-content: center;
  transition: transform 0.3s var(--ease);
}

.team-card strong {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.15;
  word-break: break-word;
  hyphens: auto;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.versus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent) 0%, #fb923c 100%);
  color: #1f1306;
  font-weight: 900;
  font-size: 10px;
  letter-spacing: 0.05em;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);
}

/* ========================================================================
   Team logo
   ======================================================================== */
.team-logo {
  --logo-size: 56px;
  width: var(--logo-size);
  height: var(--logo-size);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: var(--team-primary);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.10) inset;
  flex-shrink: 0;
}

.team-logo.size-sm {
  --logo-size: 40px;
  border-radius: 11px;
}

.team-logo__bar {
  width: 100%;
  height: 26%;
  flex-shrink: 0;
  background: var(--team-secondary);
}

.team-logo__abbr {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--team-text);
  font-family: var(--font-brand);
  font-weight: 800;
  font-size: calc(var(--logo-size) * 0.36);
  letter-spacing: -0.02em;
  line-height: 1;
}

/* ========================================================================
   Action banner
   ======================================================================== */
.action-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: var(--radius);
  font-weight: 700;
  font-size: 15px;
  animation: slideDown 0.3s var(--ease-bounce);
}

@keyframes slideDown {
  0% { transform: translateY(-10px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}

/* ========================================================================
   Doğru / Yanlış Animasyonları
   ======================================================================== */
.feedback-correct {
  animation: pulseGreen 0.8s var(--ease);
}

.feedback-correct .team-card {
  animation: teamCardCorrect 0.6s var(--ease);
}

.feedback-wrong {
  animation: shake 0.5s var(--ease);
}

.feedback-wrong .autocomplete-wrap input {
  animation: inputShake 0.4s var(--ease);
  border-color: var(--danger) !important;
  background: rgba(239, 68, 68, 0.06) !important;
}

@keyframes pulseGreen {
  0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
  50%  { box-shadow: 0 0 0 24px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

@keyframes teamCardCorrect {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.06); background: rgba(16, 185, 129, 0.18); border-color: var(--primary); }
  100% { transform: scale(1); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-8px); }
  20%, 40%, 60%, 80%       { transform: translateX(8px); }
}

@keyframes inputShake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}

/* "Bilmiyorum" sessiz secondary button */
.skip-button {
  background: transparent !important;
  border-color: var(--border) !important;
  color: var(--text-muted) !important;
  font-weight: 600;
}

.skip-button:hover:not(:disabled) {
  background: var(--surface-soft) !important;
  color: var(--text) !important;
  border-color: var(--border-strong) !important;
}

/* Skor pop */
.score-pop {
  display: inline-block;
  animation: scorePop 0.6s var(--ease-bounce);
}

@keyframes scorePop {
  0%   { transform: scale(1); color: inherit; }
  40%  { transform: scale(1.5); color: var(--primary); text-shadow: 0 0 12px var(--primary); }
  100% { transform: scale(1); color: inherit; }
}

/* =================== COMBO LAYER 2: Score pill alev gradient =================== */
.info-chip.accent.on-fire {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.22) 0%, rgba(239, 68, 68, 0.18) 100%);
  border: 1px solid rgba(251, 146, 60, 0.45);
  box-shadow: 0 0 12px rgba(251, 146, 60, 0.25);
  animation: pillFireGlow 1.4s ease-in-out infinite;
}
.info-chip.accent.on-fire strong {
  color: #fb923c;
  text-shadow: 0 0 8px rgba(251, 146, 60, 0.45);
}
.info-chip.accent.on-fire span {
  color: rgba(251, 146, 60, 0.95);
}
.info-chip.accent.fire-high {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(168, 85, 247, 0.22) 100%);
  border-color: rgba(239, 68, 68, 0.55);
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.35);
}
.info-chip.accent.fire-high strong {
  color: #f87171;
  text-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
}

@keyframes pillFireGlow {
  0%, 100% { box-shadow: 0 0 8px rgba(251, 146, 60, 0.2); }
  50%      { box-shadow: 0 0 16px rgba(251, 146, 60, 0.5); }
}

/* =================== COMBO LAYER 3: Floating streak burst =================== */
.combo-burst {
  position: fixed;
  top: 32%;
  left: 50%;
  transform: translate(-50%, 0) scale(0.6);
  font-size: 28px;
  font-weight: 900;
  letter-spacing: 0.5px;
  padding: 14px 22px;
  border-radius: 14px;
  z-index: 9999;
  pointer-events: none;
  opacity: 0;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
  animation: comboBurstFly 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  white-space: nowrap;
}
.combo-burst--blue {
  color: #fcd34d;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.92) 0%, rgba(251, 146, 60, 0.92) 100%);
  box-shadow: 0 8px 32px rgba(59, 130, 246, 0.55), 0 0 24px rgba(251, 146, 60, 0.4);
}
.combo-burst--orange {
  color: #fff7ed;
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.95) 0%, rgba(239, 68, 68, 0.95) 100%);
  box-shadow: 0 8px 32px rgba(249, 115, 22, 0.6), 0 0 28px rgba(239, 68, 68, 0.45);
}
.combo-burst--fire {
  color: #fef2f2;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.96) 0%, rgba(190, 24, 93, 0.96) 100%);
  box-shadow: 0 8px 36px rgba(239, 68, 68, 0.7), 0 0 32px rgba(239, 68, 68, 0.5);
  font-size: 32px;
}
.combo-burst--legendary {
  color: #fef3c7;
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.96) 0%, rgba(245, 158, 11, 0.96) 100%);
  box-shadow: 0 10px 40px rgba(168, 85, 247, 0.7), 0 0 36px rgba(245, 158, 11, 0.55);
  font-size: 34px;
  letter-spacing: 1px;
}

@keyframes comboBurstFly {
  0%   { opacity: 0; transform: translate(-50%, 20px) scale(0.6); }
  18%  { opacity: 1; transform: translate(-50%, 0) scale(1.08); }
  32%  { transform: translate(-50%, -8px) scale(1.0); }
  78%  { opacity: 1; transform: translate(-50%, -38px) scale(1.0); }
  100% { opacity: 0; transform: translate(-50%, -70px) scale(0.92); }
}

@media (max-width: 480px) {
  .combo-burst { font-size: 24px; padding: 12px 18px; }
  .combo-burst--fire { font-size: 26px; }
  .combo-burst--legendary { font-size: 28px; }
}

/* Ekran flash */
.screen-flash {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  animation: screenFlash 0.4s ease-out forwards;
}

.screen-flash-success {
  background: radial-gradient(circle at center, rgba(16, 185, 129, 0.25) 0%, transparent 70%);
}

.screen-flash-error {
  background: radial-gradient(circle at center, rgba(239, 68, 68, 0.25) 0%, transparent 70%);
}

@keyframes screenFlash {
  0%   { opacity: 0; }
  30%  { opacity: 1; }
  100% { opacity: 0; }
}

/* Konfeti */
.confetti-particle {
  position: fixed;
  top: -20px;
  width: 10px;
  height: 14px;
  pointer-events: none;
  z-index: 9999;
  border-radius: 2px;
  animation: confettiFall linear forwards;
}

@keyframes confettiFall {
  0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
  100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
}

.action-emoji {
  font-size: 22px;
  line-height: 1;
}

.action-banner.success {
  background: var(--primary-soft);
  border: 1px solid var(--primary);
  color: var(--primary-text);
}

.action-banner.concede {
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  color: var(--danger-text);
}

.action-banner.error {
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  color: var(--danger-text);
}

.action-banner.info {
  background: var(--info-soft);
  border: 1px solid var(--info);
  color: #bae6fd;
}

/* ========================================================================
   Answer input
   ======================================================================== */
.answer-card {
  padding: 4px;
}

.answer-row {
  display: grid;
  grid-template-columns: 7fr 3fr;
  gap: 8px;
}

.autocomplete-wrap {
  position: relative;
}

.autocomplete-wrap input {
  width: 100%;
  background: var(--surface-strong);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  min-height: 46px;
  transition: all 0.2s var(--ease);
}

.autocomplete-wrap input::placeholder {
  color: var(--text-dim);
  font-weight: 400;
  font-size: 13px;
}

.autocomplete-wrap input:focus {
  border-color: var(--primary);
  background: rgba(16, 185, 129, 0.06);
  box-shadow: 0 0 0 4px var(--primary-soft);
  outline: none;
}

.autocomplete-wrap input::placeholder {
  color: var(--text-dim);
}

.autocomplete-wrap input:disabled {
  background: var(--surface-soft);
}

.suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  /* --vv-height: window.visualViewport.height — klavye açıkken küçülür.
     JS olmayan / desteklemeyen tarayıcılarda fallback olarak 100dvh kullanılır.
     -200px: input alanı + üstündeki başlık/timer için boşluk.
     min(): hem desktop'ta cap koyar (360px) hem mobile'da klavyeye uyum sağlar. */
  max-height: min(360px, calc(var(--vv-height, 100dvh) - 200px));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 4px;
  /* Padding-bottom: kullanıcı son maddeyi scroll edip yukarı kaydırabilsin.
     Son madde sıkışmış görünmek yerine, scroll alanında nefes alanı var. */
  padding-bottom: 80px;
  animation: slideDown 0.15s var(--ease);
}

.suggestions button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  background: none;
  color: var(--text);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s var(--ease);
}

.suggestions button:hover {
  background: var(--primary-soft);
}

/* ========================================================================
   Status messages
   ======================================================================== */
.status-message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13px;
  line-height: 1.4;
  border: 1px solid;
  animation: slideDown 0.25s var(--ease);
}

.status-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 900;
  flex-shrink: 0;
  font-style: normal;
}

.status-text {
  flex: 1;
  min-width: 0;
}

.status-success {
  background: var(--primary-soft);
  border-color: rgba(16, 185, 129, 0.3);
  color: var(--primary-text);
}

.status-success .status-icon {
  background: var(--primary);
  color: #022c1e;
}

.status-error {
  background: var(--danger-soft);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--danger-text);
}

.status-error .status-icon {
  background: var(--danger);
  color: white;
}

.status-info {
  background: var(--info-soft);
  border-color: rgba(56, 189, 248, 0.3);
  color: #bae6fd;
}

.status-info .status-icon {
  background: var(--info);
  color: #082f49;
}

/* ========================================================================
   Wrong explanation & accepted players
   ======================================================================== */
.wrong-explanation-card {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 10px;
  padding: 12px 14px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.wrong-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--danger-soft);
  color: var(--danger);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 20px;
}

.wrong-content strong {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  display: block;
}

.wrong-content p {
  margin: 4px 0 8px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.4;
}

.answers-box {
  padding: 12px 14px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.answers-box strong {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  display: block;
  margin-bottom: 8px;
}

.answer-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.answer-tags button {
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s var(--ease);
}

.answer-tags button:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

/* ========================================================================
   Joker hint
   ======================================================================== */
.joker-hint {
  padding: 10px 14px;
  background: var(--accent-soft);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
  animation: slideDown 0.25s var(--ease);
}

/* Joker buttons */
.joker-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.joker-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  min-height: 40px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 10px;
  color: #fcd34d;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s var(--ease);
  white-space: nowrap;
}

.joker-button:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.22);
  transform: translateY(-1px);
}

.joker-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  background: rgba(100, 116, 139, 0.1);
  border-color: rgba(100, 116, 139, 0.2);
  color: #94a3b8;
}

.joker-icon {
  font-size: 15px;
}

.joker-label {
  font-size: 12px;
}

@media (max-width: 600px) {
  .joker-label {
    display: none;
  }
  .joker-button {
    padding: 8px 10px;
  }
  .joker-icon {
    font-size: 17px;
  }
}

/* ========================================================================
   Bottom actions
   ======================================================================== */
.bottom-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: auto;
}

.host-note {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  font-style: italic;
}

/* ========================================================================
   Winner panel
   ======================================================================== */
.winner-panel {
  align-items: center;
  text-align: center;
  padding: 22px 18px;
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, var(--surface) 100%);
  border-color: rgba(245, 158, 11, 0.3);
}

.winner-panel.you-won {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.12) 0%, var(--surface) 100%);
  border-color: rgba(16, 185, 129, 0.4);
  box-shadow: 0 8px 32px rgba(16, 185, 129, 0.15);
}

.winner-panel.you-lost {
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.08) 0%, var(--surface) 100%);
  border-color: rgba(56, 189, 248, 0.3);
}

.trophy {
  font-size: 64px;
  line-height: 1;
  filter: drop-shadow(0 6px 16px rgba(245, 158, 11, 0.5));
  animation: trophy-bounce 0.8s var(--ease-bounce);
}

.trophy-big {
  filter: drop-shadow(0 8px 24px rgba(16, 185, 129, 0.6));
  animation: trophyWinBounce 1s var(--ease-bounce);
}

@keyframes trophyWinBounce {
  0%   { transform: scale(0) rotate(-30deg); }
  40%  { transform: scale(1.3) rotate(15deg); }
  70%  { transform: scale(0.95) rotate(-5deg); }
  100% { transform: scale(1) rotate(0); }
}

.trophy-loser {
  font-size: 56px;
  filter: drop-shadow(0 4px 12px rgba(56, 189, 248, 0.4));
  animation: trophyLoserShake 0.6s var(--ease-out);
}

@keyframes trophyLoserShake {
  0%   { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes trophy-bounce {
  0% { transform: scale(0) rotate(-30deg); }
  60% { transform: scale(1.1) rotate(10deg); }
  100% { transform: scale(1) rotate(0); }
}

.winner-panel h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--accent) 0%, #fde68a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.winner-panel.you-won h2 {
  background: linear-gradient(135deg, var(--primary) 0%, #6ee7b7 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 28px;
}

.winner-panel.you-lost h2 {
  background: linear-gradient(135deg, #93c5fd 0%, #cbd5e1 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.winner-subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  max-width: 280px;
}

.final-score-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 4px 0 8px;
}

.final-score-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  min-width: 80px;
}

.final-score-side span {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  max-width: 100px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.final-score-side strong {
  font-size: 28px;
  font-weight: 900;
  color: var(--text);
  line-height: 1;
}

.final-score-side.won {
  background: var(--primary-soft);
  border-color: rgba(16, 185, 129, 0.4);
}

.final-score-side.won strong {
  color: var(--primary);
}

.final-score-side.lost {
  opacity: 0.6;
}

.final-score-dash {
  font-size: 24px;
  font-weight: 800;
  color: var(--text-muted);
}

.winner-panel p {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
}

.winner-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
  max-width: 380px;
}

.match-summary-card {
  width: 100%;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.summary-grid > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 6px;
  background: var(--surface);
  border-radius: 10px;
}

.summary-grid span {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.summary-grid strong {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
}

.correct-rounds-summary > strong {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  display: block;
  margin-bottom: 6px;
}

.correct-rounds-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  min-height: 0;
}

.correct-rounds-summary {
  min-height: 0;
}

.correct-round-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface);
  border-radius: 8px;
  font-size: 12px;
  align-items: center;
}

.round-pair {
  color: var(--text-muted);
}

.round-answer {
  font-weight: 700;
  color: var(--primary);
}

.round-player {
  font-size: 11px;
  color: var(--text-dim);
}

/* ========================================================================
   Challenge result
   ======================================================================== */
.challenge-result {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  background: linear-gradient(135deg, var(--accent-soft) 0%, var(--surface) 100%);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--radius);
}

.challenge-result > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.challenge-result strong {
  font-size: 18px;
  font-weight: 900;
  color: var(--accent);
}

.challenge-result span {
  font-size: 12px;
  color: var(--text-muted);
}

/* ========================================================================
   Challenge Game Over (yeni bitiş ekranı)
   ======================================================================== */
.challenge-gameover {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: linear-gradient(135deg, var(--surface-strong) 0%, var(--surface) 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  animation: gameoverIn 0.4s var(--ease-bounce);
}

@keyframes gameoverIn {
  0%   { transform: scale(0.95); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.gameover-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gameover-icon {
  font-size: 26px;
  line-height: 1;
  flex-shrink: 0;
}

.gameover-icon.trophy {
  animation: trophyBounce 0.6s var(--ease-bounce);
}

@keyframes trophyBounce {
  0%   { transform: scale(0) rotate(-15deg); }
  60%  { transform: scale(1.2) rotate(8deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.gameover-headline {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.gameover-headline h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}

.gameover-detail {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.gameover-detail strong {
  color: var(--danger);
  font-weight: 700;
}

.gameover-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.gameover-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
  text-align: center;
}

.gameover-stat span {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.gameover-stat strong {
  font-size: 28px;
  font-weight: 900;
  color: var(--text);
  line-height: 1;
}

.gameover-stat.highlight {
  background: linear-gradient(135deg, var(--accent-soft) 0%, rgba(245, 158, 11, 0.05) 100%);
  border-color: rgba(245, 158, 11, 0.4);
}

.gameover-stat.highlight strong {
  color: var(--accent);
  text-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
}

.gameover-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gameover-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.gameover-players {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.gameover-players.scrollable {
  max-height: 140px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding-right: 4px;
}

.gameover-players.scrollable::-webkit-scrollbar {
  width: 6px;
}

.gameover-players.scrollable::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.gameover-player-chip {
  padding: 5px 10px;
  background: var(--primary-soft);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-text);
  cursor: pointer;
  transition: all 0.15s var(--ease);
}

.gameover-player-chip:hover {
  background: rgba(16, 185, 129, 0.25);
  transform: translateY(-1px);
}

.gameover-more {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.gameover-report-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.14) 0%, rgba(239, 68, 68, 0.06) 100%);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  color: #fca5a5;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: all 0.18s var(--ease);
}

.gameover-report-button:hover {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.14) 100%);
  border-color: rgba(239, 68, 68, 0.55);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.16);
}

.gameover-report-button:active {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(239, 68, 68, 0.12);
}

.gameover-report-label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.gameover-report-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.gameover-report-text {
  font-size: 12px;
  line-height: 1.3;
  color: #fee2e2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gameover-report-text strong {
  color: #ffffff;
  font-weight: 800;
}

.gameover-report-cta {
  flex-shrink: 0;
  padding: 6px 10px;
  background: rgba(239, 68, 68, 0.35);
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 8px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.gameover-report-button:hover .gameover-report-cta {
  background: rgba(239, 68, 68, 0.5);
  border-color: rgba(239, 68, 68, 0.7);
}

.gameover-restart {
  margin-top: 4px;
  width: 100%;
}

/* Online mod yanlış cevap rapor butonu */
.report-link-button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(239, 68, 68, 0.08) 100%);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 12px;
  color: #fee2e2;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: all 0.18s var(--ease);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.08);
}

.report-link-button:hover {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.14) 100%);
  border-color: rgba(239, 68, 68, 0.55);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.16);
}

.report-link-button:active {
  transform: translateY(0);
}

.report-link-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.report-link-button > span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-link-button strong {
  color: #ffffff;
  font-weight: 800;
}

.report-link-cta {
  flex-shrink: 0;
  padding: 6px 10px;
  background: rgba(239, 68, 68, 0.35);
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 8px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.report-link-button:hover .report-link-cta {
  background: rgba(239, 68, 68, 0.5);
  border-color: rgba(239, 68, 68, 0.7);
}

/* ========================================================================
   Mobile-first: single screen layouts
   ======================================================================== */

/* ===== Anasayfa tek ekrana sığsın — sıkıştırma (mobil) =====
   Hero, daily card ve mode grid'in dikey yer kaplamasını kısaltıyoruz.
   Sadece .home-screen altında, play ekranlarını etkilemez. */
@media (max-width: 480px) {
  /* Şeride genel: alt kart aralıklarını sık tut */
  .home-screen .app-frame { gap: 6px; }

  /* Topbar — biraz daha sıkı */
  .home-screen .topbar { padding: 8px 12px; }

  .home-screen .stats-strip {
    padding: 7px 12px;
    margin-bottom: 6px;
  }
  .home-screen .stats-strip-item { font-size: 12.5px; }
  .home-screen .stats-strip-item strong { font-size: 13px; }
  .home-screen .ssi-label { font-size: 10px; }

  /* Maraton hero — en büyük alan kazancı buradan */
  .home-screen .hero-card {
    padding: 11px 14px 11px;
    margin-bottom: 6px;
    border-radius: 14px;
  }
  .home-screen .hero-card-eyebrow { margin-bottom: 2px; }
  .home-screen .hero-card-eyebrow-text { font-size: 9.5px; letter-spacing: 0.12em; }
  .home-screen .hero-card-title {
    font-size: 16px;
    line-height: 1.18;
    margin: 0 0 2px 0;
  }
  .home-screen .hero-card-sub {
    font-size: 11.5px;
    line-height: 1.35;
    margin: 0 0 7px 0;
  }
  .home-screen .hero-card-cta {
    padding: 6px 13px;
    font-size: 12px;
  }
  .home-screen .hero-card::after { width: 100px; height: 100px; }

  /* Günlük featured kart */
  .home-screen .featured-daily {
    padding: 9px 12px 10px;
    margin-bottom: 6px;
    border-radius: 14px;
  }
  .home-screen .featured-daily-top { margin-bottom: 4px; }
  .home-screen .featured-daily-meta { font-size: 11px; }
  .home-screen .featured-daily-streak { font-size: 11px; }
  .home-screen .featured-daily-text strong { font-size: 15px; line-height: 1.15; }

  /* Düello + Arena alt kart grid */
  .home-screen .mode-grid-secondary {
    gap: 6px;
    margin-bottom: 6px;
  }
  .home-screen .mode-card-secondary {
    padding: 10px 10px 10px;
    min-height: 78px;
  }
  .home-screen .mode-card-secondary .mode-icon {
    font-size: 19px;
    margin-bottom: 3px;
  }
  .home-screen .mode-card-secondary strong { font-size: 12.5px; }
  .home-screen .mode-card-secondary small { font-size: 10px; line-height: 1.28; }

  /* Bottom tab bar — anasayfada üstteki margin'i kısalt */
  .home-screen .bottom-tab-bar {
    margin-top: 6px;
    padding: 3px;
  }
  .home-screen .tab-btn {
    padding: 7px 6px;
    gap: 1px;
  }
  .home-screen .tab-icon { font-size: 18px; }
  .home-screen .tab-label { font-size: 10px; letter-spacing: 0.04em; }
}
@media (max-width: 720px) {
  .app-shell {
    padding: 8px;
    padding-top: max(8px, env(safe-area-inset-top, 50px));
    padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
    padding-left: max(8px, env(safe-area-inset-left, 0px));
    padding-right: max(8px, env(safe-area-inset-right, 0px));
  }

  .app-frame {
    gap: 8px;
    min-height: calc(100dvh - 16px);
  }

  .topbar {
    padding: 10px 14px;
  }

  .brand-mark {
    width: 24px;
    height: 24px;
  }

  .brand-text strong {
    font-size: 14px;
  }

  .brand-text small {
    font-size: 11px;
  }

  .icon-button {
    width: 36px;
    height: 36px;
    font-size: 16px;
  }

  /* Home tighter */
  .home-content {
    gap: 10px;
  }

  .mode-grid {
    gap: 8px;
  }

  .mode-card {
    padding: 14px;
    min-height: 108px;
  }

  .mode-icon {
    font-size: 26px;
  }

  .mode-card strong {
    font-size: 15px;
  }

  .mode-card small {
    font-size: 12px;
  }

  .setup-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .input-card {
    padding: 12px 14px;
  }

  /* Play screen */
  .play-content {
    gap: 8px;
  }

  .info-bar {
    padding: 8px 10px;
    gap: 6px;
  }

  .info-chip {
    padding: 4px 8px;
    font-size: 11px;
  }

  .score-bar {
    padding: 10px 12px;
    gap: 8px;
  }

  .score-name {
    font-size: 12px;
    max-width: 100px;
  }

  .score-value {
    font-size: 26px;
  }

  .score-meta {
    font-size: 10px;
  }

  .score-side.me::before {
    font-size: 8px;
    padding: 1px 6px;
    top: -7px;
  }

  .panel,
  .play-panel {
    padding: 14px;
    gap: 10px;
    border-radius: var(--radius-lg);
  }

  .play-header {
    grid-template-columns: 76px 1fr;
    gap: 10px;
  }

  .circ-timer {
    width: 76px;
    height: 76px;
  }

  .circ-content strong {
    font-size: 24px;
  }

  .play-tools {
    gap: 6px;
  }

  .play-tools .light-button {
    min-height: 34px;
    padding: 6px 10px;
    font-size: 12px;
  }

  .round-pill,
  .wrong-pill {
    padding: 6px 10px;
    font-size: 12px;
  }

  .teams-grid {
    gap: 8px;
  }

  .team-card {
    padding: 10px 6px;
    min-height: 92px;
    gap: 6px;
  }

  .team-logo {
    --logo-size: 46px;
  }

  .team-card strong {
    font-size: 13px;
  }

  .versus {
    width: 32px;
    height: 32px;
    font-size: 11px;
  }

  .action-banner {
    padding: 10px 12px;
    font-size: 13px;
  }

  .action-emoji {
    font-size: 18px;
  }

  .autocomplete-wrap input {
    padding: 11px 14px;
    font-size: 14px;
    min-height: 44px;
  }

  .primary-button {
    padding: 11px 16px;
    font-size: 14px;
    min-height: 44px;
  }

  .primary-button.big {
    padding: 13px 18px;
    font-size: 15px;
    min-height: 50px;
  }

  .light-button {
    padding: 9px 14px;
    font-size: 13px;
    min-height: 40px;
  }

  .light-button.big {
    padding: 12px 16px;
    font-size: 14px;
    min-height: 46px;
  }

  .waiting-panel {
    padding: 20px 16px;
  }

  .waiting-panel h2 {
    font-size: 18px;
  }

  .waiting-panel p {
    font-size: 13px;
  }

  .waiting-icon {
    font-size: 42px;
  }

  .countdown-circle {
    width: 88px;
    height: 88px;
    font-size: 44px;
  }

  .room-code-display {
    padding: 10px 18px;
  }

  .room-code-display strong {
    font-size: 26px;
  }

  .winner-panel {
    padding: 18px 14px;
  }

  .trophy {
    font-size: 52px;
  }

  .winner-panel h2 {
    font-size: 20px;
  }

  .summary-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
  }

  .summary-grid > div {
    padding: 6px 4px;
  }

  .summary-grid strong {
    font-size: 13px;
  }

  .summary-grid span {
    font-size: 9px;
  }

  .correct-round-item {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .ready-card {
    padding: 10px 8px;
  }

  .ready-card strong {
    font-size: 13px;
  }

  .ready-card em {
    font-size: 10px;
  }
}

/* ========================================================================
   Very short / landscape mobile
   ======================================================================== */
@media (max-height: 680px) and (max-width: 720px) {
  .play-panel {
    padding: 12px;
    gap: 8px;
  }

  .play-header {
    grid-template-columns: 64px 1fr;
  }

  .circ-timer {
    width: 64px;
    height: 64px;
  }

  .circ-track,
  .circ-progress {
    stroke-width: 7;
  }

  .circ-content strong {
    font-size: 20px;
  }

  .team-card {
    min-height: 80px;
    padding: 8px 6px;
  }

  .team-logo {
    --logo-size: 38px;
  }

  .team-card strong {
    font-size: 12px;
  }

  .action-banner {
    padding: 8px 10px;
    font-size: 12px;
  }

  .score-bar {
    padding: 8px 10px;
  }

  .score-value {
    font-size: 22px;
  }
}

/* ========================================================================
   Larger screens: spacious & beautiful
   ======================================================================== */
@media (min-width: 1024px) {
  .app-shell {
    padding: 20px;
  }

  .topbar {
    padding: 16px 22px;
  }

  .brand-text strong {
    font-size: 18px;
  }

  .brand-mark {
    width: 32px;
    height: 32px;
  }

  .panel,
  .play-panel {
    padding: 22px;
  }

  .score-value {
    font-size: 38px;
  }

  .circ-timer {
    width: 100px;
    height: 100px;
  }

  .circ-content strong {
    font-size: 32px;
  }

  .team-card {
    min-height: 130px;
  }

  .team-logo {
    --logo-size: 68px;
  }

  .team-card strong {
    font-size: 17px;
  }
}

/* =================== BOTTOM TAB BAR =================== */
.bottom-tab-bar {
  display: flex;
  gap: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 4px;
  margin-top: 16px;
}
.tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px;
  border-radius: 10px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.2s var(--ease);
}
.tab-btn:hover { background: rgba(255,255,255,0.04); }
.tab-active {
  background: rgba(16, 185, 129, 0.12) !important;
  color: #10b981;
}
.tab-icon { font-size: 20px; line-height: 1; }
.tab-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* =================== LEADERBOARD PAGE =================== */
.leaderboard-page { padding-bottom: 8px; }
.lb-header {
  text-align: center;
  margin-bottom: 16px;
}
.lb-header h2 {
  font-size: 20px;
  font-weight: 800;
  margin: 0 0 4px;
  color: #fff;
}
.lb-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}
.lb-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}
.lb-difficulty-tabs {
  display: flex;
  gap: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
}
.lb-tab {
  flex: 1;
  padding: 8px 4px;
  border-radius: 8px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  transition: all 0.2s var(--ease);
}
.lb-tab.active {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.2);
}
.lb-period-toggle {
  display: flex;
  gap: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
}
.lb-period-btn {
  flex: 1;
  padding: 6px 4px;
  border-radius: 8px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-muted);
  transition: all 0.2s var(--ease);
}
.lb-period-btn.active {
  background: rgba(251, 191, 36, 0.14);
  color: #fbbf24;
}
.lb-loading {
  text-align: center;
  padding: 32px 0;
  color: var(--text-muted);
  font-size: 13px;
}
.lb-empty {
  text-align: center;
  padding: 40px 0;
  color: var(--text-muted);
}
.lb-empty-icon { font-size: 42px; display: block; margin-bottom: 10px; }
.lb-empty p { font-size: 13px; margin: 0; }
.lb-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lb-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  transition: all 0.15s var(--ease);
}
.lb-row-top {
  border-color: rgba(251, 191, 36, 0.3);
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.08), var(--surface));
}
.lb-rank {
  width: 30px;
  text-align: center;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-muted);
  flex-shrink: 0;
}
.lb-row-top .lb-rank { color: var(--text); }
.lb-name {
  flex: 1;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lb-score {
  font-size: 16px;
  font-weight: 800;
  color: #10b981;
  flex-shrink: 0;
}

/* =================== SCORE SAVE (gameover) =================== */
.score-save-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0;
}
.score-name-input {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  outline: none;
  transition: border-color 0.2s var(--ease);
}
.score-name-input:focus {
  border-color: #10b981;
}
.score-name-input::placeholder {
  color: var(--text-muted);
  font-weight: 400;
}
.save-score-btn {
  background: linear-gradient(135deg, #10b981, #059669) !important;
  border: none;
  font-size: 14px;
}
.score-saved-msg {
  text-align: center;
  padding: 10px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: 10px;
  color: #10b981;
  font-size: 13px;
  font-weight: 600;
}
.share-score-btn {
  margin-top: 4px;
}

/* Tipografi: skor / streak / timer / sayılar — sporty display font + tabular rakamlar */
.stats-strip-item strong,
.score-value,
.countdown-circle,
.daily-countdown-value,
.final-score-side strong,
.final-score-dash,
.lb-score,
.gameover-headline,
.info-chip.accent strong,
.combo-burst {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.4px;
}

/* ====== ARENA STYLES ====== */
/* =============================================
   ARENA — Çok kişili canlı yarışma modu
   ============================================= */

.arena-screen {
  min-height: 100vh;
  padding: 16px;
  padding-bottom: 80px;
  background: linear-gradient(180deg, #0f1729 0%, #1a1a2e 100%);
  color: #f1f5f9;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.arena-header {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
  padding: 4px 0;
}
.arena-header h1 {
  font-size: 22px;
  margin: 0;
  font-weight: 700;
}
.arena-sub {
  position: absolute;
  right: 0;
  font-size: 11px;
  color: #94a3b8;
}
.arena-back {
  background: rgba(255,255,255,0.08);
  border: 0;
  border-radius: 10px;
  color: #fff;
  font-size: 20px;
  width: 36px;
  height: 36px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.arena-back:hover { background: rgba(255,255,255,0.16); }

/* ===== Setup kartları ===== */
.arena-setup-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 16px 0;
}
.arena-setup-card {
  padding: 20px 14px;
  border: 0;
  border-radius: 16px;
  background: rgba(255,255,255,0.06);
  color: #f1f5f9;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  position: relative;
  overflow: hidden;
}
.arena-setup-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 4px;
}
.arena-setup-host::before { background: linear-gradient(90deg, #f59e0b, #ef4444); }
.arena-setup-guest::before { background: linear-gradient(90deg, #06b6d4, #8b5cf6); }
.arena-setup-card:hover { background: rgba(255,255,255,0.10); transform: translateY(-2px); }
.arena-setup-card:active { transform: translateY(0); }
.arena-setup-card strong { font-size: 16px; }
.arena-setup-card small { font-size: 12px; color: #94a3b8; line-height: 1.4; }
.arena-setup-icon { font-size: 36px; margin-bottom: 4px; }

/* ===== Form ===== */
.arena-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 420px;
  margin: 0 auto;
  width: 100%;
}
.arena-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.arena-label > span {
  font-size: 13px;
  color: #cbd5e1;
  font-weight: 500;
}
.arena-input {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 10px;
  padding: 12px 14px;
  color: #fff;
  font-size: 15px;
  outline: none;
  transition: border 0.2s ease;
}
.arena-input:focus {
  border-color: #f59e0b;
}
.arena-pin-input {
  font-size: 28px;
  letter-spacing: 8px;
  text-align: center;
  font-weight: 700;
  font-family: -apple-system, BlinkMacSystemFont, monospace;
}
.arena-rounds-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.arena-round-chip {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  color: #cbd5e1;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.arena-round-chip:hover {
  background: rgba(255,255,255,0.10);
}
.arena-round-chip.active {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: #fff;
  border-color: transparent;
}
/* Difficulty chips — Marathon ile aynı renk dili */
.arena-diff-chip { flex: 1; }
.arena-diff-chip--easy.active {
  background: linear-gradient(135deg, #10b981, #34d399);
}
.arena-diff-chip--medium.active {
  background: linear-gradient(135deg, #eab308, #f59e0b);
}
.arena-diff-chip--hard.active {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}
.arena-diff-hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: rgba(255,255,255,0.6);
  line-height: 1.4;
  min-height: 17px; /* hint değişirken layout zıplamasın */
}
.arena-cta {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  border: 0;
  border-radius: 12px;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  padding: 14px 20px;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  display: inline-block;
  transition: opacity 0.2s ease, transform 0.15s ease;
}
.arena-cta:hover { opacity: 0.92; }
.arena-cta:active { transform: scale(0.98); }
.arena-cta:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.arena-error {
  background: rgba(239,68,68,0.16);
  border: 1px solid rgba(239,68,68,0.32);
  color: #fca5a5;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
}

/* ===== Lobi ===== */
.arena-lobby {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 480px;
  margin: 0 auto;
  width: 100%;
}
.arena-pin-display {
  text-align: center;
  background: rgba(255,255,255,0.06);
  border-radius: 16px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.arena-pin-label {
  font-size: 12px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.arena-pin-value {
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 10px;
  color: #f59e0b;
  font-family: -apple-system, BlinkMacSystemFont, monospace;
}
.arena-pin-display small {
  color: #94a3b8;
  font-size: 13px;
}
.arena-players-list {
  background: rgba(255,255,255,0.04);
  border-radius: 14px;
  padding: 14px;
}
.arena-players-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 14px;
}
.arena-waiting {
  color: #94a3b8;
  font-size: 12px;
  font-style: italic;
}
.arena-player-row {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  align-items: center;
}
.arena-player-row.me {
  background: rgba(245,158,11,0.16);
  color: #fcd34d;
}
.arena-empty {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 14px;
  font-style: italic;
}
.arena-host-hint {
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
  margin: 0;
}

/* ===== Soru ekranı ===== */
.arena-question-screen { padding-top: 8px; }
.arena-question-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255,255,255,0.06);
  padding: 10px 14px;
  border-radius: 12px;
}
.arena-round-counter {
  font-size: 13px;
  color: #cbd5e1;
  font-weight: 600;
}
.arena-timer {
  font-size: 18px;
  font-weight: 800;
  color: #34d399;
}
.arena-timer.low {
  color: #ef4444;
  animation: arenaPulse 0.5s infinite alternate;
}
@keyframes arenaPulse {
  from { transform: scale(1); }
  to { transform: scale(1.15); }
}
.arena-question-clubs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 18px 12px;
}
.arena-club {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.06);
  border-radius: 14px;
  padding: 16px 8px;
  max-width: 160px;
}
.arena-club-logo {
  width: 54px;
  height: 54px;
  object-fit: contain;
}
.arena-club strong {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
  text-align: center;
  line-height: 1.2;
}
.arena-vs {
  font-size: 22px;
  font-weight: 800;
  color: #f59e0b;
}
.arena-question-prompt {
  text-align: center;
  font-size: 15px;
  color: #cbd5e1;
  padding: 0 12px;
}
.arena-answer-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 12px;
}
/* Marathon answer-row ile aynı düzen: input | check butonu */
.arena-answer-row {
  display: grid;
  grid-template-columns: 7fr 3fr;
  gap: 8px;
}
.arena-autocomplete-wrap {
  position: relative;
}
.arena-answer-input {
  font-size: 17px;
  padding: 14px 16px;
  width: 100%;
  min-height: 50px;
}
.arena-check-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  border: 0;
  border-radius: 12px;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 50px;
}
.arena-check-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
}
.arena-check-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}
.arena-check-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.arena-submit { font-size: 16px; }
.arena-hint {
  text-align: center;
  color: #94a3b8;
  font-size: 12px;
}
.arena-my-result {
  text-align: center;
  border-radius: 14px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 12px;
}
.arena-my-result.correct {
  background: rgba(52,211,153,0.16);
  color: #34d399;
}
.arena-my-result.wrong {
  background: rgba(239,68,68,0.16);
  color: #fca5a5;
}
.arena-my-result strong {
  font-size: 22px;
}
.arena-score-gained {
  font-size: 18px;
  font-weight: 700;
  color: #fcd34d;
}
.arena-progress {
  padding: 0 12px;
}
.arena-progress small {
  color: #94a3b8;
  font-size: 12px;
}
.arena-progress-bar {
  height: 6px;
  background: rgba(255,255,255,0.06);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 4px;
}
.arena-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #ef4444);
  transition: width 0.3s ease;
}

/* ===== Leaderboard ===== */
.arena-leaderboard-screen { padding-top: 8px; }
.arena-correct-answers {
  text-align: center;
  background: rgba(245,158,11,0.10);
  border: 1px solid rgba(245,158,11,0.24);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.arena-correct-answers strong {
  font-size: 14px;
  color: #fcd34d;
}
.arena-correct-answers small {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.arena-correct-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  max-height: 116px;
  overflow-y: auto;
  padding: 2px 4px;
  /* Smooth scroll on mobile */
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: rgba(245,158,11,0.4) transparent;
}
.arena-correct-chips::-webkit-scrollbar {
  width: 4px;
}
.arena-correct-chips::-webkit-scrollbar-thumb {
  background: rgba(245,158,11,0.4);
  border-radius: 4px;
}
.arena-correct-chip {
  background: rgba(245,158,11,0.20);
  color: #fcd34d;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}
.arena-correct-chip.more {
  background: rgba(255,255,255,0.06);
  color: #94a3b8;
}
.arena-leaderboard-list {
  background: rgba(255,255,255,0.04);
  border-radius: 14px;
  padding: 14px;
}
.arena-leaderboard-title {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
}
.arena-leader-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 10px;
  margin-bottom: 4px;
  font-size: 14px;
  position: relative;
}
.arena-leader-row.me {
  background: rgba(245,158,11,0.16);
}
.arena-leader-row.top-1 {
  background: linear-gradient(90deg, rgba(252,211,77,0.22), rgba(245,158,11,0.10));
}
.arena-leader-row.top-2 {
  background: linear-gradient(90deg, rgba(203,213,225,0.16), rgba(255,255,255,0.05));
}
.arena-leader-row.top-3 {
  background: linear-gradient(90deg, rgba(217,119,6,0.16), rgba(245,158,11,0.05));
}
.arena-leader-rank {
  font-weight: 800;
  text-align: center;
  color: #94a3b8;
}
.arena-leader-row.top-1 .arena-leader-rank { color: #fcd34d; }
.arena-leader-row.top-2 .arena-leader-rank { color: #cbd5e1; }
.arena-leader-row.top-3 .arena-leader-rank { color: #fb923c; }
.arena-leader-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arena-leader-score {
  font-weight: 800;
  color: #f59e0b;
  display: flex;
  align-items: center;
  gap: 6px;
}
.arena-leader-gain {
  background: rgba(52,211,153,0.20);
  color: #34d399;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-style: normal;
  animation: arenaPop 0.4s ease;
}
@keyframes arenaPop {
  0% { transform: scale(0); opacity: 0; }
  60% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}

/* ===== Final ===== */
.arena-final-screen {
  align-items: center;
  text-align: center;
}
.arena-final-trophy {
  font-size: 80px;
  margin-top: 20px;
  animation: arenaSpin 2s ease;
}
@keyframes arenaSpin {
  0% { transform: rotate(0deg) scale(0); }
  100% { transform: rotate(360deg) scale(1); }
}
.arena-final-title {
  font-size: 28px;
  margin: 8px 0 0;
  font-weight: 900;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #ef4444 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: #fcd34d; /* fallback */
  text-shadow: 0 0 30px rgba(245, 158, 11, 0.35);
}
.arena-final-sub {
  color: #94a3b8;
  font-size: 13px;
  margin-bottom: 16px;
}
.arena-final-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  width: 100%;
  max-width: 480px;
}
.arena-share, .arena-exit { flex: 1; }
.arena-exit { background: rgba(255,255,255,0.10); }

/* ===== Info ===== */
.arena-info {
  background: rgba(255,255,255,0.04);
  border-radius: 14px;
  padding: 16px;
  margin-top: 8px;
}
.arena-info p {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: #cbd5e1;
}
.arena-info ul {
  margin: 0;
  padding-left: 18px;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.6;
}
.arena-info li { margin-bottom: 4px; }

.arena-loading {
  text-align: center;
  color: #94a3b8;
  padding: 40px;
  font-size: 14px;
}

/* Anasayfa Arena buton rengi (App.jsx mode card için) */
.mode-card-arena::before {
  background: linear-gradient(180deg, #f59e0b 0%, #ef4444 100%) !important;
}

/* Autocomplete (suggestions) */
.arena-autocomplete-wrap {
  position: relative;
  width: 100%;
}
.arena-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 10px;
  z-index: 50;
  /* App.jsx .suggestions ile parite: klavye açıkken visualViewport yüksekliğine
     göre küçülür, böylece 30 maddelik liste klavyenin arkasında kalmaz, scroll
     edilebilir kalır. JS desteklemeyen tarayıcıda 100dvh fallback. */
  max-height: min(360px, calc(var(--vv-height, 100dvh) - 200px));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  /* Son madde sıkışmasın, yukarı scroll edilebilsin diye nefes alanı. */
  padding-bottom: 72px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
}
.arena-suggestions button {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: #f1f5f9;
  padding: 10px 14px;
  font-size: 15px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.arena-suggestions button:last-child { border-bottom: 0; }
.arena-suggestions button:hover {
  background: rgba(245,158,11,0.16);
  color: #fcd34d;
}

/* Correct answers — logoyla birlikte */
.arena-correct-clubs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.arena-correct-clubs strong {
  font-size: 14px;
  color: #fcd34d;
}

/* Question clubs — TeamLogo size, ana oyunla aynı (56px) */
.arena-question-clubs .team-logo { --logo-size: 56px; }

`;
