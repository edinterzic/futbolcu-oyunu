// =============================================
// PairFC Arena — Çok Kişili Canlı Yarışma Modu
// =============================================
// Akış:
// 1. Setup: "Yayıncı Ol" veya "Odaya Katıl"
// 2. Host: tur sayısı + rumuz → oda + PIN üretilir → lobi
// 3. Misafir: PIN + rumuz → odaya katılır → lobi
// 4. Lobi: host "Başlat"a basana kadar bekleme
// 5. Soru: 20 saniye, tek cevap hakkı, paralel
// 6. Leaderboard: 10 saniye, otomatik sıradaki
// 7. Final: scoreboard + paylaş

import React, { useEffect, useRef, useState } from "react";
import { t, useLang } from "../i18n";
import {
  generateArenaQuestions,
  checkArenaAnswer,
  calculateArenaScore,
  makeArenaPin,
  getArenaSuggestions,
} from "../utils/arenaQuestions";
import { TEAM_LOGOS } from "../data/teamLogos";
import { SOUND_FILES } from "../data/sounds";

const QUESTION_DURATION_MS = 20000;
const LEADERBOARD_DURATION_MS = 10000;
const MAX_PLAYERS_PER_ROOM = 50;

// ============================================
// SES SİSTEMİ — App.jsx'in _audioPool'unu paylaşır
// (window'a expose edildiği için aynı havuzu kullanır)
// ============================================
const _arenaAudioPool = {};

function initArenaAudio() {
  if (typeof window === "undefined") return;
  Object.keys(SOUND_FILES).forEach((name) => {
    if (_arenaAudioPool[name]) return;
    try {
      const audio = new Audio(SOUND_FILES[name]);
      audio.preload = "auto";
      audio.volume = 0.55;
      _arenaAudioPool[name] = audio;
    } catch {}
  });
}

function playArenaSound(soundName) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem("footballGameMuted") === "true") return;

  // App.jsx'le aynı semantik
  const soundMap = {
    correct: "correct",
    wrong: "wrong",
    matchEnd: "matchEnd",
    countdown: "countdown",
    urgentTick: "urgentTick",
    combo: "combo",
  };
  const fileKey = soundMap[soundName] || soundName;
  initArenaAudio();
  const audio = _arenaAudioPool[fileKey];
  if (!audio) return;

  try {
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {}
}

// ============================================
// TEAM LOGO — App.jsx'tekiyle aynı (TEAM_LOGOS objesinden gradient + harf)
// ============================================
function clubAutoText(hex) {
  if (typeof hex !== "string" || hex[0] !== "#") return "#ffffff";
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.62 ? "#15172c" : "#ffffff";
}

function clubAutoAbbr(name) {
  const w = String(name).replace(/[^A-Za-zÇĞİÖŞÜçğıöşü\s]/g, "").trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return w.slice(0, 3).map((x) => x[0]).join("").toLocaleUpperCase("tr");
  return String(name).slice(0, 3).toLocaleUpperCase("tr");
}

function clubHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clubStyle(teamName) {
  const d = TEAM_LOGOS[teamName];
  if (d && d.primary) {
    return {
      c1: d.primary,
      c2: d.secondary || "#ffffff",
      abbr: d.initials || clubAutoAbbr(teamName),
      text: clubAutoText(d.primary),
    };
  }
  const hue = clubHash(teamName) % 360;
  return {
    c1: `hsl(${hue} 52% 36%)`,
    c2: `hsl(${hue} 68% 72%)`,
    abbr: clubAutoAbbr(teamName),
    text: "#ffffff",
  };
}

function TeamLogo({ teamName, size = "md" }) {
  const { c1, c2, abbr, text } = clubStyle(teamName);
  return (
    <div
      className={`team-logo size-${size}`}
      style={{
        "--team-primary": c1,
        "--team-secondary": c2,
        "--team-text": text,
      }}
      aria-label={teamName}
    >
      <span className="team-logo__bar" aria-hidden="true"></span>
      <span className="team-logo__abbr">{abbr}</span>
    </div>
  );
}

