import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { PLAYERS } from "./data/players";
import { TEAMS } from "./data/teams";

const WINNING_SCORE = 3;

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

function sameClub(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function playerPlayedForClub(player, clubName) {
  return player.clubs.some((club) => sameClub(club, clubName));
}

function playerPlayedForBothTeams(player, teamA, teamB) {
  return playerPlayedForClub(player, teamA) && playerPlayedForClub(player, teamB);
}

function getPlayerSearchTokens(player) {
  return [player.name, ...(player.aliases || [])].map(normalizeText);
}

function findPlayerByInput(userInput) {
  const normalizedInput = normalizeText(userInput);
  if (!normalizedInput) return null;
  return PLAYERS.find((player) => getPlayerSearchTokens(player).includes(normalizedInput)) || null;
}

function isCorrectAnswer(round, userInput) {
  const player = findPlayerByInput(userInput);
  if (!player) return false;
  return playerPlayedForBothTeams(player, round.teams[0], round.teams[1]);
}

function getCorrectPlayersForRound(round) {
  return PLAYERS.filter((player) => playerPlayedForBothTeams(player, round.teams[0], round.teams[1]));
}

function getAllPlayers() {
  return [...PLAYERS].sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));
}

function getSuggestionSearchTokens(player) {
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

function getPlayerSuggestions(userInput) {
  const query = normalizeText(userInput);
  if (query.length < 1) return [];

  return getAllPlayers()
    .filter((player) => getSuggestionSearchTokens(player).some((token) => token.startsWith(query)))
    .slice(0, 8);
}

function getRoundKey(round) {
  return round.teams.map(normalizeText).sort().join("-");
}

function getPlayableTeamPairs() {
  const pairs = [];

  for (let i = 0; i < TEAMS.length; i += 1) {
    for (let j = i + 1; j < TEAMS.length; j += 1) {
      const round = { teams: [TEAMS[i], TEAMS[j]] };
      if (getCorrectPlayersForRound(round).length > 0) {
        pairs.push(round);
      }
    }
  }

  return pairs;
}

function getRandomRound(usedRoundKeys = []) {
  const playablePairs = getPlayableTeamPairs();
  const available = playablePairs.filter((round) => !usedRoundKeys.includes(getRoundKey(round)));
  const pool = available.length > 0 ? available : playablePairs;
  const selected = pool[Math.floor(Math.random() * pool.length)] || { teams: ["Beşiktaş", "Barcelona"] };
  return selected;
}

function runSelfTests() {
  const besiktasBarcelona = { teams: ["Beşiktaş", "Barcelona"] };
  const fenerReal = { teams: ["Fenerbahçe", "Real Madrid"] };
  const galatasarayInter = { teams: ["Galatasaray", "Inter"] };
  const dortmundBayern = { teams: ["Borussia Dortmund", "Bayern Münih"] };
  const psgBarcelona = { teams: ["PSG", "Barcelona"] };

  console.assert(normalizeText("Mesut Özil") === normalizeText("mesut ozil"), "Turkish character normalization failed");
  console.assert(normalizeText("Hakan Şükür") === normalizeText("hakan sukur"), "Turkish s/ü normalization failed");
  console.assert(isCorrectAnswer(besiktasBarcelona, "Quaresma"), "Alias answer should be accepted");
  console.assert(isCorrectAnswer(fenerReal, "Roberto Carlos"), "Full name answer should be accepted");
  console.assert(isCorrectAnswer(galatasarayInter, "sneijder"), "Lowercase alias should be accepted");
  console.assert(isCorrectAnswer(dortmundBayern, "Gotze"), "Accent-free alias should be accepted");
  console.assert(isCorrectAnswer(psgBarcelona, "Messi"), "Player-based club history should validate PSG and Barcelona");
  console.assert(getPlayerSuggestions("mes").some((player) => player.name === "Mesut Özil"), "Suggestions should match first name");
  console.assert(getPlayerSuggestions("suarez").some((player) => player.name === "Luis Suarez"), "Suggestions should match surname");
  console.assert(getPlayerSuggestions("qua").some((player) => player.name === "Ricardo Quaresma"), "Suggestions should match surname for Quaresma");
  console.assert(getPlayerSuggestions("messi").some((player) => player.name === "Lionel Messi"), "Suggestions should match surname for Messi");
  console.assert(getPlayerSuggestions("obi").some((player) => player.name === "John Obi Mikel"), "Suggestions should match middle-name tokens");
  console.assert(getPlayerSuggestions("xzy").length === 0, "Suggestions should be empty when there is no match");
  console.assert(getPlayableTeamPairs().length > 0, "There should be playable team pairs");
  console.assert(WINNING_SCORE === 3, "Winning score should be 3");
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

  const suggestions = useMemo(() => getPlayerSuggestions(answerInput), [answerInput]);
  const correctPlayers = useMemo(() => getCorrectPlayersForRound(round), [round]);

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
      roundLocked
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
    roundLocked
  ]);

  const applyGameState = (gameState) => {
    if (!gameState) return;

    setScreen(gameState.screen || "game");
    setPlayerNames(gameState.playerNames || ["Oyuncu 1", "Oyuncu 2"]);
    setPlayersReady(gameState.playersReady || [false, false]);
    setOpponentJoined(Boolean(gameState.opponentJoined));
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
    const nextMessage = bothReady
      ? { type: "success", text: "İki oyuncu da hazır. Oyun başladı!" }
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
      roundLocked: false
    };

    setPlayersReady(nextReady);
    setGameStarted(bothReady);
    setMessage(nextMessage);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const nextRound = async () => {
    if (playerIndex !== 0) {
      setMessage({ type: "info", text: "Sonraki turu oda sahibi başlatabilir." });
      return;
    }

    const next = getRandomRound(usedRoundKeys);
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
      roundLocked: false
    };

    setRound(next);
    setUsedRoundKeys(nextUsed);
    setAnswerInput("");
    setFocusedInput(false);
    setMessage(null);
    setShowAnswers(false);
    setRoundLocked(false);
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
      roundLocked: false
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
    setScreen("game");

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
  };

  const updateAnswerInput = (value) => {
    if (roundLocked || !gameStarted) return;
    setAnswerInput(value);
    setFocusedInput(true);
  };

  const selectSuggestion = (playerNameValue) => {
    if (roundLocked || !gameStarted) return;
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
        roundLocked: true
      };

      setScores(newScores);
      setRoundLocked(true);
      setShowAnswers(true);
      setMessage(nextMessage);
      setAnswerInput("");

      if (hasWinner) {
        setWinner(playerIndex);
        setScreen("winner");
      }

      await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
      return;
    }

    const player = findPlayerByInput(raw);
    const errorText = player
      ? `${player.name} var ama bu iki takımda da oynamamış görünüyor.`
      : `${raw} oyuncu havuzunda bulunamadı veya bu eşleşme için doğru değil.`;

    setMessage({ type: "error", text: errorText });
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
      roundLocked: true
    };

    setMessage(nextMessage);
    setShowAnswers(true);
    setRoundLocked(true);
    setFocusedInput(false);

    await sendRoomEvent({ type: "STATE_SYNC", gameState: nextState });
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
            ) : (
              <div className="panel">
                <div className="top-row">
                  <div className="round-pill">⏱️ {roundLocked ? "Tur bitti" : `Tur #${usedRoundKeys.length || 1}`}</div>
                  <button type="button" onClick={resetGame} className="light-button">
                    ↩️ Baştan Başlat
                  </button>
                </div>

                <div className="teams-grid">
                  <div className="team-card">
                    <span>Takım 1</span>
                    <strong>{round.teams[0]}</strong>
                  </div>

                  <div className="versus">VS</div>

                  <div className="team-card">
                    <span>Takım 2</span>
                    <strong>{round.teams[1]}</strong>
                  </div>
                </div>

                <div className="single-answer-card">
                  <label>Senin cevabın</label>
                  <div className="answer-row">
                    <div className="autocomplete-wrap">
                      <input
                        value={answerInput}
                        disabled={roundLocked}
                        onFocus={() => {
                          if (!roundLocked && answerInput) {
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

                      {!roundLocked && focusedInput && suggestions.length > 0 && (
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
                      disabled={roundLocked}
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
  .ready-grid {
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
}
`;
