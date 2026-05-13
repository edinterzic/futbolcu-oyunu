import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { PLAYERS } from "./data/players";
import { TEAMS } from "./data/teams";
import { TEAM_LOGOS } from "./data/teamLogos";

const WINNING_SCORE = 3;
const ROUND_SECONDS = 15;
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

function playerPlayedForClub(player, clubName) {
  return player.normalizedClubs.has(normalizeText(clubName));
}

function playerPlayedForBothTeams(player, teamA, teamB) {
  const normalizedA = normalizeText(teamA);
  const normalizedB = normalizeText(teamB);
  return player.normalizedClubs.has(normalizedA) && player.normalizedClubs.has(normalizedB);
}

function findPlayerByInput(userInput) {
  const normalizedInput = normalizeText(userInput);
  if (!normalizedInput) return null;
  return PLAYERS_BY_TOKEN.get(normalizedInput) || null;
}

function isCorrectAnswer(round, userInput) {
  const player = findPlayerByInput(userInput);
  if (!player) return false;
  return playerPlayedForBothTeams(player, round.teams[0], round.teams[1]);
}

function getWrongAnswerExplanation(round, userInput) {
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
  const normalizedA = normalizeText(round.teams[0]);
  const normalizedB = normalizeText(round.teams[1]);

  return NORMALIZED_PLAYERS.filter(
    (player) => player.normalizedClubs.has(normalizedA) && player.normalizedClubs.has(normalizedB)
  );
}

function getPlayerSuggestions(userInput) {
  const query = normalizeText(userInput);
  if (query.length < 1) return [];

  return SORTED_PLAYERS
    .filter((player) => player.suggestionTokens.some((token) => token.startsWith(query)))
    .slice(0, 8);
}

function getRoundKey(round) {
  return round.teams.map(normalizeText).sort().join("-");
}

function createPlayableTeamPairs() {
  const teamPairKeys = new Set();
  const pairs = [];

  NORMALIZED_PLAYERS.forEach((player) => {
    const playerTeams = TEAMS.filter((team) => player.normalizedClubs.has(normalizeText(team)));

    for (let i = 0; i < playerTeams.length; i += 1) {
      for (let j = i + 1; j < playerTeams.length; j += 1) {
        const round = { teams: [playerTeams[i], playerTeams[j]] };
        const key = getRoundKey(round);

        if (!teamPairKeys.has(key)) {
          teamPairKeys.add(key);
          pairs.push(round);
        }
      }
    }
  });

  return pairs.sort((a, b) => getRoundKey(a).localeCompare(getRoundKey(b), "tr-TR"));
}

const PLAYABLE_TEAM_PAIRS = createPlayableTeamPairs();

function getPlayableTeamPairs() {
  return PLAYABLE_TEAM_PAIRS;
}

function getRandomRound(usedRoundKeys = []) {
  const available = PLAYABLE_TEAM_PAIRS.filter((round) => !usedRoundKeys.includes(getRoundKey(round)));
  const pool = available.length > 0 ? available : PLAYABLE_TEAM_PAIRS;
  const selected = pool[Math.floor(Math.random() * pool.length)] || { teams: ["Beşiktaş", "Barcelona"] };
  return selected;
}

function runSelfTests() {
  const psgBarcelona = { teams: ["PSG", "Barcelona"] };

  console.assert(normalizeText("Mesut Özil") === normalizeText("mesut ozil"), "Turkish character normalization failed");
  console.assert(normalizeText("Hakan Şükür") === normalizeText("hakan sukur"), "Turkish s/ü normalization failed");
  console.assert(getPlayerSuggestions("xzy").length === 0, "Suggestions should be empty when there is no match");
  console.assert(getPlayableTeamPairs().length > 0, "There should be playable team pairs");
  console.assert(WINNING_SCORE === 3, "Winning score should be 3");

  const messiExists = getPlayerSuggestions("messi").some((player) => normalizeText(player.name).includes("messi"));
  if (messiExists) {
    console.assert(isCorrectAnswer(psgBarcelona, "Messi"), "Messi should validate PSG and Barcelona when present in dataset");
  }
}

runSelfTests();

function StatusMessage({ message }) {
  if (!message) return null;

  const iconByType = {
    success: "✅",
    error: "❌",
    info: "ℹ️"
  };

  return (
    <div className={`status-message ${message.type}`}>
      <span className="status-icon">{iconByType[message.type] || "ℹ️"}</span>
      <span>{message.text}</span>
    </div>
  );
}


