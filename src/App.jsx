import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { PLAYERS, TEAMS, ANSWER_INDEX, getPairKey, getAnswers } from "./data/gameData";
import { TEAM_LOGOS } from "./data/teamLogos";
import { getDailyPuzzle, getTodayKey, getMsUntilNextPuzzle, calculateStreak } from "./data/dailyPuzzle";
import { initAnalytics, track, startTimer, endTimer } from "./analytics";
import AdminPanel from "./admin/AdminPanel";

const WINNING_SCORE = 3;
const ROUND_SECONDS = 20;
const ROUND_REVEAL_SECONDS = 3;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

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

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ı]/g, "i")
    .replace(/[ğ]/g, "g")
    .replace(/[ü]/g, "u")
    .replace(/[ş]/g, "s")
    .replace(/[ö]/g, "o")
    .replace(/[ç]/g, "c")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function buildSuggestionSearchTokens(player) {
  const rawValues = [player.name, ...(player.aliases || [])];
  const tokenSet = new Set();

  rawValues.forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;

    tokenSet.add(normalizeText(text));

    text
      .replaceAll("-", " ")
      .split(" ")
      .map((part) => normalizeText(part))
      .filter(Boolean)
      .forEach((part) => tokenSet.add(part));
  });

  return Array.from(tokenSet);
}

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

function getNameTokens(name) {
  return String(name || "")
    .replaceAll("-", " ")
    .split(" ")
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function playerPlayedForClub(player, clubName) {
  return player.normalizedClubs.has(normalizeText(clubName));
}

function getRoundAnswers(round) {
  return getAnswers(round.teams[0], round.teams[1]);
}

function answerNameMatchesInput(answerName, userInput, answersForRound = []) {
  const normalizedInput = normalizeText(userInput);
  if (!normalizedInput) return false;

  const normalizedAnswer = normalizeText(answerName);
  if (normalizedAnswer === normalizedInput) return true;

  const tokens = getNameTokens(answerName);
  if (!tokens.includes(normalizedInput)) return false;

  const sameTokenMatches = answersForRound.filter((answer) => getNameTokens(answer).includes(normalizedInput));

  return sameTokenMatches.length === 1;
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
    return `${acceptedAnswer} bu eşleşme için doğru cevap olarak görünüyor.`;
  }

  const player = findPlayerByInput(userInput);
  const teamA = round.teams[0];
  const teamB = round.teams[1];

  if (!player) {
    return `${userInput} oyuncu havuzunda bulunamadı.`;
  }

  const playedA = playerPlayedForClub(player, teamA);
  const playedB = playerPlayedForClub(player, teamB);

  if (playedA && !playedB) {
    return `${player.name}, ${teamA} takımında oynadı; ${teamB} takımında oynamadı.`;
  }

  if (!playedA && playedB) {
    return `${player.name}, ${teamB} takımında oynadı; ${teamA} takımında oynamadı.`;
  }

  if (!playedA && !playedB) {
    return `${player.name}, bu veri havuzuna göre ne ${teamA} ne de ${teamB} takımında oynamadı.`;
  }

  return `${player.name} bu eşleşme için doğru olmalıydı; veri kontrolü gerekiyor.`;
}

function getCorrectPlayersForRound(round) {
  return getRoundAnswers(round).map((name) => ({ name }));
}

function getPlayerSuggestions(userInput) {
  const query = normalizeText(userInput);
  if (query.length < 1) return [];

  return SORTED_PLAYERS
    .filter((player) => player.suggestionTokens.some((token) => token.startsWith(query)))
    .slice(0, 6);
}

function getRoundKey(round) {
  return getPairKey(round.teams[0], round.teams[1]);
}

// =================== TAKIM AĞIRLIKLI SEÇİM ===================
// Popüler takımlar daha sık çıkar, Tier 3 birbiriyle veya Tier 2 ile hiç eşleşmez.

const TIER_1_TEAMS = [
  // Türk takımları (hepsi popüler) — yeni data ile uyumlu isimler
  "Galatasaray", "Beşiktaş", "Fenerbahçe", "Trabzonspor", "Başakşehir",
  "Antalyaspor", "Konyaspor", "Sivasspor", "Kayserispor", "Alanyaspor",
  "Samsunspor", "Kasımpaşa", "Gaziantep FK",
  "Rizespor", "Gençlerbirliği", "Göztepe",
  "Karagümrük", "Eyüpspor", "Kocaelispor",
  // Avrupa devleri (yeni data isimleriyle)
  "Real Madrid", "Barcelona", "Atletico Madrid", "Bayern Munich",
  "Manchester United", "Manchester City", "Liverpool", "Chelsea", "Arsenal",
  "Juventus", "AC Milan", "Inter", "Borussia Dortmund", "Paris Saint-Germain"
];

const TIER_2_TEAMS = [
  "Tottenham", "Napoli", "AS Roma", "Ajax", "FC Porto",
  "Benfica", "Sevilla", "Newcastle", "LOSC Lille",
  "Atalanta", "Lazio", "Leverkusen", "Sporting CP",
  "Aston Villa", "Valencia", "Villarreal", "Real Sociedad",
  "Athletic Bilbao", "Fiorentina", "Marsilya", "Monaco",
  "Feyenoord", "PSV", "West Ham", "Everton"
];

const TIER_1_SET = new Set(TIER_1_TEAMS);
const TIER_2_SET = new Set(TIER_2_TEAMS);

// =================== ZORLUK SEVİYELERİ ===================
// Kolay: Top Avrupa + 3 Türk büyüğü
// Orta:  Yukarıdakiler + Tier 2
// Zor:   Tüm takımlar

const EASY_TEAMS = new Set([
  // Top Avrupa devleri
  "Real Madrid", "Barcelona", "Bayern Munich",
  "Manchester United", "Manchester City", "Liverpool", "Chelsea", "Arsenal",
  "Juventus", "AC Milan", "Inter", "Paris Saint-Germain",
  "Atletico Madrid", "Borussia Dortmund",
  // Üç büyük Türk
  "Fenerbahçe", "Beşiktaş", "Galatasaray"
]);

// Orta = Easy ∪ Tier 2 ∪ (orta Türk: Trabzonspor, Başakşehir)
const MEDIUM_TEAMS = new Set([
  ...EASY_TEAMS,
  ...TIER_2_TEAMS,
  "Trabzonspor", "Başakşehir"
]);

function isPairInDifficulty(pair, difficulty) {
  const [a, b] = pair.teams;
  if (difficulty === "easy") return EASY_TEAMS.has(a) && EASY_TEAMS.has(b);
  if (difficulty === "medium") return MEDIUM_TEAMS.has(a) && MEDIUM_TEAMS.has(b);
  return true; // hard
}

function getDifficultyLabel(d) {
  if (d === "easy") return "Kolay";
  if (d === "medium") return "Orta";
  return "Zor";
}

function getDifficultyEmoji(d) {
  if (d === "easy") return "🟢";
  if (d === "medium") return "🟡";
  return "🔴";
}

function getTier(teamName) {
  if (TIER_1_SET.has(teamName)) return 1;
  if (TIER_2_SET.has(teamName)) return 2;
  return 3;
}

// Tier çiftine göre ağırlık (0 = hiç çıkmaz)
// {1,1}=10, {1,2}=5, {2,2}=3, {1,3}=1, {2,3}=0, {3,3}=0
function getPairWeight(pair) {
  const t1 = getTier(pair.teams[0]);
  const t2 = getTier(pair.teams[1]);
  const tierKey = [t1, t2].sort().join("-");
  switch (tierKey) {
    case "1-1": return 10;
    case "1-2": return 5;
    case "2-2": return 3;
    case "1-3": return 1;
    case "2-3": return 0;
    case "3-3": return 0;
    default: return 1;
  }
}