// ============================================
// Yardımcı: timer formatla
// ============================================
function formatMs(ms) {
  if (ms <= 0) return "0";
  return Math.ceil(ms / 1000).toString();
}

// =============================================
// Ana Arena bileşeni
// =============================================
export default function Arena({ supabase, onExit }) {
  // Subscribe to lang so that all sub-renders pick up t() updates
  // eslint-disable-next-line no-unused-vars
  const [lang] = useLang();
  const [setupMode, setSetupMode] = useState(null);

  const userIdRef = useRef(null);
  if (!userIdRef.current) {
    let uid = localStorage.getItem("pairfc_arena_uid");
    if (!uid) {
      uid = `arena_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      localStorage.setItem("pairfc_arena_uid", uid);
    }
    userIdRef.current = uid;
  }

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [myAnswer, setMyAnswer] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState(null);
  const [answerInput, setAnswerInput] = useState("");

  // Timer
  const [now, setNow] = useState(Date.now());
  const lastTickSecondRef = useRef(-1);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Son 5 saniyede urgent tick sesi (her saniye bir kere)
  useEffect(() => {
    if (!room || room.status !== "question" || myAnswer) {
      lastTickSecondRef.current = -1;
      return;
    }
    const startMs = new Date(room.phase_started_at).getTime();
    const elapsed = now - startMs;
    const remaining = QUESTION_DURATION_MS - elapsed;
    const remainingSec = Math.ceil(remaining / 1000);
    if (remainingSec > 0 && remainingSec <= 5 && remainingSec !== lastTickSecondRef.current) {
      lastTickSecondRef.current = remainingSec;
      playArenaSound("urgentTick");
    }
  }, [now, room?.status, room?.phase_started_at, myAnswer]);

  // Realtime subscriptions
  useEffect(() => {
    if (!room?.id || !supabase) return;
    const channel = supabase
      .channel(`arena_room_${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "arena_rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.new) setRoom(payload.new);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "arena_players", filter: `room_id=eq.${room.id}` },
        async () => {
          const { data } = await supabase
            .from("arena_players")
            .select("*")
            .eq("room_id", room.id)
            .order("total_score", { ascending: false });
          if (data) setPlayers(data);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "arena_questions", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.new) {
            setCurrentQuestion(payload.new);
            setMyAnswer(null);
            setAnswers([]);
            setAnswerInput("");
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "arena_answers", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.new) {
            setAnswers((prev) => [...prev, payload.new]);
            if (payload.new.user_id === userIdRef.current) {
              setMyAnswer(payload.new);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id, supabase]);

  // İlk yüklemede mevcut state'i çek
  useEffect(() => {
    if (!room?.id || !supabase) return;
    (async () => {
      const { data: pl } = await supabase
        .from("arena_players")
        .select("*")
        .eq("room_id", room.id)
        .order("total_score", { ascending: false });
      if (pl) setPlayers(pl);

      if (room.current_question_id) {
        const { data: q } = await supabase
          .from("arena_questions")
          .select("*")
          .eq("id", room.current_question_id)
          .single();
        if (q) {
          setCurrentQuestion(q);
          const { data: ans } = await supabase
            .from("arena_answers")
            .select("*")
            .eq("question_id", q.id);
          if (ans) {
            setAnswers(ans);
            const mine = ans.find((a) => a.user_id === userIdRef.current);
            if (mine) setMyAnswer(mine);
          }
        }
      }
    })();
  }, [room?.id, supabase]);

  // ============================================
  // Oda Oluşturma (Host)
  // ============================================
  const createRoom = async (hostName, totalRounds) => {
    setError(null);
    if (!supabase) {
      setError(t("arena_err_no_server"));
      return;
    }
    const cleanName = hostName.trim().slice(0, 20) || t("arena_default_host_name");
    const rounds = Math.max(5, Math.min(30, parseInt(totalRounds, 10) || 10));

    let pin = makeArenaPin();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase
        .from("arena_rooms")
        .select("id")
        .eq("pin", pin)
        .neq("status", "finished")
        .maybeSingle();
      if (!existing) break;
      pin = makeArenaPin();
    }

    const { data: newRoom, error: roomErr } = await supabase
      .from("arena_rooms")
      .insert({
        pin,
        host_id: userIdRef.current,
        host_nickname: cleanName,
        total_rounds: rounds,
        status: "lobby",
      })
      .select()
      .single();

    if (roomErr) {
      setError(t("arena_err_create_room", { msg: roomErr.message }));
      return;
    }

    await supabase.from("arena_players").insert({
      room_id: newRoom.id,
      user_id: userIdRef.current,
      nickname: cleanName,
      is_host: true,
    });

    setRoom(newRoom);
  };

  // ============================================
  // Odaya Katılma (Misafir)
  // ============================================
  const joinRoom = async (pin, nickname) => {
    setError(null);
    if (!supabase) {
      setError(t("arena_err_no_server"));
      return;
    }
    const cleanPin = pin.trim().replace(/\s/g, "");
    if (cleanPin.length !== 6) {
      setError(t("arena_err_pin_length"));
      return;
    }
    const cleanName = nickname.trim().slice(0, 20) || t("arena_default_guest_name");

    const { data: foundRoom, error: roomErr } = await supabase
      .from("arena_rooms")
      .select("*")
      .eq("pin", cleanPin)
      .neq("status", "finished")
      .maybeSingle();

    if (roomErr || !foundRoom) {
      setError(t("arena_err_room_not_found"));
      return;
    }
    if (foundRoom.status !== "lobby") {
      setError(t("arena_err_game_started"));
      return;
    }

    const { count } = await supabase
      .from("arena_players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", foundRoom.id);

    if (count >= MAX_PLAYERS_PER_ROOM) {
      setError(t("arena_err_room_full"));
      return;
    }

    const { error: joinErr } = await supabase
      .from("arena_players")
      .upsert(
        {
          room_id: foundRoom.id,
          user_id: userIdRef.current,
          nickname: cleanName,
          is_host: false,
        },
        { onConflict: "room_id,user_id" }
      );

    if (joinErr) {
      setError(t("arena_err_join", { msg: joinErr.message }));
      return;
    }

    setRoom(foundRoom);
  };

  // ============================================
  // Oyunu Başlatma (host)
  // ============================================
  const startGame = async () => {
    if (!room || room.host_id !== userIdRef.current) return;
    setError(null);

    const questions = generateArenaQuestions(room.total_rounds);
    if (questions.length === 0) {
      setError(t("arena_err_no_questions"));
      return;
    }

    await startNextRound(1, questions[0]);

    localStorage.setItem(
      `pairfc_arena_q_${room.id}`,
      JSON.stringify(questions)
    );
  };

  const startNextRound = async (roundNumber, questionData) => {
    if (!room) return;

    const { data: newQ, error: qErr } = await supabase
      .from("arena_questions")
      .insert({
        room_id: room.id,
        round_number: roundNumber,
        club_a: questionData.clubA,
        club_b: questionData.clubB,
        correct_answers: questionData.correctAnswers,
      })
      .select()
      .single();

    if (qErr) {
      setError(`Soru başlatılamadı: ${qErr.message}`);
      return;
    }

    await supabase
      .from("arena_rooms")
      .update({
        current_round: roundNumber,
        current_question_id: newQ.id,
        status: "question",
        phase_started_at: new Date().toISOString(),
      })
      .eq("id", room.id);
  };

  const moveToLeaderboard = async () => {
    if (!room || room.host_id !== userIdRef.current) return;

    const { data: thisAnswers } = await supabase
      .from("arena_answers")
      .select("user_id, score")
      .eq("question_id", room.current_question_id);

    if (thisAnswers) {
      for (const a of thisAnswers) {
        if (a.score > 0) {
          const { data: pl } = await supabase
            .from("arena_players")
            .select("total_score")
            .eq("room_id", room.id)
            .eq("user_id", a.user_id)
            .single();
          if (pl) {
            await supabase
              .from("arena_players")
              .update({ total_score: pl.total_score + a.score })
              .eq("room_id", room.id)
              .eq("user_id", a.user_id);
          }
        }
      }
    }

    await supabase
      .from("arena_rooms")
      .update({
        status: "leaderboard",
        phase_started_at: new Date().toISOString(),
      })
      .eq("id", room.id);
  };

  const moveToNextOrFinish = async () => {
    if (!room || room.host_id !== userIdRef.current) return;

    const nextRound = room.current_round + 1;

    if (nextRound > room.total_rounds) {
      playArenaSound("matchEnd");
      await supabase
        .from("arena_rooms")
        .update({
          status: "finished",
          ended_at: new Date().toISOString(),
        })
        .eq("id", room.id);
      return;
    }

    const stored = JSON.parse(localStorage.getItem(`pairfc_arena_q_${room.id}`) || "[]");
    const nextQ = stored[nextRound - 1];
    if (!nextQ) {
      setError(t("arena_err_next_q"));
      return;
    }
    await startNextRound(nextRound, nextQ);
  };

  // ============================================
  // Cevap Gönderme — burada ses + UX
  // ============================================
  const submitAnswer = async () => {
    if (!currentQuestion || myAnswer) return;
    const trimmed = answerInput.trim();
    if (!trimmed) return;

    const startMs = new Date(room.phase_started_at).getTime();
    const responseTimeMs = Date.now() - startMs;
    if (responseTimeMs > QUESTION_DURATION_MS) return;

    const isCorrect = checkArenaAnswer(trimmed, currentQuestion.correct_answers);
    const score = calculateArenaScore(isCorrect, responseTimeMs, QUESTION_DURATION_MS);

    const myPlayer = players.find((p) => p.user_id === userIdRef.current);
    const nickname = myPlayer?.nickname || t("arena_default_guest_name");

    const { error: ansErr } = await supabase.from("arena_answers").insert({
      question_id: currentQuestion.id,
      room_id: room.id,
      user_id: userIdRef.current,
      nickname,
      answer_text: trimmed,
      is_correct: isCorrect,
      response_time_ms: responseTimeMs,
      score,
    });

    // Ses çal
    if (!ansErr) {
      playArenaSound(isCorrect ? "correct" : "wrong");
    }

    setAnswerInput("");
  };

  // ============================================
  // Faz otomatik geçişler (host)
  // ============================================
  const isHost = room?.host_id === userIdRef.current;

  useEffect(() => {
    if (!isHost || !room) return;
    if (room.status === "question") {
      const startMs = new Date(room.phase_started_at).getTime();
      const elapsed = Date.now() - startMs;
      const remaining = QUESTION_DURATION_MS - elapsed;
      if (remaining <= 0) {
        moveToLeaderboard();
      } else {
        const id = setTimeout(() => moveToLeaderboard(), remaining + 200);
        return () => clearTimeout(id);
      }
    } else if (room.status === "leaderboard") {
      const startMs = new Date(room.phase_started_at).getTime();
      const elapsed = Date.now() - startMs;
      const remaining = LEADERBOARD_DURATION_MS - elapsed;
      if (remaining <= 0) {
        moveToNextOrFinish();
      } else {
        const id = setTimeout(() => moveToNextOrFinish(), remaining + 200);
        return () => clearTimeout(id);
      }
    }
  }, [isHost, room?.status, room?.phase_started_at]);

  // ============================================
  // Çıkış
  // ============================================
  const leaveRoom = async () => {
    if (room && supabase) {
      try {
        await supabase
          .from("arena_players")
          .delete()
          .eq("room_id", room.id)
          .eq("user_id", userIdRef.current);
      } catch {}
    }
    setRoom(null);
    setPlayers([]);
    setCurrentQuestion(null);
    setMyAnswer(null);
    setAnswers([]);
    setSetupMode(null);
    setError(null);
    if (onExit) onExit();
  };

  // ============================================
  // RENDER
  // ============================================
  if (!room) {
    return (
      <ArenaSetup
        setupMode={setupMode}
        setSetupMode={setSetupMode}
        onCreate={createRoom}
        onJoin={joinRoom}
        onExit={onExit}
        error={error}
      />
    );
  }

  if (room.status === "lobby") {
    return (
      <ArenaLobby
        room={room}
        players={players}
        isHost={isHost}
        userId={userIdRef.current}
        onStart={startGame}
        onLeave={leaveRoom}
      />
    );
  }

  if (room.status === "question") {
    const startMs = new Date(room.phase_started_at).getTime();
    const remainingMs = Math.max(0, QUESTION_DURATION_MS - (now - startMs));
    return (
      <ArenaQuestion
        room={room}
        question={currentQuestion}
        players={players}
        answers={answers}
        myAnswer={myAnswer}
        answerInput={answerInput}
        setAnswerInput={setAnswerInput}
        onSubmit={submitAnswer}
        remainingMs={remainingMs}
        isHost={isHost}
      />
    );
  }

  if (room.status === "leaderboard") {
    const startMs = new Date(room.phase_started_at).getTime();
    const remainingMs = Math.max(0, LEADERBOARD_DURATION_MS - (now - startMs));
    return (
      <ArenaLeaderboard
        room={room}
        players={players}
        question={currentQuestion}
        answers={answers}
        myAnswer={myAnswer}
        userId={userIdRef.current}
        remainingMs={remainingMs}
        isLastRound={room.current_round >= room.total_rounds}
      />
    );
  }

  if (room.status === "finished") {
    return (
      <ArenaFinal
        room={room}
        players={players}
        userId={userIdRef.current}
        onExit={leaveRoom}
      />
    );
  }

  return null;
}

// =============================================
// ArenaSetup
// =============================================
function ArenaSetup({ setupMode, setSetupMode, onCreate, onJoin, onExit, error }) {
  const [hostName, setHostName] = useState(() => localStorage.getItem("pairfc_player_name") || "");
  const [totalRounds, setTotalRounds] = useState(10);
  const [joinPin, setJoinPin] = useState("");
  const [joinName, setJoinName] = useState(() => localStorage.getItem("pairfc_player_name") || "");

  if (setupMode === null) {
    return (
      <div className="arena-screen">
        <div className="arena-header">
          <button type="button" onClick={onExit} className="arena-back" aria-label={t("arena_back")}>←</button>
          <h1>🏟️ {t("arena_title")}</h1>
          <span className="arena-sub">{t("arena_subtitle")}</span>
        </div>

        <div className="arena-setup-grid">
          <button
            type="button"
            onClick={() => setSetupMode("create")}
            className="arena-setup-card arena-setup-host"
          >
            <span className="arena-setup-icon">📡</span>
            <strong>{t("arena_be_host")}</strong>
            <small>{t("arena_be_host_sub")}</small>
          </button>

          <button
            type="button"
            onClick={() => setSetupMode("join")}
            className="arena-setup-card arena-setup-guest"
          >
            <span className="arena-setup-icon">🎮</span>
            <strong>{t("arena_join_room")}</strong>
            <small>{t("arena_join_room_sub")}</small>
          </button>
        </div>

        <div className="arena-info">
          <p><strong>{t("arena_how_to_play")}</strong></p>
          <ul>
            <li>{t("arena_rule_1")}</li>
            <li>{t("arena_rule_2")}</li>
            <li>{t("arena_rule_3")}</li>
            <li>{t("arena_rule_4")}</li>
            <li>{t("arena_rule_5")}</li>
          </ul>
        </div>
      </div>
    );
  }

  if (setupMode === "create") {
    return (
      <div className="arena-screen">
        <div className="arena-header">
          <button type="button" onClick={() => setSetupMode(null)} className="arena-back" aria-label={t("arena_back")}>←</button>
          <h1>📡 {t("arena_open_room")}</h1>
        </div>

        <div className="arena-form">
          <label className="arena-label">
            <span>{t("arena_host_name")}</span>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder={t("arena_host_name_placeholder")}
              maxLength={20}
              className="arena-input"
            />
          </label>

          <label className="arena-label">
            <span>{t("arena_how_many_q")}</span>
            <div className="arena-rounds-row">
              {[5, 10, 15, 20, 25, 30].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTotalRounds(n)}
                  className={`arena-round-chip ${totalRounds === n ? "active" : ""}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>

          {error && <div className="arena-error">{error}</div>}

          <button
            type="button"
            onClick={() => {
              if (hostName.trim()) {
                localStorage.setItem("pairfc_player_name", hostName.trim());
              }
              onCreate(hostName, totalRounds);
            }}
            disabled={!hostName.trim()}
            className="arena-cta"
          >
            {t("arena_open_room")}
          </button>
        </div>
      </div>
    );
  }

  if (setupMode === "join") {
    return (
      <div className="arena-screen">
        <div className="arena-header">
          <button type="button" onClick={() => setSetupMode(null)} className="arena-back" aria-label={t("arena_back")}>←</button>
          <h1>🎮 {t("arena_join_room")}</h1>
        </div>

        <div className="arena-form">
          <label className="arena-label">
            <span>{t("arena_room_pin_6")}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={joinPin}
              onChange={(e) => setJoinPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="arena-input arena-pin-input"
            />
          </label>

          <label className="arena-label">
            <span>{t("arena_your_nickname")}</span>
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder={t("arena_nickname_placeholder")}
              maxLength={20}
              className="arena-input"
            />
          </label>

          {error && <div className="arena-error">{error}</div>}

          <button
            type="button"
            onClick={() => {
              if (joinName.trim()) {
                localStorage.setItem("pairfc_player_name", joinName.trim());
              }
              onJoin(joinPin, joinName);
            }}
            disabled={joinPin.length !== 6 || !joinName.trim()}
            className="arena-cta"
          >
            {t("arena_join_cta")}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// =============================================
// ArenaLobby
// =============================================
function ArenaLobby({ room, players, isHost, userId, onStart, onLeave }) {
  return (
    <div className="arena-screen">
      <div className="arena-header">
        <button type="button" onClick={onLeave} className="arena-back" aria-label={t("arena_back")}>←</button>
        <h1>🏟️ {t("arena_lobby_title")}</h1>
      </div>

      <div className="arena-lobby">
        <div className="arena-pin-display">
          <span className="arena-pin-label">{t("arena_room_pin")}</span>
          <strong className="arena-pin-value">{room.pin}</strong>
          <small>{t("arena_n_questions", { n: room.total_rounds })}</small>
        </div>

        <div className="arena-players-list">
          <div className="arena-players-header">
            <strong>{t("arena_players_count", { n: players.length })}</strong>
            {!isHost && <span className="arena-waiting">{t("arena_waiting_for_host")}</span>}
          </div>
          {players.map((p) => (
            <div key={p.id} className={`arena-player-row ${p.user_id === userId ? "me" : ""}`}>
              <span className="arena-player-name">
                {p.is_host && "📡 "}
                {p.nickname}
                {p.user_id === userId && ` ${t("arena_you_suffix")}`}
              </span>
            </div>
          ))}
          {players.length === 0 && (
            <div className="arena-empty">{t("arena_no_players_yet")}</div>
          )}
        </div>

        {isHost && (
          <button
            type="button"
            onClick={onStart}
            disabled={players.length < 1}
            className="arena-cta"
          >
            {players.length < 2 ? t("arena_waiting_min_guest") : t("arena_start_game")}
          </button>
        )}

        {isHost && (
          <p className="arena-host-hint">
            {t("arena_host_hint")}
          </p>
        )}
      </div>
    </div>
  );
}

// =============================================
// ArenaQuestion — soru ekranı + autocomplete + logo
// =============================================
function ArenaQuestion({ room, question, players, answers, myAnswer, answerInput, setAnswerInput, onSubmit, remainingMs, isHost }) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  // Input değişince suggestion güncelle
  useEffect(() => {
    if (!answerInput || myAnswer) {
      setSuggestions([]);
      return;
    }
    setSuggestions(getArenaSuggestions(answerInput));
  }, [answerInput, myAnswer]);

  if (!question) {
    return (
      <div className="arena-screen">
        <div className="arena-loading">{t("arena_loading_question")}</div>
      </div>
    );
  }

  const seconds = formatMs(remainingMs);
  const isLowTime = remainingMs < 5000;
  const answeredCount = answers.length;

  const selectSuggestion = (name) => {
    setAnswerInput(name);
    setFocused(false);
  };

  return (
    <div className="arena-screen arena-question-screen">
      <div className="arena-question-header">
        <span className="arena-round-counter">
          {t("arena_question_n_of_m", { n: room.current_round, m: room.total_rounds })}
        </span>
        <span className={`arena-timer ${isLowTime ? "low" : ""}`}>
          ⏱️ {t("arena_seconds_short", { n: seconds })}
        </span>
      </div>

      <div className="arena-question-clubs">
        <div className="arena-club">
          <TeamLogo teamName={question.club_a} size="md" />
          <strong>{question.club_a}</strong>
        </div>
        <div className="arena-vs">×</div>
        <div className="arena-club">
          <TeamLogo teamName={question.club_b} size="md" />
          <strong>{question.club_b}</strong>
        </div>
      </div>

      <div className="arena-question-prompt">
        {t("arena_question_prompt")}
      </div>

      {!myAnswer ? (
        <div className="arena-answer-area">
          <div className="arena-autocomplete-wrap">
            <input
              type="text"
              value={answerInput}
              onChange={(e) => {
                setAnswerInput(e.target.value);
                setFocused(true);
              }}
              onFocus={() => {
                if (answerInput) setFocused(true);
              }}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answerInput.trim()) onSubmit();
              }}
              placeholder={t("arena_answer_placeholder")}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              maxLength={50}
              className="arena-input arena-answer-input"
            />

            {focused && suggestions.length > 0 && (
              <div className="arena-suggestions">
                {suggestions.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(p.name);
                    }}
                    onClick={() => selectSuggestion(p.name)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!answerInput.trim()}
            className="arena-cta arena-submit"
          >
            {t("arena_submit")}
          </button>
          <small className="arena-hint">{t("arena_one_shot_hint")}</small>
        </div>
      ) : (
        <div className={`arena-my-result ${myAnswer.is_correct ? "correct" : "wrong"}`}>
          <strong>{myAnswer.is_correct ? `✅ ${t("arena_correct")}` : `❌ ${t("arena_wrong")}`}</strong>
          <span>{t("arena_your_answer", { answer: myAnswer.answer_text })}</span>
          {myAnswer.is_correct && (
            <span className="arena-score-gained">+{myAnswer.score} {t("arena_points_short")}</span>
          )}
          <small>{t("arena_wait_others")}</small>
        </div>
      )}

      <div className="arena-progress">
        <small>{t("arena_progress_answered", { done: answeredCount, total: players.length })}</small>
        <div className="arena-progress-bar">
          <div
            className="arena-progress-fill"
            style={{ width: `${(answeredCount / Math.max(1, players.length)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// =============================================
// ArenaLeaderboard
// =============================================
function ArenaLeaderboard({ room, players, question, answers, myAnswer, userId, remainingMs, isLastRound }) {
  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const seconds = formatMs(remainingMs);
  const correctList = question?.correct_answers || [];

  return (
    <div className="arena-screen arena-leaderboard-screen">
      <div className="arena-question-header">
        <span className="arena-round-counter">
          {t("arena_question_n_of_m", { n: room.current_round, m: room.total_rounds })}
        </span>
        <span className="arena-timer">
          {isLastRound ? t("arena_final_label") : t("arena_next_in", { n: seconds })}
        </span>
      </div>

      <div className="arena-correct-answers">
        <div className="arena-correct-clubs">
          <TeamLogo teamName={question?.club_a} size="sm" />
          <strong>{question?.club_a} × {question?.club_b}</strong>
          <TeamLogo teamName={question?.club_b} size="sm" />
        </div>
        <small>{t("arena_correct_answers_label")}</small>
        <div className="arena-correct-chips">
          {correctList.map((a) => (
            <span key={a} className="arena-correct-chip">{a}</span>
          ))}
        </div>
      </div>

      <div className="arena-leaderboard-list">
        <strong className="arena-leaderboard-title">📊 {t("arena_ranking_title")}</strong>
        {sorted.map((p, i) => {
          const thisRoundAns = answers.find((a) => a.user_id === p.user_id);
          const gained = thisRoundAns?.score || 0;
          return (
            <div key={p.id} className={`arena-leader-row ${p.user_id === userId ? "me" : ""} ${i < 3 ? `top-${i + 1}` : ""}`}>
              <span className="arena-leader-rank">{i + 1}</span>
              <span className="arena-leader-name">
                {p.is_host && "📡 "}
                {p.nickname}
              </span>
              <span className="arena-leader-score">
                {p.total_score}
                {gained > 0 && <em className="arena-leader-gain">+{gained}</em>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================
// ArenaFinal
// =============================================
function ArenaFinal({ room, players, userId, onExit }) {
  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const winner = sorted[0];
  const myRank = sorted.findIndex((p) => p.user_id === userId) + 1;
  const isMyWin = winner?.user_id === userId;

  const sharetxt = encodeURIComponent(
    t("arena_share_text", {
      winner: winner?.nickname || "",
      rounds: room.total_rounds,
      players: players.length
    })
  );

  return (
    <div className="arena-screen arena-final-screen">
      <div className="arena-final-trophy">🏆</div>
      <h1 className="arena-final-title">
        {isMyWin ? t("arena_you_champion") : t("arena_someone_champion", { name: winner?.nickname || "" })}
      </h1>
      <small className="arena-final-sub">
        {t("arena_final_summary", { rounds: room.total_rounds, players: players.length, rank: myRank })}
      </small>

      <div className="arena-leaderboard-list">
        {sorted.slice(0, 10).map((p, i) => (
          <div key={p.id} className={`arena-leader-row ${p.user_id === userId ? "me" : ""} ${i < 3 ? `top-${i + 1}` : ""}`}>
            <span className="arena-leader-rank">{i + 1}</span>
            <span className="arena-leader-name">
              {p.is_host && "📡 "}
              {p.nickname}
            </span>
            <span className="arena-leader-score">{p.total_score}</span>
          </div>
        ))}
      </div>

      <div className="arena-final-actions">
        <a
          href={`https://wa.me/?text=${sharetxt}`}
          target="_blank"
          rel="noopener noreferrer"
          className="arena-cta arena-share"
        >
          📱 {t("arena_share")}
        </a>
        <button type="button" onClick={onExit} className="arena-cta arena-exit">
          {t("arena_back_home")}
        </button>
      </div>
    </div>
  );
}