function TeamLogo({ teamName }) {
  const data = TEAM_LOGOS[teamName] || {};
  const initials = data.initials || teamName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return (
    <div
      className="team-logo"
      style={{
        "--team-primary": data.primary || "#10b981",
        "--team-secondary": data.secondary || "#ffffff"
      }}
      aria-label={`${teamName} logosu`}
    >
      {data.logo ? (
        <img src={data.logo} alt={`${teamName} logo`} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

export default function App() {
  const clientIdRef = useRef(makeClientId());
  const channelRef = useRef(null);
  const stateRef = useRef(null);

  const [screen, setScreen] = useState("home");
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
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [preRoundLeft, setPreRoundLeft] = useState(ROUND_REVEAL_SECONDS);
  const [wrongAttempts, setWrongAttempts] = useState([0, 0]);
  const [lastAction, setLastAction] = useState(null);

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

  const suggestions = useMemo(() => getPlayerSuggestions(answerInput), [answerInput]);
  const correctPlayers = useMemo(() => getCorrectPlayersForRound(round), [round]);
  const challengeSuggestions = useMemo(() => getPlayerSuggestions(challengeInput), [challengeInput]);
  const challengeCorrectPlayers = useMemo(() => getCorrectPlayersForRound(challengeRound), [challengeRound]);
  const challengeIsPreRound = Boolean(challengePreRoundEndsAt && !challengeRoundEndsAt && !challengeRoundLocked);
  const challengeCanAnswer = screen === "challenge" && !challengeIsPreRound && !challengeRoundLocked;

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
      lastAction
    };
  }, [
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
    lastAction
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
    ...overrides
  });

  const broadcastGameState = async (overrides = {}) => {
    await sendRoomEvent({
      type: "STATE_SYNC",
      gameState: buildGameState(overrides)
    });
  };

  useEffect(() => {
    if (!roomCode || !supabase) return;

    setConnectionStatus("connecting");

    const channel = supabase.channel(`football-room-${roomCode}`, {
      config: {
        broadcast: { self: false }
      }
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
          message: { type: "info", text: `${joinedName} odaya katıldı. Oyunu başlatmak için iki oyuncu da hazır olmalı.` }
        };

        applyGameState(nextState);
        await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
      }

      if (payload.type === "REQUEST_STATE") {
        if (playerIndex === 0 && stateRef.current) {
          await sendRoomEvent({
            type: "STATE_SYNC",
            gameState: stateRef.current
          });
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
        // ignore cleanup errors
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
    const firstRound = getRandomRound([]);
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
    setMessage({ type: "info", text: `Oda oluşturuldu: ${code}. Rakip bağlanana kadar takımlar gizli kalacak.` });
    setScreen("game");
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
    setMessage({ type: "info", text: `${code} odasına bağlanılıyor...` });
    setScreen("game");
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
    if (playersReady[playerIndex]) return "Sen oyunu başlattın. Rakip bekleniyor.";
    const opponentIndex = playerIndex === 0 ? 1 : 0;
    if (playersReady[opponentIndex]) return "Rakip oyunu başlattı. Oyuna başlamak için sen de butona bas.";
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
      : { type: "info", text: `${playerNames[playerIndex]} oyunu başlattı. Diğer oyuncu bekleniyor.` };

    const nextState = {
      screen: "game",
      playerNames,
      playersReady: nextReady,
      opponentJoined: true,
      gameStarted: bothReady,
      targetScore,
      scores,
      round,
      usedRoundKeys,
      message: nextMessage,
      winner: null,
      showAnswers: false,
      roundLocked: false,
      roundEndsAt: null,
      preRoundEndsAt: nextPreRoundEndsAt,
      wrongAttempts: [0, 0],
      lastAction: null
    };

    setPlayersReady(nextReady);
    setGameStarted(bothReady);
    setRoundEndsAt(null);
    setPreRoundEndsAt(nextPreRoundEndsAt);
    setTimeLeft(ROUND_SECONDS);
    setPreRoundLeft(ROUND_REVEAL_SECONDS);
    setWrongAttempts([0, 0]);
    setLastAction(null);
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
      playerNames,
      playersReady,
      opponentJoined,
      gameStarted: true,
      targetScore,
      scores,
      round: next,
      usedRoundKeys: nextUsed,
      message: null,
      winner: null,
      showAnswers: false,
      roundLocked: false,
      roundEndsAt: null,
      preRoundEndsAt: nextPreRoundEndsAt,
      wrongAttempts: [0, 0],
      lastAction: null
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
    setWinner(null);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const resetGame = async () => {
    const firstRound = getRandomRound([]);
    const nextState = {
      screen: "game",
      playerNames,
      playersReady: [false, false],
      opponentJoined,
      gameStarted: false,
      targetScore,
      scores: [0, 0],
      round: firstRound,
      usedRoundKeys: [getRoundKey(firstRound)],
      message: { type: "info", text: "Oyun yeniden başlatıldı. Başlamak için iki oyuncu da hazır olmalı." },
      winner: null,
      showAnswers: false,
      roundLocked: false,
      roundEndsAt: null,
      preRoundEndsAt: null,
      wrongAttempts: [0, 0],
      lastAction: null
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
      setMessage({ type: "info", text: "Bu tur bitti. Devam etmek için Sonraki Tur'a basın." });
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
      const nextMessage = {
        type: "success",
        text: `${playerNames[playerIndex]} doğru bildi: ${raw}. Tur bitti, 1 puan aldı!`
      };

      const nextState = {
        screen: hasWinner ? "winner" : "game",
        playerNames,
        playersReady,
        opponentJoined,
        gameStarted,
        targetScore,
        scores: newScores,
        round,
        usedRoundKeys,
        message: nextMessage,
        winner: hasWinner ? playerIndex : null,
        showAnswers: true,
        roundLocked: true,
        roundEndsAt: null,
        preRoundEndsAt: null,
        wrongAttempts,
        lastAction: { type: "correct", playerIndex }
      };

      setScores(newScores);
      setRoundLocked(true);
      setShowAnswers(true);
      setRoundEndsAt(null);
      setPreRoundEndsAt(null);
      setTimeLeft(0);
      setLastAction({ type: "correct", playerIndex });
      setMessage(nextMessage);
      setAnswerInput("");

      if (hasWinner) {
        setWinner(playerIndex);
        setScreen("winner");
      }

      await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
      return;
    }

    const newWrongAttempts = [...wrongAttempts];
    newWrongAttempts[playerIndex] += 1;

    const bothPlayersUsedWrong = newWrongAttempts[0] >= 1 && newWrongAttempts[1] >= 1;
    const nextMessage = {
      type: "error",
      text: bothPlayersUsedWrong
        ? `${getWrongAnswerExplanation(round, raw)} İki oyuncu da yanlış hakkını kullandı. Tur bitti.`
        : `${getWrongAnswerExplanation(round, raw)} Bu turdaki yanlış hakkını kullandın.`
    };

    const nextState = {
      screen: "game",
      playerNames,
      playersReady,
      opponentJoined,
      gameStarted,
      targetScore,
      scores,
      round,
      usedRoundKeys,
      message: nextMessage,
      winner: null,
      showAnswers: bothPlayersUsedWrong,
      roundLocked: bothPlayersUsedWrong,
      roundEndsAt: bothPlayersUsedWrong ? null : roundEndsAt,
      preRoundEndsAt: null,
      wrongAttempts: newWrongAttempts,
      lastAction: { type: "wrong", playerIndex }
    };

    setWrongAttempts(newWrongAttempts);
    setLastAction({ type: "wrong", playerIndex });
    setMessage(nextMessage);
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
      playerNames,
      playersReady,
      opponentJoined,
      gameStarted,
      targetScore,
      scores,
      round,
      usedRoundKeys,
      message: nextMessage,
      winner: null,
      showAnswers: true,
      roundLocked: true,
      roundEndsAt: null,
      preRoundEndsAt: null,
      wrongAttempts,
      lastAction: { type: "timeout" }
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
      playerNames,
      playersReady,
      opponentJoined,
      gameStarted,
      targetScore,
      scores,
      round,
      usedRoundKeys,
      message: null,
      winner: null,
      showAnswers: false,
      roundLocked: false,
      roundEndsAt: nextRoundEndsAt,
      preRoundEndsAt: null,
      wrongAttempts: [0, 0],
      lastAction: null
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
    if (!gameStarted || roundLocked || !preRoundEndsAt || screen !== "game") {
      return;
    }

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
      playerNames,
      playersReady,
      opponentJoined,
      gameStarted,
      targetScore,
      scores,
      round,
      usedRoundKeys,
      message: nextMessage,
      winner: null,
      showAnswers: true,
      roundLocked: true,
      roundEndsAt: null,
      preRoundEndsAt: null,
      wrongAttempts,
      lastAction: { type: "timeout" }
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
    if (!gameStarted || roundLocked || !roundEndsAt || screen !== "game") {
      return;
    }

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
    const firstRound = getRandomRound([]);
    setChallengeScore(0);
    setChallengeLastScore(null);
    setChallengeRound(firstRound);
    setChallengeUsedRoundKeys([getRoundKey(firstRound)]);
    setChallengeInput("");
    setChallengeFocused(false);
    setChallengeMessage({ type: "info", text: "Kişisel challenge başladı. 3 saniye sonra ilk takımlar görünecek." });
    setChallengeRoundLocked(false);
    setChallengeShowAnswers(false);
    setChallengeRoundEndsAt(null);
    setChallengePreRoundEndsAt(Date.now() + ROUND_REVEAL_SECONDS * 1000);
    setChallengeTimeLeft(ROUND_SECONDS);
    setChallengePreRoundLeft(ROUND_REVEAL_SECONDS);
    setChallengeLastAction(null);
    setScreen("challenge");
  };

  const backToHomeFromChallenge = () => {
    setChallengeRoundEndsAt(null);
    setChallengePreRoundEndsAt(null);
    setChallengeFocused(false);
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
    if (screen !== "challenge" || challengeRoundLocked || !challengePreRoundEndsAt) {
      return;
    }

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

  const endChallenge = (reasonText) => {
    const finalScore = challengeScore;
    const nextBest = Math.max(challengeBest, finalScore);

    setChallengeLastScore(finalScore);
    setChallengeBest(nextBest);
    window.localStorage.setItem("footballChallengeBest", String(nextBest));
    setChallengeScore(0);
    setChallengeRoundLocked(true);
    setChallengeShowAnswers(true);
    setChallengeRoundEndsAt(null);
    setChallengePreRoundEndsAt(null);
    setChallengeTimeLeft(0);
    setChallengeFocused(false);
    setChallengeLastAction({ type: "wrong" });
    setChallengeMessage({
      type: "error",
      text: `${reasonText} Seri bitti. Üst üste doğru sayın: ${finalScore}.`
    });
  };

  useEffect(() => {
    if (screen !== "challenge" || challengeRoundLocked || !challengeRoundEndsAt) {
      return;
    }

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
      const nextRound = getRandomRound(challengeUsedRoundKeys);
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
      setChallengeLastAction({ type: "correct" });
      setChallengeMessage({ type: "success", text: `Doğru! Seri: ${nextScore}. Yeni tur 3 saniye sonra açılacak.` });
      return;
    }

    endChallenge(getWrongAnswerExplanation(challengeRound, raw));
  };

  return (
    <div className="app-shell">
      <style>{css}</style>

      <main className="game-container">
        <header className="hero">
          <div className="badge">🌍 Online Futbolcu Kapışması</div>
          <h1>İki Takım, Tek Futbolcu</h1>
          <p>
            Oda oluştur, linki arkadaşına gönder, iki kişi hazır olunca aynı anda oyuna başlayın.
          </p>
        </header>

        {screen === "home" && (
          <section className="panel">
            <div className="mode-grid">
              <button type="button" className="mode-card active">
                <span>🌍</span>
                <strong>Online Kapışma</strong>
                <small>Oda kur, arkadaşınla karşılıklı oyna.</small>
              </button>

              <button type="button" onClick={startChallenge} className="mode-card">
                <span>🔥</span>
                <strong>Kişisel Challenge</strong>
                <small>Tek başına üst üste kaç doğru yapabildiğini gör.</small>
              </button>
            </div>

            <div className="input-card room-card">
              <label>👤 Oyuncu adın</label>
              <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Örn. İsmet" />
            </div>

            <div className="score-select-box">
              <label>Maç kaç puanda bitsin?</label>
              <div className="score-options">
                {[3, 5, 7].map((score) => (
                  <button
                    key={score}
                    type="button"
                    onClick={() => setTargetScore(score)}
                    className={targetScore === score ? "score-option active" : "score-option"}
                  >
                    {score} puan
                  </button>
                ))}
              </div>
              <small>Bu seçim odayı kuran oyuncu tarafından belirlenir.</small>
            </div>

            <div className="room-actions">
              <button type="button" onClick={createRoom} className="primary-button big">
                Oda Oluştur
              </button>

              <div className="join-box">
                <input
                  value={roomInput}
                  onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
                  placeholder="Oda kodu"
                />
                <button type="button" onClick={joinRoom} className="light-button big">
                  Odaya Katıl
                </button>
              </div>
            </div>

            {!supabase && (
              <div className="setup-warning">
                Supabase bağlantısı yok. Önce <strong>.env.local</strong> dosyasına URL ve anon key eklenmeli.
              </div>
            )}

            <StatusMessage message={message} />
          </section>
        )}


        {screen === "challenge" && (
          <section className="game-area">
            <div className="online-bar">
              <span>Mod: <strong>Kişisel Challenge</strong></span>
              <span>Seri: <strong>{challengeScore}</strong></span>
              <span>En iyi: <strong>{challengeBest}</strong></span>
              <button type="button" onClick={backToHomeFromChallenge} className="mini-button">Ana Menü</button>
            </div>

            {challengeIsPreRound ? (
              <section className="panel waiting-panel">
                <div className="waiting-icon">⏱️</div>
                <h2>Takımlar hazırlanıyor</h2>
                <p>Takımlar {challengePreRoundLeft} saniye sonra görünecek.</p>
                <div className="pre-round-count">{challengePreRoundLeft}</div>
              </section>
            ) : (
              <div className="panel">
                <div className="top-row">
                  <div className="round-pill">🔥 Seri: {challengeScore}</div>
                  <button type="button" onClick={startChallenge} className="light-button">
                    ↻ Challenge Sıfırla
                  </button>
                </div>

                <div className={challengeTimeLeft <= 3 && !challengeRoundLocked ? "timer-box urgent" : "timer-box"}>
                  <span>Kalan süre</span>
                  <strong>{challengeTimeLeft}</strong>
                  <em>saniye</em>
                </div>

                <div className="teams-grid">
                  <div className="team-card">
                    <span>Takım 1</span>
                    <TeamLogo teamName={challengeRound.teams[0]} />
                    <strong>{challengeRound.teams[0]}</strong>
                  </div>

                  <div className="versus">VS</div>

                  <div className="team-card">
                    <span>Takım 2</span>
                    <TeamLogo teamName={challengeRound.teams[1]} />
                    <strong>{challengeRound.teams[1]}</strong>
                  </div>
                </div>

                {challengeLastAction && (
                  <div className={challengeLastAction.type === "correct" ? "goal-animation" : "wrong-animation"}>
                    <div className="goal-scene">
                      <span className="ball">⚽</span>
                      <span className="goal-net">🥅</span>
                    </div>
                    <strong>{challengeLastAction.type === "correct" ? "GOOOL!" : "Challenge bitti!"}</strong>
                  </div>
                )}

                <div className="single-answer-card">
                  <label>Senin cevabın</label>
                  <div className="answer-row">
                    <div className="autocomplete-wrap">
                      <input
                        value={challengeInput}
                        disabled={!challengeCanAnswer}
                        onFocus={() => {
                          if (challengeCanAnswer && challengeInput) {
                            setChallengeFocused(true);
                          }
                        }}
                        onBlur={() => {
                          setTimeout(() => setChallengeFocused(false), 120);
                        }}
                        onChange={(event) => updateChallengeInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") submitChallengeAnswer();
                        }}
                        placeholder="Futbolcu adı yaz... Suarez, Messi, Quaresma"
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

                {challengeShowAnswers && (
                  <div className="answers-box">
                    <strong>Bu tur için kabul edilen oyuncular:</strong>
                    <div className="answer-tags">
                      {challengeCorrectPlayers.map((player) => (
                        <span key={player.name}>{player.name}</span>
                      ))}
                    </div>
                  </div>
                )}

                {challengeRoundLocked && (
                  <div className="challenge-result">
                    <strong>Son seri: {challengeLastScore ?? 0}</strong>
                    <span>En iyi seri: {challengeBest}</span>
                    <button type="button" onClick={startChallenge} className="primary-button big">
                      Yeni Challenge Başlat
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {(screen === "game" || screen === "winner") && (
          <section className="game-area">
            <div className="online-bar">
              <span>Oda: <strong>{roomCode}</strong></span>
              <span>Durum: <strong>{connectionStatus === "online" ? "Online" : "Bağlanıyor"}</strong></span>
              <span>Sen: <strong>{playerIndex === 0 ? "Oyuncu 1" : "Oyuncu 2"}</strong></span>
              <span>Hedef: <strong>{targetScore} puan</strong></span>
              <button type="button" onClick={copyInvite} className="mini-button">Linki Kopyala</button>
            </div>

            <div className="score-grid">
              {[0, 1].map((index) => (
                <div key={index} className={`score-card ${index === playerIndex ? "me" : ""}`}>
                  <span>{playerNames[index]}</span>
                  <strong>{scores[index]}</strong>
                  <em>{playersReady[index] ? "Hazır" : "Hazır değil"}</em>
                </div>
              ))}
            </div>

            {screen === "winner" && winner !== null ? (
              <section className="panel winner-panel">
                <div className="trophy">🏆</div>
                <h2>Kazanan: {playerNames[winner]}</h2>
                <p>
                  Final skor: {playerNames[0]} {scores[0]} - {scores[1]} {playerNames[1]}
                </p>

                <div className="winner-actions">
                  <button type="button" onClick={resetGame} className="primary-button big">
                    Yeni Maç
                  </button>
                </div>
              </section>
            ) : !opponentJoined ? (
              <section className="panel waiting-panel">
                <div className="waiting-icon">⏳</div>
                <h2>Rakip bekleniyor</h2>
                <p>Rakip odaya bağlanana kadar takımlar ve cevap alanı görünmez.</p>
                <p className="room-code-large">{roomCode}</p>
                <button type="button" onClick={copyInvite} className="primary-button big">
                  Davet Linkini Kopyala
                </button>
                <StatusMessage message={message} />
              </section>
            ) : !gameStarted ? (
              <section className="panel waiting-panel">
                <div className="waiting-icon">⚽</div>
                <h2>Oyunu başlatmaya hazır mısın?</h2>
                <p>{readyStatusText()}</p>

                <div className="ready-grid">
                  <div className={playersReady[0] ? "ready-card active" : "ready-card"}>
                    <strong>{playerNames[0]}</strong>
                    <span>{playersReady[0] ? "Oyunu başlattı" : "Bekliyor"}</span>
                  </div>
                  <div className={playersReady[1] ? "ready-card active" : "ready-card"}>
                    <strong>{playerNames[1]}</strong>
                    <span>{playersReady[1] ? "Oyunu başlattı" : "Bekliyor"}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={pressStartGame}
                  disabled={playersReady[playerIndex]}
                  className="primary-button big full-width"
                >
                  {playersReady[playerIndex] ? "Sen Hazırsın" : "Oyunu Başlat"}
                </button>

                <StatusMessage message={message} />
              </section>
            ) : isPreRound ? (
              <section className="panel waiting-panel">
                <div className="waiting-icon">⏱️</div>
                <h2>Takımlar hazırlanıyor</h2>
                <p>Takımlar {preRoundLeft} saniye sonra görünecek.</p>
                <div className="pre-round-count">{preRoundLeft}</div>
              </section>
            ) : (
              <div className="panel">
                <div className="top-row">
                  <div className="round-pill">⏱️ {roundLocked ? "Tur bitti" : `Tur #${usedRoundKeys.length || 1}`}</div>
                  <button type="button" onClick={resetGame} className="light-button">
                    ↩️ Baştan Başlat
                  </button>
                </div>

                <div className={timeLeft <= 3 && !roundLocked ? "timer-box urgent" : "timer-box"}>
                  <span>Kalan süre</span>
                  <strong>{timeLeft}</strong>
                  <em>saniye</em>
                </div>

                <div className="teams-grid">
                  <div className="team-card">
                    <span>Takım 1</span>
                    <TeamLogo teamName={round.teams[0]} />
                    <strong>{round.teams[0]}</strong>
                  </div>

                  <div className="versus">VS</div>

                  <div className="team-card">
                    <span>Takım 2</span>
                    <TeamLogo teamName={round.teams[1]} />
                    <strong>{round.teams[1]}</strong>
                  </div>
                </div>

                {lastAction && (
                  <div className={
                    lastAction.type === "correct" && lastAction.playerIndex === playerIndex
                      ? "goal-animation"
                      : lastAction.type === "correct"
                        ? "concede-animation"
                        : lastAction.type === "wrong" && lastAction.playerIndex === playerIndex
                          ? "wrong-animation"
                          : "round-animation"
                  }>
                    <div className="goal-scene">
                      <span className="ball">⚽</span>
                      <span className="goal-net">🥅</span>
                    </div>
                    <strong>
                      {lastAction.type === "correct" && lastAction.playerIndex === playerIndex
                        ? "GOOOL!"
                        : lastAction.type === "correct"
                          ? "Gol yedin!"
                          : lastAction.type === "wrong" && lastAction.playerIndex === playerIndex
                            ? "Yanlış cevap!"
                            : "Tur bitti"}
                    </strong>
                  </div>
                )}

                <div className="single-answer-card">
                  <label>Senin cevabın</label>
                  <div className="wrong-right-info">
                    Yanlış hakkı: <strong>{myWrongAttemptUsed ? 0 : 1}</strong>
                  </div>
                  <div className="answer-row">
                    <div className="autocomplete-wrap">
                      <input
                        value={answerInput}
                        disabled={!canAnswer}
                        onFocus={() => {
                          if (canAnswer && answerInput) {
                            setFocusedInput(true);
                          }
                        }}
                        onBlur={() => {
                          setTimeout(() => setFocusedInput(false), 120);
                        }}
                        onChange={(event) => updateAnswerInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") checkAnswer();
                        }}
                        placeholder="Futbolcu adı yaz... Suarez, Messi, Quaresma"
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

                <StatusMessage message={message} />

                {showAnswers && (
                  <div className="answers-box">
                    <strong>Bu tur için kabul edilen oyuncular:</strong>
                    <div className="answer-tags">
                      {correctPlayers.map((player) => (
                        <span key={player.name}>{player.name}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bottom-actions">
                  <button type="button" disabled={roundLocked || playerIndex !== 0} onClick={skipRound} className="light-button big">
                    Cevapları Göster
                  </button>
                  <button type="button" disabled={playerIndex !== 0} onClick={nextRound} className="light-button big strong">
                    Sonraki Tur
                  </button>
                </div>

                {playerIndex !== 0 && (
                  <p className="host-note">Not: Sonraki turu oda sahibi başlatır.</p>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

const css = `
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #020617;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.app-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at 20% 10%, rgba(16, 185, 129, 0.25), transparent 30%),
    radial-gradient(circle at 90% 20%, rgba(59, 130, 246, 0.2), transparent 30%),
    linear-gradient(135deg, #020617 0%, #064e3b 45%, #0f172a 100%);
  color: white;
  padding: 28px 16px;
}

.game-container {
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
}

.hero {
  text-align: center;
  margin-bottom: 26px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.11);
  color: #d1fae5;
  padding: 9px 16px;
  font-size: 14px;
  margin-bottom: 14px;
}

.hero h1 {
  margin: 0;
  font-size: clamp(34px, 6vw, 58px);
  line-height: 1;
  letter-spacing: -0.045em;
  font-weight: 900;
}

.hero p {
  max-width: 760px;
  margin: 14px auto 0;
  color: rgba(209, 250, 229, 0.84);
  line-height: 1.6;
}

.panel {
  background: rgba(255, 255, 255, 0.11);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 28px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  padding: 28px;
  backdrop-filter: blur(10px);
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.input-card,
.single-answer-card {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.22);
  border-radius: 20px;
  padding: 16px;
}

.input-card label,
.single-answer-card label,
.score-select-box label {
  display: block;
  font-size: 14px;
  color: #d1fae5;
  margin-bottom: 8px;
  font-weight: 700;
}

.input-card input,
.join-box input,
.single-answer-card input {
  width: 100%;
  border: none;
  border-radius: 14px;
  padding: 14px 15px;
  outline: none;
  color: #0f172a;
  background: white;
}

.input-card input:focus,
.join-box input:focus,
.single-answer-card input:focus {
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.35);
}

.primary-button,
.light-button,
.mini-button,
.score-option {
  border: none;
  border-radius: 16px;
  font-weight: 900;
  padding: 14px 18px;
  transition: transform 0.12s ease, background 0.12s ease;
}

.primary-button {
  background: #10b981;
  color: #022c22;
}

.primary-button:hover:not(:disabled) {
  background: #34d399;
  transform: translateY(-1px);
}

.light-button,
.mini-button {
  background: rgba(255, 255, 255, 0.94);
  color: #0f172a;
}

.light-button:hover:not(:disabled),
.mini-button:hover:not(:disabled) {
  background: #ecfdf5;
  transform: translateY(-1px);
}

.big {
  padding: 17px 18px;
}

.full-width {
  width: 100%;
}

.strong {
  font-weight: 950;
}


.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 18px;
}

.mode-card {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.22);
  color: white;
  border-radius: 22px;
  padding: 18px;
  text-align: left;
}

.mode-card.active {
  outline: 3px solid rgba(16, 185, 129, 0.45);
}

.mode-card span {
  display: block;
  font-size: 30px;
  margin-bottom: 8px;
}

.mode-card strong {
  display: block;
  font-size: 19px;
  margin-bottom: 5px;
}

.mode-card small {
  display: block;
  color: rgba(209, 250, 229, 0.82);
  line-height: 1.4;
}

.mode-card:hover {
  background: rgba(16, 185, 129, 0.14);
}

.challenge-result {
  margin-top: 18px;
  display: grid;
  gap: 10px;
  border: 1px solid rgba(110, 231, 183, 0.22);
  background: rgba(52, 211, 153, 0.10);
  border-radius: 20px;
  padding: 16px;
  text-align: center;
}

.challenge-result strong {
  font-size: 22px;
}

.challenge-result span {
  color: rgba(209, 250, 229, 0.88);
}


.room-card {
  margin-bottom: 18px;
}

.score-select-box {
  margin: 0 0 18px;
  border: 1px solid rgba(110, 231, 183, 0.22);
  background: rgba(52, 211, 153, 0.10);
  border-radius: 20px;
  padding: 16px;
}

.score-options {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.score-option {
  background: rgba(255, 255, 255, 0.88);
  color: #0f172a;
}

.score-option.active {
  background: #10b981;
  color: #022c22;
  outline: 3px solid rgba(167, 243, 208, 0.6);
}

.score-select-box small {
  display: block;
  margin-top: 10px;
  color: rgba(209, 250, 229, 0.82);
}

.room-actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 14px;
}

.join-box {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
}

.setup-warning {
  margin-top: 16px;
  border-radius: 16px;
  background: rgba(248, 113, 113, 0.16);
  border: 1px solid rgba(252, 165, 165, 0.34);
  padding: 14px;
}

.online-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 18px;
  padding: 12px;
}

.online-bar span {
  color: #d1fae5;
  background: rgba(255, 255, 255, 0.08);
  padding: 8px 10px;
  border-radius: 999px;
}

.mini-button {
  padding: 8px 12px;
  margin-left: auto;
}

.game-area {
  display: grid;
  gap: 18px;
}

.score-card {
  background: rgba(255, 255, 255, 0.11);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 24px;
  text-align: center;
  padding: 20px;
}

.score-card.me {
  outline: 3px solid rgba(16, 185, 129, 0.7);
}

.score-card span {
  display: block;
  color: rgba(209, 250, 229, 0.82);
  font-size: 14px;
}

.score-card strong {
  display: block;
  font-size: 52px;
  line-height: 1;
  margin-top: 6px;
}

.score-card em {
  display: inline-block;
  margin-top: 8px;
  color: rgba(236, 253, 245, 0.78);
  font-size: 13px;
  font-style: normal;
}

.top-row,
.bottom-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.round-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.25);
  color: #d1fae5;
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 800;
}

.timer-box {
  margin-top: 18px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
  padding: 16px;
  text-align: center;
}

.timer-box span,
.timer-box em {
  display: block;
  color: rgba(209, 250, 229, 0.82);
  font-style: normal;
  font-size: 14px;
}

.timer-box strong {
  display: block;
  font-size: 54px;
  line-height: 1;
  margin: 5px 0;
  font-weight: 950;
}

.timer-box.urgent {
  background: rgba(248, 113, 113, 0.18);
  border-color: rgba(252, 165, 165, 0.45);
}

.timer-box.urgent strong {
  color: #fecaca;
}

.teams-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  margin: 24px 0;
}

.team-card {
  background: white;
  color: #0f172a;
  border-radius: 24px;
  text-align: center;
  padding: 26px 18px;
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.22);
}

.team-card span {
  display: block;
  color: #64748b;
  font-size: 14px;
  margin-bottom: 6px;
}

.team-logo {
  width: 82px;
  height: 82px;
  margin: 8px auto 12px;
  border-radius: 24px;
  background:
    linear-gradient(135deg, var(--team-primary), var(--team-secondary));
  border: 4px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.team-logo img {
  width: 76%;
  height: 76%;
  object-fit: contain;
  display: block;
}

.team-logo span {
  color: #0f172a;
  font-size: 23px;
  line-height: 1;
  font-weight: 950;
  letter-spacing: -0.04em;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.38);
  margin: 0;
}

.team-card strong {
  display: block;
  font-size: clamp(26px, 4vw, 40px);
  line-height: 1.05;
  font-weight: 950;
}

.versus {
  font-size: 28px;
  color: #a7f3d0;
  font-weight: 950;
}

.answer-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.autocomplete-wrap {
  position: relative;
  width: 100%;
}

.suggestions {
  position: absolute;
  z-index: 30;
  width: 100%;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(16, 185, 129, 0.26);
  background: white;
  color: #0f172a;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
  max-height: 220px;
  overflow-y: auto;
}

.suggestions button {
  display: block;
  width: 100%;
  border: none;
  background: white;
  text-align: left;
  padding: 13px 15px;
  color: #0f172a;
  font-weight: 800;
}

.suggestions button:hover {
  background: #d1fae5;
}

.status-message {
  margin-top: 18px;
  border-radius: 18px;
  padding: 15px;
  border: 1px solid;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.status-message.success {
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(110, 231, 183, 0.32);
  color: #ecfdf5;
}

.status-message.error {
  background: rgba(248, 113, 113, 0.14);
  border-color: rgba(252, 165, 165, 0.32);
  color: #fef2f2;
}

.status-message.info {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(125, 211, 252, 0.32);
  color: #f0f9ff;
}

.status-icon {
  font-size: 20px;
  line-height: 1;
}

.answers-box {
  margin-top: 18px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.10);
  border-radius: 18px;
  padding: 16px;
}

.answer-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.answer-tags span {
  background: white;
  color: #0f172a;
  border-radius: 999px;
  padding: 7px 11px;
  font-size: 14px;
  font-weight: 800;
}

.bottom-actions {
  margin-top: 18px;
}

.bottom-actions button {
  flex: 1;
}

.host-note {
  margin: 14px 0 0;
  color: rgba(209, 250, 229, 0.8);
  text-align: center;
}

.winner-panel,
.waiting-panel {
  text-align: center;
}

.waiting-icon,
.trophy {
  width: 96px;
  height: 96px;
  margin: 0 auto 18px;
  border-radius: 999px;
  background: #fde047;
  color: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
}

.waiting-panel h2,
.winner-panel h2 {
  margin: 0 0 10px;
  font-size: clamp(30px, 5vw, 52px);
  line-height: 1;
}

.waiting-panel p,
.winner-panel p {
  color: rgba(209, 250, 229, 0.9);
  margin-bottom: 20px;
}

.room-code-large {
  display: inline-block;
  background: white;
  color: #0f172a !important;
  border-radius: 16px;
  padding: 12px 18px;
  font-size: 26px;
  font-weight: 950;
  letter-spacing: 0.08em;
}

.ready-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 22px 0;
}

.ready-card {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.22);
  border-radius: 18px;
  padding: 16px;
}

.ready-card.active {
  background: rgba(16, 185, 129, 0.18);
  border-color: rgba(110, 231, 183, 0.45);
}

.ready-card strong {
  display: block;
  margin-bottom: 6px;
}

.ready-card span {
  color: rgba(209, 250, 229, 0.84);
}

.winner-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}


.pre-round-count {
  width: 120px;
  height: 120px;
  margin: 18px auto 0;
  border-radius: 999px;
  background: white;
  color: #022c22;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 64px;
  font-weight: 950;
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.22);
}

.wrong-right-info {
  display: inline-block;
  margin-bottom: 10px;
  color: rgba(209, 250, 229, 0.88);
  background: rgba(255, 255, 255, 0.09);
  border-radius: 999px;
  padding: 7px 11px;
  font-size: 14px;
}

.goal-animation,
.concede-animation,
.wrong-animation,
.round-animation {
  margin: 0 0 18px;
  border-radius: 24px;
  padding: 16px;
  text-align: center;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.goal-animation {
  background: rgba(16, 185, 129, 0.17);
}

.concede-animation,
.wrong-animation {
  background: rgba(248, 113, 113, 0.17);
}

.round-animation {
  background: rgba(56, 189, 248, 0.14);
}

.goal-animation strong,
.concede-animation strong,
.wrong-animation strong,
.round-animation strong {
  display: block;
  margin-top: 8px;
  font-size: 22px;
}

.goal-scene {
  position: relative;
  height: 74px;
  max-width: 420px;
  margin: 0 auto;
}

.ball {
  position: absolute;
  left: 8px;
  top: 18px;
  font-size: 34px;
  animation: shootBall 1.15s ease-in-out both;
}

.goal-net {
  position: absolute;
  right: 12px;
  top: 10px;
  font-size: 48px;
}

.concede-animation .ball,
.wrong-animation .ball {
  animation: concedeBall 1.1s ease-in-out both;
}

@keyframes shootBall {
  0% {
    transform: translateX(0) translateY(0) rotate(0deg) scale(1);
    opacity: 1;
  }
  70% {
    transform: translateX(290px) translateY(-8px) rotate(520deg) scale(1.15);
    opacity: 1;
  }
  100% {
    transform: translateX(330px) translateY(2px) rotate(720deg) scale(0.9);
    opacity: 0.95;
  }
}

@keyframes concedeBall {
  0% {
    transform: translateX(330px) translateY(0) rotate(0deg) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateX(40px) translateY(8px) rotate(-720deg) scale(1.15);
    opacity: 0.95;
  }
}


@media (max-width: 760px) {
  .app-shell {
    padding: 18px 12px;
  }

  .panel {
    padding: 18px;
    border-radius: 22px;
  }

  .score-grid,
  .room-actions,
  .winner-actions,
  .ready-grid,
  .mode-grid {
    grid-template-columns: 1fr;
  }

  .join-box {
    grid-template-columns: 1fr;
  }

  .teams-grid {
    grid-template-columns: 1fr;
  }

  .versus {
    text-align: center;
  }

  .answer-row {
    flex-direction: column;
  }

  .answer-row .primary-button {
    width: 100%;
  }

  .top-row,
  .bottom-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .mini-button {
    margin-left: 0;
    width: 100%;
  }

  .team-logo {
    width: 70px;
    height: 70px;
    border-radius: 20px;
  }

  .team-logo span {
    font-size: 20px;
  }

  .goal-scene {
    max-width: 260px;
  }

  @keyframes shootBall {
    0% {
      transform: translateX(0) translateY(0) rotate(0deg) scale(1);
      opacity: 1;
    }
    100% {
      transform: translateX(190px) translateY(2px) rotate(650deg) scale(0.95);
      opacity: 0.95;
    }
  }

  @keyframes concedeBall {
    0% {
      transform: translateX(190px) translateY(0) rotate(0deg) scale(1);
      opacity: 1;
    }
    100% {
      transform: translateX(28px) translateY(8px) rotate(-650deg) scale(1.1);
      opacity: 0.95;
    }
  }
}
`;