const PLAYABLE_TEAM_PAIRS = Object.keys(ANSWER_INDEX).map((key) => {
  const [teamA, teamB] = key.split("|");
  return { teams: [teamA, teamB] };
});

// Sıfır ağırlıklı çiftleri ve yalnızca 1 ortak oyuncusu olan çiftleri havuzdan çıkar
const WEIGHTED_TEAM_PAIRS = PLAYABLE_TEAM_PAIRS.filter((pair) => {
  if (getPairWeight(pair) <= 0) return false;
  const key = getPairKey(pair.teams[0], pair.teams[1]);
  return (ANSWER_INDEX[key] || []).length >= 2;
});

function getPlayableTeamPairs() {
  return WEIGHTED_TEAM_PAIRS;
}

function getRandomRound(usedRoundKeys = [], difficulty = "hard") {
  const filtered = WEIGHTED_TEAM_PAIRS.filter((round) => isPairInDifficulty(round, difficulty));
  const basePool = filtered.length > 0 ? filtered : WEIGHTED_TEAM_PAIRS;
  const available = basePool.filter((round) => !usedRoundKeys.includes(getRoundKey(round)));
  const pool = available.length > 0 ? available : basePool;

  // Ağırlıklı rastgele seçim
  const totalWeight = pool.reduce((sum, pair) => sum + getPairWeight(pair), 0);
  if (totalWeight <= 0) {
    return pool[Math.floor(Math.random() * pool.length)] || { teams: ["Fenerbahçe", "Galatasaray"] };
  }

  let random = Math.random() * totalWeight;
  for (const pair of pool) {
    random -= getPairWeight(pair);
    if (random <= 0) return pair;
  }

  return pool[pool.length - 1] || { teams: ["Fenerbahçe", "Galatasaray"] };
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
  console.assert(getPlayerSuggestions("xzy").length === 0, "Suggestions should be empty when there is no match");
  console.assert(getPlayableTeamPairs().length > 0 && getPlayableTeamPairs().length <= Object.keys(ANSWER_INDEX).length, "Playable pairs subset of ANSWER_INDEX");
  console.assert(getPlayableTeamPairs().length > 0, "There should be playable team pairs");
  console.assert(WINNING_SCORE === 3, "Winning score should be 3");
}

runSelfTests();

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

function TeamLogo({ teamName, size = "md" }) {
  const data = TEAM_LOGOS[teamName] || {};
  const [logoError, setLogoError] = useState(false);

  const initials = data.initials || teamName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  const showImage = Boolean(data.logo) && !logoError;

  return (
    <div
      className={`team-logo size-${size} ${showImage ? "has-image" : "fallback"}`}
      style={{
        "--team-primary": data.primary || "#10b981",
        "--team-secondary": data.secondary || "#ffffff"
      }}
      aria-label={`${teamName} logosu`}
    >
      <div className="team-logo__inner">
        {showImage ? (
          <img
            src={data.logo}
            alt={`${teamName} logo`}
            loading="lazy"
            onError={() => setLogoError(true)}
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>
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
        <em>sn</em>
      </div>
    </div>
  );
}

function AcceptedPlayersBox({ title = "Kabul edilen oyuncular", players, actualAnswer, onReportPlayer }) {
  if (!players?.length) return null;

  const normalizedActual = normalizeText(actualAnswer);
  const otherPlayers = players.filter((player) => normalizeText(player.name) !== normalizedActual);
  const visiblePlayers = otherPlayers.length ? otherPlayers : players;

  return (
    <div className="answers-box">
      <strong>{title}</strong>
      <div className="answer-tags">
        {visiblePlayers.slice(0, 12).map((player) => (
          <button key={player.name} type="button" onClick={() => onReportPlayer?.(player)} title="Hatalı olduğunu düşünüyorsan tıkla">
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
        <strong>Cevap kontrolü</strong>
        <p>{report.feedback}</p>
        <button type="button" className="light-button compact" onClick={onReport}>
          Bu cevap doğru olmalıydı, bildir
        </button>
      </div>
    </div>
  );
}

function ChallengeGameOver({
  score, best, isNewBest, lastWrongAnswer, correctPlayers,
  teamA, teamB, wrongReport, reportStatus,
  onSubmitWrongReport, onReportAcceptedPlayer, onRestart
}) {
  const showWrongReport = wrongReport && lastWrongAnswer;
  const playerCount = correctPlayers?.length || 0;

  return (
    <div className="challenge-gameover">
      <div className="gameover-header">
        <div className={`gameover-icon ${isNewBest ? "trophy" : ""}`}>
          {isNewBest ? "🏆" : "🎯"}
        </div>
        <div className="gameover-headline">
          <h3>{isNewBest ? "Yeni Rekor!" : "Seri Bitti"}</h3>
          {lastWrongAnswer && (
            <p className="gameover-detail">
              "<strong>{lastWrongAnswer}</strong>" bu eşleşmede yok
            </p>
          )}
        </div>
      </div>

      <div className="gameover-stats">
        <div className="gameover-stat">
          <span>Bu seri</span>
          <strong>{score}</strong>
        </div>
        <div className={`gameover-stat ${isNewBest ? "highlight" : ""}`}>
          <span>{isNewBest ? "🔥 Yeni En iyi" : "En iyi"}</span>
          <strong>{best}</strong>
        </div>
      </div>

      {playerCount > 0 && (
        <div className="gameover-section">
          <span className="gameover-label">
            Doğru cevaplar {playerCount > 6 && `(${playerCount})`}
          </span>
          <div className="gameover-players">
            {correctPlayers.slice(0, 6).map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => onReportAcceptedPlayer?.(p)}
                title="Hatalı mı? Tıkla bildir"
                className="gameover-player-chip"
              >
                {p.name}
              </button>
            ))}
            {playerCount > 6 && (
              <span className="gameover-more">+{playerCount - 6}</span>
            )}
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
              <strong>"{lastWrongAnswer}"</strong> doğru olmalıydı?
            </span>
          </span>
          <span className="gameover-report-cta">Bildir →</span>
        </button>
      )}

      <StatusMessage message={reportStatus} />

      <button
        type="button"
        onClick={onRestart}
        className="primary-button big gameover-restart"
      >
        🔁 Yeni Challenge
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
          <span>Kazanan</span>
          <strong>{playerNames[winner]}</strong>
        </div>
        <div>
          <span>Skor</span>
          <strong>{scores[0]} - {scores[1]}</strong>
        </div>
        <div>
          <span>Hedef</span>
          <strong>{targetScore}</strong>
        </div>
        <div>
          <span>Seri</span>
          <strong>{seriesWins[0]} - {seriesWins[1]}</strong>
        </div>
      </div>

      {currentCorrectRounds.length > 0 && (
        <div className="correct-rounds-summary">
          <strong>Doğru cevaplar <span className="answers-count">({currentCorrectRounds.length})</span></strong>
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

function playTone({ frequencies = [440], duration = 0.18, type = "sine", volume = 0.08 }) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    gain.connect(audioContext.destination);

    frequencies.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.06);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.06);
      oscillator.stop(now + duration + index * 0.06);
    });

    window.setTimeout(() => {
      audioContext.close?.();
    }, Math.ceil((duration + frequencies.length * 0.06) * 1000) + 80);
  } catch {
    // Sound is optional
  }
}

function playGameSound(soundName) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem("footballGameMuted") === "true") return;

  const soundMap = {
    ownGoal: { frequencies: [523.25, 659.25, 783.99, 1046.5], duration: 0.34, type: "triangle", volume: 0.09 },
    opponentGoal: { frequencies: [392, 349.23, 293.66], duration: 0.34, type: "sawtooth", volume: 0.055 },
    wrong: { frequencies: [180, 130], duration: 0.28, type: "square", volume: 0.045 },
    matchEnd: { frequencies: [392, 523.25, 659.25, 783.99, 1046.5], duration: 0.48, type: "triangle", volume: 0.085 },
    countdown: { frequencies: [440], duration: 0.08, type: "sine", volume: 0.035 }
  };

  playTone(soundMap[soundName] || soundMap.countdown);
}

export default function App() {
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

  const clientIdRef = useRef(makeClientId());
  const channelRef = useRef(null);
  const stateRef = useRef(null);

  const [screen, setScreen] = useState("home");
  const [soundEnabled, setSoundEnabled] = useState(() => window.localStorage.getItem("footballGameMuted") !== "true");
  const [connectionStatus, setConnectionStatus] = useState("offline");
  const [playerName, setPlayerName] = useState("Oyuncu");
  const [roomInput, setRoomInput] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [playerIndex, setPlayerIndex] = useState(null);

  const [targetScore, setTargetScore] = useState(3);
  const [playerNames, setPlayerNames] = useState(["Oyuncu 1", "Oyuncu 2"]);
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
  const [onlineDifficulty, setOnlineDifficulty] = useState("medium");
  const [showChallengeStartScreen, setShowChallengeStartScreen] = useState(false);
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
      playGameSound("ownGoal");
    }

    if (challengeLastAction.type === "wrong") {
      playGameSound("wrong");
    }
  }, [challengeLastAction]);

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
      correctRounds
    };
  }, [
    screen, playerNames, playersReady, opponentJoined, gameStarted, targetScore,
    scores, round, usedRoundKeys, message, winner, showAnswers, roundLocked,
    roundEndsAt, preRoundEndsAt, wrongAttempts, lastAction, seriesWins,
    matchHistory, correctRounds
  ]);

  const applyGameState = (gameState) => {
    if (!gameState) return;

    setScreen(gameState.screen || "game");
    setPlayerNames(gameState.playerNames || ["Oyuncu 1", "Oyuncu 2"]);
    setPlayersReady(gameState.playersReady || [false, false]);
    setOpponentJoined(Boolean(gameState.opponentJoined) || playerIndex === 1);
    setGameStarted(Boolean(gameState.gameStarted));
    setTargetScore(gameState.targetScore || 3);
    setScores(gameState.scores || [0, 0]);
    setRound(gameState.round || getRandomRound());
    setUsedRoundKeys(gameState.usedRoundKeys || []);
    setAnswerInput("");
    setFocusedInput(false);
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
    matchHistory, correctRounds, ...overrides
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

        const joinedName = payload.name || "Oyuncu 2";
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
          message: { type: "info", text: `${joinedName} odaya katıldı. Oyunu başlatmak için iki oyuncu da hazır olmalı.` }
        };

        applyGameState(nextState);
        await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
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
          await sendRoomEvent({ type: "PLAYER_JOINED", name: playerName || "Oyuncu 2" });
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
    const firstRound = getRandomRound([], onlineDifficulty);
    const name = playerName.trim() || "Oyuncu 1";

    setRoomCode(code);
    setRoomInput(code);
    setPlayerIndex(0);
    setTargetScore(Number(targetScore));
    setPlayerNames([name, "Rakip bekleniyor"]);
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
      setMessage({ type: "error", text: "Odaya katılmak için oda kodu yazmalısın." });
      return;
    }

    const name = playerName.trim() || "Oyuncu 2";

    setRoomCode(code);
    setPlayerIndex(1);
    setPlayerNames(["Oyuncu 1", name]);
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
      setMessage({ type: "success", text: "Davet linki kopyalandı." });
    } catch {
      setMessage({ type: "info", text: `Davet linki: ${url}` });
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
    if (!opponentJoined) return "Rakip bekleniyor.";
    if (playersReady[0] && playersReady[1]) return "İki oyuncu da hazır. Oyun başlıyor.";
    if (playersReady[playerIndex]) return "Sen hazırsın. Rakip bekleniyor.";
    const opponentIndex = playerIndex === 0 ? 1 : 0;
    if (playersReady[opponentIndex]) return "Rakip hazır. Senin de hazır olman lazım.";
    return "Oyuna başlamak için iki oyuncu da butona basmalı.";
  };

  const pressStartGame = async () => {
    if (!opponentJoined) {
      setMessage({ type: "info", text: "Rakip odaya bağlanmadan oyun başlatılamaz." });
      return;
    }

    const nextReady = [...playersReady];
    nextReady[playerIndex] = true;

    const bothReady = nextReady[0] && nextReady[1];
    const nextPreRoundEndsAt = bothReady ? Date.now() + ROUND_REVEAL_SECONDS * 1000 : null;
    const nextMessage = bothReady
      ? { type: "success", text: "İki oyuncu da hazır. 3 saniye sonra takımlar açılacak!" }
      : { type: "info", text: `${playerNames[playerIndex]} hazırlandı. Diğer oyuncu bekleniyor.` };

    const nextState = {
      screen: "game",
      playerNames,
      playersReady: nextReady,
      opponentJoined: true,
      gameStarted: bothReady,
      targetScore, scores, round, usedRoundKeys,
      message: nextMessage,
      winner: null, showAnswers: false, roundLocked: false,
      roundEndsAt: null,
      preRoundEndsAt: nextPreRoundEndsAt,
      wrongAttempts: [0, 0], lastAction: null,
      seriesWins, matchHistory, correctRounds
    };

    setPlayersReady(nextReady);
    setGameStarted(bothReady);
    setRoundEndsAt(null);
    setPreRoundEndsAt(nextPreRoundEndsAt);
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(ROUND_REVEAL_SECONDS);
    setWrongAttempts([0, 0]);
    setLastAction(null);
    setLastWrongReport(null);
    setReportStatus(null);
    setMessage(nextMessage);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const nextRound = async () => {
    if (playerIndex !== 0) {
      setMessage({ type: "info", text: "Sonraki turu oda sahibi başlatabilir." });
      return;
    }

    const next = getRandomRound(usedRoundKeys);
    const nextPreRoundEndsAt = Date.now() + ROUND_REVEAL_SECONDS * 1000;
    const nextKey = getRoundKey(next);
    const playableCount = getPlayableTeamPairs().length;
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

  const resetGame = async () => {
    const firstRound = getRandomRound([]);
    const nextState = {
      screen: "game", playerNames,
      playersReady: [false, false],
      opponentJoined, gameStarted: false,
      targetScore, scores: [0, 0],
      round: firstRound,
      usedRoundKeys: [getRoundKey(firstRound)],
      message: { type: "info", text: "Oyun yeniden başlatıldı. İki oyuncu da hazır olmalı." },
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
      setMessage({ type: "info", text: "Oyun henüz başlamadı." });
      return;
    }
    if (roundLocked) {
      setMessage({ type: "info", text: "Bu tur bitti. Sonraki Tur'a basın." });
      return;
    }
    if (isPreRound) {
      setMessage({ type: "info", text: "Takımlar açılmadan cevap veremezsin." });
      return;
    }
    if (myWrongAttemptUsed) {
      setMessage({ type: "info", text: "Bu turdaki yanlış hakkını kullandın. Rakibi bekle." });
      return;
    }

    const raw = answerInput;
    const normalized = normalizeText(raw);

    if (!normalized) {
      setMessage({ type: "error", text: "Önce bir futbolcu adı yazmalısın." });
      return;
    }

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
        ? `${wrongExplanation} İki oyuncu da yanlış hakkını kullandı. Tur bitti.`
        : `${wrongExplanation} Yanlış hakkın bitti. Rakibin süre bitene kadar cevap verebilir.`
    };
    const sharedWrongMessage = {
      type: bothPlayersUsedWrong ? "error" : "info",
      text: bothPlayersUsedWrong
        ? `${wrongExplanation} İki oyuncu da yanlış hakkını kullandı. Tur bitti.`
        : `${playerNames[playerIndex] || "Rakip"} yanlış cevap verdi. Diğer oyuncunun hakkı devam ediyor.`
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
      correctRounds: []
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
      setMessage({ type: "info", text: "Cevapları sadece oda sahibi gösterebilir." });
      return;
    }

    if (roundLocked) return;

    const nextMessage = { type: "info", text: "Tur geçildi. Cevapları aşağıda görebilirsin." };
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

    const nextMessage = { type: "info", text: "Süre doldu. Tur bitti." };
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
    // Önce zorluk seçim ekranı
    setShowChallengeStartScreen(true);
    setScreen("challenge");
  };

  const confirmStartChallenge = (difficulty) => {
    setChallengeDifficulty(difficulty);
    setShowChallengeStartScreen(false);
    const firstRound = getRandomRound([], difficulty);
    setChallengeScore(0);
    setChallengeLastScore(null);
    setChallengeRound(firstRound);
    setChallengeUsedRoundKeys([getRoundKey(firstRound)]);
    setChallengeInput("");
    setChallengeFocused(false);
    setChallengeMessage({ type: "info", text: "Challenge başladı. 3 saniye sonra takımlar gelecek." });
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
    track("mode_started", { mode: "challenge", difficulty });
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
    const data = getDailyPuzzle(WEIGHTED_TEAM_PAIRS);
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
    const acceptedName = findAcceptedAnswer(round, raw);

    if (acceptedName) {
      if (dailyAcceptedThisRound.includes(acceptedName)) {
        setDailyMessage({ type: "warning", text: "Bu cevabı zaten verdin." });
        setDailyInput("");
        return;
      }
      // Doğru!
      setDailyAcceptedThisRound([...dailyAcceptedThisRound, acceptedName]);
      setDailyInput("");
      setDailyMessage({ type: "success", text: `Doğru: ${acceptedName}!` });
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
        setDailyMessage({ type: "error", text: "3 yanlış. Bu eşleşme X." });
        setTimeout(() => advanceDailyToNext("failed"), 1800);
      } else {
        setDailyMessage({ type: "error", text: `Yanlış. Kalan hak: ${3 - nextWrong}` });
      }
    }
  };

  const skipDailyPuzzle = () => {
    setDailyShowAnswers(true);
    setDailyMessage({ type: "info", text: "Atlandı." });
    setTimeout(() => advanceDailyToNext("failed"), 1200);
  };

  const buildDailyShareText = () => {
    if (!dailyData || !dailyResults.length) return "";
    const correctCount = dailyResults.filter((r) => r === "correct").length;
    const total = dailyData.puzzles.length;
    const grid = dailyResults.map((r) => (r === "correct" ? "🟩" : "🟥")).join("");
    const dateStr = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(new Date(dailyData.date));
    const streakLine = dailyStreak > 1 ? `\n🔥 ${dailyStreak} gün üst üste\n` : "\n";
    return `PairFC ${dateStr} — ${correctCount}/${total}\n\n${grid}${streakLine}\nhttps://pairfc.com`;
  };

  const [dailyShareStatus, setDailyShareStatus] = useState(null);
  const shareDailyResult = async () => {
    const text = buildDailyShareText();
    if (!text) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "PairFC", text });
        setDailyShareStatus({ type: "success", text: "Paylaşıldı!" });
        track("daily_shared", { method: "native" });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setDailyShareStatus({ type: "success", text: "📋 Panoya kopyalandı!" });
        track("daily_shared", { method: "clipboard" });
      } else {
        setDailyShareStatus({ type: "info", text: "Paylaşım desteklenmiyor." });
        track("daily_shared", { method: "unsupported" });
      }
    } catch (e) {
      // Kullanıcı share dialogunu iptal etti — sessizce yut
      if (e.name !== "AbortError") {
        setDailyShareStatus({ type: "error", text: "Paylaşılamadı." });
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
      setDailyCountdown(`${h}sa ${m}dk`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  const goToHome = () => {
    if (screen === "challenge") {
      backToHomeFromChallenge();
      return;
    }
    if (screen === "daily") {
      setScreen("home");
      return;
    }
    if (screen === "game" || screen === "winner") {
      // Online oyundan ayrıl
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setRoomCode("");
      setRoundEndsAt(null);
      setPreRoundEndsAt(null);
    }
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
        endChallenge("Süre doldu.");
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
      setChallengeMessage({ type: "info", text: "İlk harf jokerini bu maçta zaten kullandın." });
      return;
    }
    if (challengeIsPreRound || challengeRoundLocked) {
      setChallengeMessage({ type: "info", text: "Jokeri sadece aktif turda kullanabilirsin." });
      return;
    }
    const first = challengeCorrectPlayers[0];
    if (!first) {
      setChallengeMessage({ type: "info", text: "Bu tur için joker üretilemedi." });
      return;
    }
    const parts = first.name.split(" ").filter(Boolean);
    const last = parts[parts.length - 1] || first.name;
    const hint = `${first.name[0]?.toUpperCase() || "?"} ile başlıyor, soyadı ${last[0]?.toUpperCase() || "?"} ile başlıyor.`;
    setChallengeFirstLetterUsed(true);
    setChallengeJokerHint(hint);
    setChallengeMessage({ type: "info", text: `🎯 İpucu: ${hint}` });
    track("joker_used", { type: "firstLetter" });
  };

  // ===== JOKER: Çift Değiştir =====
  const useSwapPairJoker = () => {
    if (challengeSwapUsed) {
      setChallengeMessage({ type: "info", text: "Çift değiştir jokerini bu maçta zaten kullandın." });
      return;
    }
    if (challengeIsPreRound || challengeRoundLocked) {
      setChallengeMessage({ type: "info", text: "Jokeri sadece aktif turda kullanabilirsin." });
      return;
    }
    const currentKey = getRoundKey(challengeRound);
    const nextUsed = [...challengeUsedRoundKeys, currentKey];
    const nextRound = getRandomRound(nextUsed, challengeDifficulty);
    setChallengeSwapUsed(true);
    setChallengeRound(nextRound);
    setChallengeUsedRoundKeys(nextUsed);
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
    setChallengeMessage({ type: "info", text: "🔄 Çift değiştirildi. Yeni takımlar geliyor." });
    track("joker_used", { type: "swap" });
  };

  // ===== JOKER: Süre +5 =====
  const useTimeAddJoker = () => {
    if (challengeTimeAddUsed) {
      setChallengeMessage({ type: "info", text: "Süre jokerini bu maçta zaten kullandın." });
      return;
    }
    if (challengeIsPreRound || challengeRoundLocked || !challengeRoundEndsAt) {
      setChallengeMessage({ type: "info", text: "Jokeri sadece aktif turda kullanabilirsin." });
      return;
    }
    setChallengeTimeAddUsed(true);
    setChallengeRoundEndsAt((prev) => prev + 5000);
    setChallengeTimeLeft((prev) => prev + 5);
    setChallengeMessage({ type: "info", text: "⏱️ Süreye 5 saniye eklendi!" });
    track("joker_used", { type: "timeAdd" });
  };

  const revealChallengeAnswerAndEnd = () => {
    const first = challengeCorrectPlayers[0];
    const reason = first
      ? `Cevap gösterildi. Örnek: ${first.name}.`
      : "Cevap gösterildi ancak kayıtlı doğru cevap bulunamadı.";

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
      setChallengeMessage({ type: "info", text: "Takımlar açılmadan cevap veremezsin." });
      return;
    }

    if (challengeRoundLocked) {
      setChallengeMessage({ type: "info", text: "Challenge bitti. Yeni challenge başlatabilirsin." });
      return;
    }

    const raw = challengeInput;
    const normalized = normalizeText(raw);

    if (!normalized) {
      setChallengeMessage({ type: "error", text: "Önce bir futbolcu adı yazmalısın." });
      return;
    }

    if (isCorrectAnswer(challengeRound, raw)) {
      const nextScore = challengeScore + 1;
      const nextRound = getRandomRound(challengeUsedRoundKeys, challengeDifficulty);
      const nextKey = getRoundKey(nextRound);
      const playableCount = getPlayableTeamPairs().length;
      const nextUsed = challengeUsedRoundKeys.length >= playableCount ? [nextKey] : [...challengeUsedRoundKeys, nextKey];

      setChallengeScore(nextScore);
      setChallengeBest((currentBest) => {
        const nextBest = Math.max(currentBest, nextScore);
        window.localStorage.setItem("footballChallengeBest", String(nextBest));
        return nextBest;
      });
      setChallengeRound(nextRound);
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
      setChallengeLastWrongReport(null);
      setChallengeReportStatus(null);
      setChallengeJokerHint(null);
      setChallengeFeedback("correct");
      triggerConfetti();
      triggerScreenFlash("success");
      setTimeout(() => setChallengeFeedback(null), 800);
      setChallengeMessage({ type: "success", text: `Doğru! Seri: ${nextScore}. 3 sn sonra yeni tur.` });
      return;
    }

    endChallenge(getWrongAnswerExplanation(challengeRound, raw), raw, challengeRound);
  };

  const startRematch = async () => {
    const next = getRandomRound([]);
    const nextState = {
      screen: "game",
      playerNames,
      playersReady: [false, false],
      opponentJoined: true, gameStarted: false,
      targetScore, scores: [0, 0],
      round: next,
      usedRoundKeys: [getRoundKey(next)],
      message: { type: "info", text: "Rövanş hazır. İki oyuncu da hazır olmalı." },
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

    setStatus({ type: "info", text: "Bildirim gönderiliyor..." });

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
      setStatus({ type: "error", text: `Bildirim kaydedilemedi: ${error.message}` });
      return;
    }

    setStatus({ type: "success", text: "Bildirim alındı, teşekkürler." });
    clearReport();
  };

  const toggleSound = () => {
    setSoundEnabled((current) => {
      const next = !current;
      window.localStorage.setItem("footballGameMuted", next ? "false" : "true");
      if (next) {
        playGameSound("countdown");
      }
      return next;
    });
  };

  useEffect(() => {
    window.localStorage.setItem("footballGameMuted", soundEnabled ? "false" : "true");
  }, [soundEnabled]);

  const isHome = screen === "home";
  const isGameLike = screen === "game" || screen === "winner";
  const isChallenge = screen === "challenge";
  const isDaily = screen === "daily";

  return (
    <div className={`app-shell ${isHome ? "home-screen" : "play-screen"}`}>
      <style>{css}</style>

      {showSplash && (
        <div className="splash-screen">
          <div className="splash-content">
            <div className="splash-logo">⚽</div>
            <h1 className="splash-title">PairFC</h1>
            <p className="splash-tagline">İki takım, tek futbolcu.</p>
            <p className="splash-tagline-sub">Sen bul.</p>
            <div className="splash-loader"><span></span><span></span><span></span></div>
          </div>
        </div>
      )}

      {showInstallModal && (
        <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
          <div className="modal-content install-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setShowInstallModal(false)}>✕</button>
            <h2>📲 Uygulamayı Yükle</h2>
            <p>PairFC'yi ana ekranına ekleyerek bir uygulama gibi kullan. Çevrimdışı da çalışır.</p>

            <div className="install-platform">
              <h3>🍎 iPhone / iPad (Safari)</h3>
              <ol>
                <li>Aşağıdaki <strong>Paylaş</strong> simgesine bas <span className="install-icon">⬆️</span></li>
                <li>Açılan menüde <strong>"Ana Ekrana Ekle"</strong> seçeneğini seç</li>
                <li>Sağ üstte <strong>"Ekle"</strong> tıkla</li>
              </ol>
            </div>

            <div className="install-platform">
              <h3>🤖 Android (Chrome)</h3>
              <ol>
                <li>Sağ üstte <strong>3 nokta menüsüne</strong> bas <span className="install-icon">⋮</span></li>
                <li><strong>"Uygulamayı yükle"</strong> veya <strong>"Ana ekrana ekle"</strong> seç</li>
                <li><strong>"Yükle"</strong> tıkla</li>
              </ol>
            </div>

            <button type="button" onClick={() => setShowInstallModal(false)} className="primary-button big" style={{ width: "100%", marginTop: 12 }}>
              Anladım
            </button>
          </div>
        </div>
      )}

      <div className="app-frame">
        <header className={`topbar ${isHome ? "" : "topbar-compact"}`}>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="14" fill="#ffffff" stroke="#0f172a" strokeWidth="1.5"/>
                <polygon points="16,9 22,13 20,20 12,20 10,13" fill="#0f172a"/>
                <line x1="16" y1="9" x2="16" y2="4" stroke="#0f172a" strokeWidth="1.3"/>
                <line x1="22" y1="13" x2="27" y2="11.5" stroke="#0f172a" strokeWidth="1.3"/>
                <line x1="20" y1="20" x2="24" y2="26" stroke="#0f172a" strokeWidth="1.3"/>
                <line x1="12" y1="20" x2="8" y2="26" stroke="#0f172a" strokeWidth="1.3"/>
                <line x1="10" y1="13" x2="5" y2="11.5" stroke="#0f172a" strokeWidth="1.3"/>
              </svg>
            </span>
            <div className="brand-text">
              <strong>PairFC</strong>
              {isHome && <small>İki takım, tek futbolcu. Sen bul.</small>}
            </div>
          </div>
          <div className="topbar-actions">
            {!isHome && (
              <button type="button" onClick={goToHome} className="icon-button home-button" aria-label="Ana Menü" title="Ana Menü">
                🏠
              </button>
            )}
            <button type="button" onClick={toggleSound} className="icon-button" aria-label={soundEnabled ? "Sesi kapat" : "Sesi aç"} title={soundEnabled ? "Ses açık" : "Ses kapalı"}>
              {soundEnabled ? "🔊" : "🔇"}
            </button>
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
                    ← Geri
                  </button>
                  <div className="online-setup-title">
                    <h2>🌍 Online Kapışma</h2>
                    <p>Ayarları yap, sonra oda kur veya bir koda katıl.</p>
                  </div>
                </div>
              )}

              {!showOnlineSetup && (
              <>
              <div className="stats-bar">
                <div className="stat-pill">
                  <span className="stat-icon">🔥</span>
                  <div className="stat-text">
                    <strong>{dailyStreak}</strong>
                    <small>Streak</small>
                  </div>
                </div>
                <div className="stat-pill">
                  <span className="stat-icon">🏆</span>
                  <div className="stat-text">
                    <strong>{challengeBest}</strong>
                    <small>En iyi</small>
                  </div>
                </div>
                <div className="stat-pill">
                  <span className="stat-icon">📅</span>
                  <div className="stat-text">
                    <strong>{dailyCountdown || "—"}</strong>
                    <small>Yarınki</small>
                  </div>
                </div>
              </div>

              <div className="mode-grid mode-grid-3">
                <button type="button" onClick={() => { setShowOnlineSetup(true); setOnlineSetupMode(null); }} className="mode-card mode-card-online">
                  <span className="mode-icon">🌍</span>
                  <strong>Online Kapışma</strong>
                  <small>Oda kur, arkadaşınla karşılıklı oyna.</small>
                </button>

                <button type="button" onClick={startChallenge} className="mode-card">
                  <span className="mode-icon">🔥</span>
                  <strong>Challenge</strong>
                  <small>Tek başına üst üste kaç doğru?</small>
                  <em className="best-badge">En iyi: {challengeBest}</em>
                </button>

                <button type="button" onClick={startDaily} className="mode-card mode-card-daily">
                  <span className="mode-icon">📅</span>
                  <strong>Günün Bulmacası</strong>
                  <small>Her gün 5 yeni eşleşme. Herkes aynı.</small>
                  {dailyStreak > 0 && <em className="best-badge streak-badge">🔥 {dailyStreak} gün</em>}
                </button>
              </div>

              {!isInstalled && (
                <button type="button" onClick={triggerInstall} className="install-banner">
                  <span className="install-banner-icon">📲</span>
                  <div className="install-banner-text">
                    <strong>Uygulamayı Yükle</strong>
                    <small>Ana ekrana ekle, hızlı ulaş</small>
                  </div>
                  <span className="install-banner-arrow">→</span>
                </button>
              )}
              </>
              )}

              {showOnlineSetup && (
              <>
              {!onlineSetupMode && (
                <div className="online-mode-picker">
                  <button type="button" onClick={() => setOnlineSetupMode("create")} className="online-action-card create">
                    <span className="online-action-icon">✨</span>
                    <strong>Oda Kur</strong>
                    <small>Yeni bir oyun başlat, arkadaşını davet et</small>
                    <span className="online-action-arrow">→</span>
                  </button>
                  <button type="button" onClick={() => setOnlineSetupMode("join")} className="online-action-card join">
                    <span className="online-action-icon">🔗</span>
                    <strong>Odaya Katıl</strong>
                    <small>Arkadaşının verdiği kodla bağlan</small>
                    <span className="online-action-arrow">→</span>
                  </button>
                </div>
              )}

              {onlineSetupMode === "create" && (
                <div className="online-form">
                  <div className="input-card">
                    <label htmlFor="playerNameInput">👤 Oyuncu adın</label>
                    <input
                      id="playerNameInput"
                      value={playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder="Örn. İsmet"
                      maxLength={20}
                    />
                  </div>

                  <div className="input-card">
                    <label>🎯 Bitiş puanı</label>
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

                  <div className="input-card">
                    <label>🎚️ Zorluk</label>
                    <div className="score-options">
                      {[
                        { v: "easy", label: "🟢 Kolay" },
                        { v: "medium", label: "🟡 Orta" },
                        { v: "hard", label: "🔴 Zor" }
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

                  <button type="button" onClick={createRoom} className="primary-button big full-width">
                    ✨ Oda Oluştur
                  </button>
                </div>
              )}

              {onlineSetupMode === "join" && (
                <div className="online-form">
                  <div className="input-card">
                    <label htmlFor="playerNameInput2">👤 Oyuncu adın</label>
                    <input
                      id="playerNameInput2"
                      value={playerName}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder="Örn. İsmet"
                      maxLength={20}
                    />
                  </div>

                  <div className="input-card">
                    <label htmlFor="roomCodeInput">🔑 Oda kodu</label>
                    <input
                      id="roomCodeInput"
                      value={roomInput}
                      onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
                      placeholder="Örn. ABC123"
                      maxLength={6}
                      style={{ textTransform: "uppercase", letterSpacing: 4, fontSize: 18, fontWeight: 800, textAlign: "center" }}
                    />
                  </div>

                  <button type="button" onClick={joinRoom} className="primary-button big full-width">
                    🔗 Odaya Katıl
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
                  <div className="difficulty-header">
                    <h2>🔥 Challenge</h2>
                    <p>Zorluk seviyesini seç</p>
                  </div>

                  <div className="difficulty-options">
                    <button type="button" onClick={() => confirmStartChallenge("easy")} className="difficulty-card easy">
                      <span className="difficulty-emoji">🟢</span>
                      <strong>Kolay</strong>
                      <small>Top Avrupa devleri + 3 büyük Türk</small>
                      <em>Real, Barça, Bayern, ManU, FB, GS, BJK...</em>
                    </button>

                    <button type="button" onClick={() => confirmStartChallenge("medium")} className="difficulty-card medium">
                      <span className="difficulty-emoji">🟡</span>
                      <strong>Orta</strong>
                      <small>Avrupa + tanınmış orta seviye</small>
                      <em>+ Tottenham, Napoli, Lazio, Ajax, Trabzon...</em>
                    </button>

                    <button type="button" onClick={() => confirmStartChallenge("hard")} className="difficulty-card hard">
                      <span className="difficulty-emoji">🔴</span>
                      <strong>Zor</strong>
                      <small>Tüm takımlar — niş kulüpler dahil</small>
                      <em>96 takım, sınırsız çeşitlilik</em>
                    </button>
                  </div>
                </div>
              ) : (
                <>
              <div className="info-bar challenge-bar">
                <div className="info-chip">
                  <span>Mod</span><strong>Challenge</strong>
                </div>
                <div className="info-chip">
                  <span>Zorluk</span><strong>{getDifficultyEmoji(challengeDifficulty)} {getDifficultyLabel(challengeDifficulty)}</strong>
                </div>
                <div className="info-chip accent">
                  <span>Seri</span><strong className={challengeFeedback === "correct" ? "score-pop" : ""}>{challengeScore}</strong>
                </div>
                <div className="info-chip">
                  <span>En iyi</span><strong>{challengeBest}</strong>
                </div>
              </div>

              {challengeIsPreRound ? (
                <div className="panel waiting-panel">
                  <div className="countdown-circle">{challengePreRoundLeft}</div>
                  <h2>Takımlar açılıyor</h2>
                  <p>Hazır ol!</p>
                </div>
              ) : (
                <div className={`play-panel ${challengeFeedback === "correct" ? "feedback-correct" : ""} ${challengeFeedback === "wrong" ? "feedback-wrong" : ""}`}>
                  <div className="play-header">
                    <CircularTimer value={challengeTimeLeft} max={ROUND_SECONDS} urgent={challengeTimeLeft <= 3 && !challengeRoundLocked} />
                    <div className="play-tools">
                      <div className="joker-buttons">
                        <button type="button" className="joker-button" onClick={useFirstLetterJoker} disabled={!challengeCanAnswer || challengeFirstLetterUsed} title="İlk harf">
                          <span className="joker-icon">🎯</span>
                          <span className="joker-label">İlk harf</span>
                        </button>
                        <button type="button" className="joker-button" onClick={useSwapPairJoker} disabled={!challengeCanAnswer || challengeSwapUsed} title="Çift değiştir">
                          <span className="joker-icon">🔄</span>
                          <span className="joker-label">Çift değiştir</span>
                        </button>
                        <button type="button" className="joker-button" onClick={useTimeAddJoker} disabled={!challengeCanAnswer || challengeTimeAddUsed} title="Süre +5">
                          <span className="joker-icon">⏱️</span>
                          <span className="joker-label">+5 sn</span>
                        </button>
                      </div>
                      <button type="button" className="light-button danger" onClick={revealChallengeAnswerAndEnd} disabled={challengeIsPreRound || challengeRoundLocked}>
                        👀 Cevabı göster
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
                      onRestart={startChallenge}
                    />
                  ) : (
                    <>
                      {challengeLastAction && challengeLastAction.type === "correct" && (
                        <div className="action-banner success">
                          <span className="action-emoji">⚽</span>
                          <strong>GOOOL!</strong>
                        </div>
                      )}

                      <div className="answer-card">
                        <div className="answer-row">
                          <div className="autocomplete-wrap">
                            <input
                              value={challengeInput}
                              disabled={!challengeCanAnswer}
                              onFocus={() => {
                                if (challengeCanAnswer && challengeInput) setChallengeFocused(true);
                              }}
                              onBlur={() => setTimeout(() => setChallengeFocused(false), 120)}
                              onChange={(event) => updateChallengeInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") submitChallengeAnswer();
                              }}
                              placeholder="Futbolcu adı yaz..."
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
                            Kontrol
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
                  <span>📅 Günlük</span>
                </div>
                {!dailyDone && dailyData && (
                  <div className="info-chip">
                    <span>Bulmaca</span>
                    <strong>{dailyIndex + 1} / {dailyData.puzzles.length}</strong>
                  </div>
                )}
                {dailyStreak > 0 && (
                  <div className="info-chip">
                    <span>🔥 Streak</span>
                    <strong>{dailyStreak}</strong>
                  </div>
                )}
              </div>

              {!dailyData && (
                <div className="panel">
                  <p>Günlük bulmaca yükleniyor...</p>
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
                            className={`daily-dot ${i === dailyIndex ? "current" : ""} ${r === "correct" ? "correct" : ""} ${r === "failed" ? "failed" : ""}`}
                          />
                        );
                      })}
                    </div>
                    <div className="daily-wrong-meter">
                      <span>Yanlış hakkı:</span>
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
                            onFocus={() => { if (dailyInput) setDailyFocused(true); }}
                            onBlur={() => setTimeout(() => setDailyFocused(false), 120)}
                            onChange={(event) => updateDailyInput(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") submitDailyAnswer(); }}
                            placeholder="Futbolcu adı yaz..."
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
                          Kontrol
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="action-banner error">
                      <span className="action-emoji">❌</span>
                      <strong>3 yanlış — sonraki eşleşmeye geçiliyor...</strong>
                    </div>
                  )}

                  <StatusMessage message={dailyMessage} />

                  {!dailyShowAnswers && (
                    <button type="button" onClick={skipDailyPuzzle} className="light-button compact daily-skip">
                      ⏭️ Bu eşleşmeyi atla
                    </button>
                  )}
                </div>
              )}

              {dailyDone && dailyData && (
                <div className="challenge-gameover">
                  <div className="gameover-header">
                    <div className="gameover-icon trophy">📅</div>
                    <div className="gameover-headline">
                      <h3>{dailyHistory[dailyData.date]?.completed ? "Bugünkü Bulmaca Çözüldü" : "Günün Bulmacası Bitti"}</h3>
                      <p className="gameover-detail">{new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(dailyData.date))}</p>
                    </div>
                  </div>

                  <div className="gameover-stats">
                    <div className="gameover-stat">
                      <span>Doğru</span>
                      <strong>{dailyResults.filter((r) => r === "correct").length} / {dailyData.puzzles.length}</strong>
                    </div>
                    <div className="gameover-stat highlight">
                      <span>🔥 Streak</span>
                      <strong>{dailyStreak}</strong>
                    </div>
                  </div>

                  <div className="gameover-section">
                    <span className="gameover-label">Bulmaca grid</span>
                    <div className="daily-grid-emoji">
                      {dailyResults.map((r, i) => (
                        <span key={i}>{r === "correct" ? "🟩" : "🟥"}</span>
                      ))}
                    </div>
                  </div>

                  <button type="button" onClick={shareDailyResult} className="primary-button big daily-share-button">
                    📤 Sonucu Paylaş
                  </button>

                  <StatusMessage message={dailyShareStatus} />

                  <div className="gameover-section daily-countdown-box">
                    <span className="gameover-label">⏳ Yarınki bulmacaya</span>
                    <strong className="daily-countdown-value">{dailyCountdown}</strong>
                  </div>

                  <button type="button" onClick={goToHome} className="light-button big">
                    🏠 Ana Menü
                  </button>
                </div>
              )}
            </section>
          )}

          {isGameLike && (
            <section className="play-content">
              <div className="info-bar">
                <div className="info-chip">
                  <span>Oda</span><strong>{roomCode}</strong>
                </div>
                <div className={`info-chip status-${connectionStatus}`}>
                  <span className="status-dot" aria-hidden="true"></span>
                  <strong>{connectionStatus === "online" ? "Online" : "Bağlanıyor"}</strong>
                </div>
                <div className="info-chip">
                  <span>Hedef</span><strong>{targetScore}</strong>
                </div>
                <button type="button" onClick={copyInvite} className="mini-button">📋 Link</button>
              </div>

              <div className="score-bar">
                <div className={`score-side ${playerIndex === 0 ? "me" : ""} ${winner === 0 ? "winner" : ""} ${scoreFlash[0] === "gain" ? "flash-gain" : ""}`}>
                  <span className="score-name">{playerNames[0]}</span>
                  <strong className="score-value">{scores[0]}</strong>
                  <em className="score-meta">Seri {seriesWins[0]}</em>
                </div>
                <div className="score-vs">vs</div>
                <div className={`score-side ${playerIndex === 1 ? "me" : ""} ${winner === 1 ? "winner" : ""} ${scoreFlash[1] === "gain" ? "flash-gain" : ""}`}>
                  <span className="score-name">{playerNames[1]}</span>
                  <strong className="score-value">{scores[1]}</strong>
                  <em className="score-meta">Seri {seriesWins[1]}</em>
                </div>
              </div>

              {gameStarted && screen === "game" && winner === null && (scores[0] === targetScore - 1 || scores[1] === targetScore - 1) && (
                <div className={`match-point-banner ${scores[playerIndex] === targetScore - 1 ? "me" : "opp"}`}>
                  <span className="match-point-flag">⚡</span>
                  <strong>
                    {scores[playerIndex] === targetScore - 1 && scores[1 - playerIndex] === targetScore - 1
                      ? "MAÇ TOPU — Çok kritik!"
                      : scores[playerIndex] === targetScore - 1
                      ? "Maç topu sende! Kazanabilirsin"
                      : "Dikkat! Rakip kazanmak üzere"}
                  </strong>
                </div>
              )}

              {screen === "winner" && winner !== null ? (
                <div className={`panel winner-panel ${winner === playerIndex ? "you-won" : "you-lost"}`}>
                  {winner === playerIndex ? (
                    <>
                      <div className="trophy trophy-big" aria-hidden="true">🏆</div>
                      <h2>Kazandın!</h2>
                      <p className="winner-subtitle">Tebrikler, harika oyundu</p>
                    </>
                  ) : (
                    <>
                      <div className="trophy trophy-loser" aria-hidden="true">💪</div>
                      <h2>Bu sefer olmadı</h2>
                      <p className="winner-subtitle">{playerNames[winner]} kazandı. Rövanşta daha iyi olabilirsin!</p>
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
                      🔁 Rövanş
                    </button>
                    <button type="button" onClick={resetGame} className="light-button big">
                      🔄 Sıfırla
                    </button>
                  </div>
                </div>
              ) : !opponentJoined ? (
                <div className="panel waiting-panel">
                  <div className="waiting-icon" aria-hidden="true">⏳</div>
                  <h2>Rakip bekleniyor</h2>
                  <p>Linki paylaş, rakip katılınca takımlar görünecek.</p>
                  <div className="room-code-display">
                    <span>Oda kodu</span>
                    <strong>{roomCode}</strong>
                  </div>
                  <button type="button" onClick={copyInvite} className="primary-button big">
                    📋 Davet Linkini Kopyala
                  </button>
                  <StatusMessage message={message} />
                </div>
              ) : !gameStarted ? (
                <div className="panel waiting-panel">
                  <div className="waiting-icon" aria-hidden="true">⚽</div>
                  <h2>Başlamaya hazır mısın?</h2>
                  <p>{readyStatusText()}</p>

                  <div className="ready-grid">
                    <div className={playersReady[0] ? "ready-card active" : "ready-card"}>
                      <span className="ready-dot" aria-hidden="true"></span>
                      <strong>{playerNames[0]}</strong>
                      <em>{playersReady[0] ? "Hazır" : "Bekliyor"}</em>
                    </div>
                    <div className={playersReady[1] ? "ready-card active" : "ready-card"}>
                      <span className="ready-dot" aria-hidden="true"></span>
                      <strong>{playerNames[1]}</strong>
                      <em>{playersReady[1] ? "Hazır" : "Bekliyor"}</em>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={pressStartGame}
                    disabled={playersReady[playerIndex]}
                    className="primary-button big full-width"
                  >
                    {playersReady[playerIndex] ? "✓ Hazırsın" : "Oyunu Başlat"}
                  </button>

                  <StatusMessage message={message} />
                </div>
              ) : isPreRound ? (
                <div className="panel waiting-panel">
                  <div className="countdown-circle">{preRoundLeft}</div>
                  <h2>Takımlar açılıyor</h2>
                  <p>Hazır ol!</p>
                </div>
              ) : (
                <div className="play-panel">
                  <div className="play-header">
                    <CircularTimer value={timeLeft} max={ROUND_SECONDS} urgent={timeLeft <= 3 && !roundLocked} />
                    <div className="play-tools">
                      <div className="round-pill">Tur #{usedRoundKeys.length || 1}</div>
                      <div className={`wrong-pill ${myWrongAttemptUsed ? "used" : ""}`}>
                        Yanlış hakkı: <strong>{myWrongAttemptUsed ? 0 : 1}</strong>
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
                          ? `GOOOL! ${lastAction.answer}`
                          : lastAction.type === "correct"
                            ? `Gol yedin! ${lastAction.answer}`
                            : lastAction.type === "wrong" && lastAction.playerIndex === playerIndex
                              ? "Yanlış cevap!"
                              : lastAction.type === "wrong"
                                ? "Rakip yanlış yaptı, devam!"
                                : "Tur bitti"}
                      </strong>
                    </div>
                  )}

                  <div className="answer-card">
                    <div className="answer-row">
                      <div className="autocomplete-wrap">
                        <input
                          value={answerInput}
                          disabled={!canAnswer}
                          onFocus={() => {
                            if (canAnswer && answerInput) setFocusedInput(true);
                          }}
                          onBlur={() => setTimeout(() => setFocusedInput(false), 120)}
                          onChange={(event) => updateAnswerInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") checkAnswer();
                          }}
                          placeholder="Futbolcu adı yaz..."
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
                      <span>"<strong>{lastWrongReport.answer}</strong>" doğru olmalıydı?</span>
                      <span className="report-link-cta">Bildir →</span>
                    </button>
                  )}

                  <StatusMessage message={reportStatus} />

                  {showAnswers && (
                    <AcceptedPlayersBox
                      title="Kabul edilen oyuncular"
                      players={correctPlayers}
                      actualAnswer={lastAction?.answer}
                      onReportPlayer={(player) => reportAcceptedPlayer("online", round, player)}
                    />
                  )}

                  <div className="bottom-actions">
                    <button type="button" disabled={playerIndex !== 0} onClick={nextRound} className="primary-button big full-width">
                      ⏭️ Sonraki Tur
                    </button>
                  </div>

                  {playerIndex !== 0 && (
                    <p className="host-note">Sonraki turu oda sahibi başlatır.</p>
                  )}
                </div>
              )}
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

.app-frame {
  width: 100%;
  max-width: 920px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100dvh - 24px);
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
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
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
  gap: 8px;
}

.home-button {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.3);
}

.home-button:hover {
  background: rgba(16, 185, 129, 0.2);
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
  font-size: 88px;
  line-height: 1;
  animation: splashLogoBounce 1.5s ease-in-out infinite;
  filter: drop-shadow(0 8px 20px rgba(16, 185, 129, 0.5));
}

@keyframes splashLogoBounce {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50%      { transform: translateY(-12px) rotate(15deg); }
}

.splash-title {
  margin: 8px 0 4px;
  font-size: 48px;
  font-weight: 900;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--primary) 0%, #6ee7b7 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
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

.difficulty-header {
  text-align: center;
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
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, var(--surface) 100%);
  border-color: rgba(245, 158, 11, 0.3);
}

.streak-badge {
  background: linear-gradient(135deg, var(--accent-soft) 0%, rgba(245, 158, 11, 0.06) 100%);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: var(--accent);
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
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
  animation: dailyDotPulse 1.6s ease-in-out infinite;
}

@keyframes dailyDotPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 8px rgba(245, 158, 11, 0.5); }
  50%      { transform: scale(1.25); box-shadow: 0 0 14px rgba(245, 158, 11, 0.85); }
}

.daily-dot.correct {
  background: var(--primary);
  border-color: var(--primary);
}

.daily-dot.failed {
  background: var(--danger);
  border-color: var(--danger);
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
  font-size: 28px;
  letter-spacing: 4px;
  text-align: center;
  padding: 8px;
  background: var(--surface-soft);
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
  background: linear-gradient(135deg, var(--accent-soft) 0%, rgba(245, 158, 11, 0.04) 100%);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 10px;
}

.daily-countdown-value {
  font-size: 22px !important;
  color: var(--accent) !important;
  font-weight: 900 !important;
  letter-spacing: 0.02em;
}

/* Stats bar (anasayfa üst kısmı) */
.stats-bar {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin-bottom: 4px;
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: all 0.2s var(--ease);
}

.stat-pill:hover {
  border-color: var(--border-strong);
  background: var(--surface-strong);
}

.stat-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
}

.stat-text {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  overflow: hidden;
}

.stat-text strong {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-text small {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}

@media (max-width: 420px) {
  .stat-icon { font-size: 18px; }
  .stat-text strong { font-size: 14px; }
  .stat-pill { padding: 10px 12px; gap: 8px; }
}

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

.mode-card:hover::before {
  opacity: 1;
  width: 6px;
}

.mode-card-online::before { background: linear-gradient(180deg, #3b82f6 0%, #06b6d4 100%); }
.mode-card:nth-child(2)::before { background: linear-gradient(180deg, var(--accent) 0%, #ef4444 100%); }
.mode-card-daily::before { background: linear-gradient(180deg, #f59e0b 0%, #ef4444 100%); }

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
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--team-primary) 0%, var(--team-secondary) 200%);
  padding: 3px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
  flex-shrink: 0;
}

.team-logo.size-sm {
  --logo-size: 40px;
  border-radius: 12px;
}

.team-logo__inner {
  width: 100%;
  height: 100%;
  border-radius: 13px;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 4px;
}

.team-logo.size-sm .team-logo__inner {
  border-radius: 9px;
  padding: 3px;
}

.team-logo__inner img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.team-logo__inner span {
  color: var(--team-primary);
  font-weight: 900;
  font-size: 14px;
  letter-spacing: -0.02em;
  line-height: 1;
}

.team-logo.size-sm .team-logo__inner span {
  font-size: 11px;
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

.feedback-wrong {
  animation: shake 0.5s var(--ease);
}

@keyframes pulseGreen {
  0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
  50%  { box-shadow: 0 0 0 18px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-8px); }
  20%, 40%, 60%, 80%       { transform: translateX(8px); }
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
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
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
  max-height: 140px;
  overflow-y: auto;
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
`;
