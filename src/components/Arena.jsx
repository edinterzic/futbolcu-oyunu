// =============================================
// PairFC Arena — Çok Kişili Canlı Yarışma Modu
// =============================================
// Akış:
// 1. Anasayfa → "Arena" tıklanır → onStart props ile çağrılır
// 2. Setup ekranı: Kullanıcı "Oda Aç" veya "Odaya Katıl" seçer
// 3. Host: tur sayısı + rumuz girer → oda oluşturulur (PIN üretilir) → lobi
// 4. Misafir: PIN + rumuz girer → odaya katılır → lobi
// 5. Lobi: host "Başlat"a basana kadar bekleme (gerçek zamanlı oyuncu listesi)
// 6. Soru: 20 saniye, herkes tek cevap hakkı, paralel
// 7. Leaderboard: 10 saniye liderlik tablosu + geri sayım, sonra otomatik bir sonraki
// 8. Final: tüm turlar bitince büyük scoreboard

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  generateArenaQuestions,
  checkArenaAnswer,
  calculateArenaScore,
  makeArenaPin,
} from "../utils/arenaQuestions";
import { TEAM_LOGOS } from "../data/teamLogos";

const QUESTION_DURATION_MS = 20000; // 20 saniye soru
const LEADERBOARD_DURATION_MS = 10000; // 10 saniye leaderboard
const MAX_PLAYERS_PER_ROOM = 50;

// Yardımcı: tek satırlık formatlanmış zamanlayıcı
function formatMs(ms) {
  if (ms <= 0) return "0";
  return Math.ceil(ms / 1000).toString();
}

// =============================================
// Ana Arena bileşeni
// =============================================
export default function Arena({ supabase, onExit }) {
  // Setup ekranı: null | "create" | "join"
  const [setupMode, setSetupMode] = useState(null);

  // Kalıcı kullanıcı ID (anonim)
  const userIdRef = useRef(null);
  if (!userIdRef.current) {
    let uid = localStorage.getItem("pairfc_arena_uid");
    if (!uid) {
      uid = `arena_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      localStorage.setItem("pairfc_arena_uid", uid);
    }
    userIdRef.current = uid;
  }

  // Oda + oyuncu state
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [myAnswer, setMyAnswer] = useState(null); // {is_correct, score, response_time_ms}
  const [answers, setAnswers] = useState([]); // tüm cevaplar (mevcut soru için)
  const [error, setError] = useState(null);

  // Cevap input
  const [answerInput, setAnswerInput] = useState("");

  // Timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Realtime subscription
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
            // Eğer cevap benim ise, kendi cevap bilgimi de set et
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

  // İlk yüklemede mevcut oyuncu listesini çek
  useEffect(() => {
    if (!room?.id || !supabase) return;
    (async () => {
      const { data: pl } = await supabase
        .from("arena_players")
        .select("*")
        .eq("room_id", room.id)
        .order("total_score", { ascending: false });
      if (pl) setPlayers(pl);

      // Mevcut bir soru varsa onu da çek
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
      setError("Sunucu bağlantısı yok.");
      return;
    }
    const cleanName = hostName.trim().slice(0, 20) || "Yayıncı";
    const rounds = Math.max(5, Math.min(30, parseInt(totalRounds, 10) || 10));

    // Unique PIN bul (denemeyle)
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
      setError(`Oda oluşturulamadı: ${roomErr.message}`);
      return;
    }

    // Host'u da katılımcı olarak ekle (kendi puanı için)
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
      setError("Sunucu bağlantısı yok.");
      return;
    }
    const cleanPin = pin.trim().replace(/\s/g, "");
    if (cleanPin.length !== 6) {
      setError("PIN 6 haneli olmalı.");
      return;
    }
    const cleanName = nickname.trim().slice(0, 20) || "Anonim";

    const { data: foundRoom, error: roomErr } = await supabase
      .from("arena_rooms")
      .select("*")
      .eq("pin", cleanPin)
      .neq("status", "finished")
      .maybeSingle();

    if (roomErr || !foundRoom) {
      setError("Oda bulunamadı. PIN'i kontrol et.");
      return;
    }
    if (foundRoom.status !== "lobby") {
      setError("Oyun başlamış. Yeni bir oda dene.");
      return;
    }

    // Mevcut oyuncu sayısını kontrol et
    const { count } = await supabase
      .from("arena_players")
      .select("*", { count: "exact", head: true })
      .eq("room_id", foundRoom.id);

    if (count >= MAX_PLAYERS_PER_ROOM) {
      setError("Oda dolu (50 kişi).");
      return;
    }

    // Aynı user_id ile tekrar katılım — sadece set
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
      setError(`Katılım hatası: ${joinErr.message}`);
      return;
    }

    setRoom(foundRoom);
  };

  // ============================================
  // Oyunu Başlatma (sadece host)
  // ============================================
  const startGame = async () => {
    if (!room || room.host_id !== userIdRef.current) return;
    setError(null);

    // 1. Soruları üret
    const questions = generateArenaQuestions(room.total_rounds);
    if (questions.length === 0) {
      setError("Soru havuzu boş.");
      return;
    }

    // 2. İlk soruyu insert et
    await startNextRound(1, questions[0]);

    // 3. Soru havuzunu localStorage'a sakla (sadece host)
    localStorage.setItem(
      `pairfc_arena_q_${room.id}`,
      JSON.stringify(questions)
    );
  };

  // Bir sonraki soruyu başlat (host)
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

    // Odayı güncelle: yeni soru + status=question + phase başlangıcı
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

  // Soru süresi bitti, leaderboard'a geç (host)
  const moveToLeaderboard = async () => {
    if (!room || room.host_id !== userIdRef.current) return;

    // Bu soru için herkesin puanını oyuncu toplam puanına ekle
    const { data: thisAnswers } = await supabase
      .from("arena_answers")
      .select("user_id, score")
      .eq("question_id", room.current_question_id);

    if (thisAnswers) {
      for (const a of thisAnswers) {
        if (a.score > 0) {
          // Atomik: önce şu anki puanı çek, sonra ekle
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

  // Leaderboard bitti, bir sonraki soruya geç veya finish (host)
  const moveToNextOrFinish = async () => {
    if (!room || room.host_id !== userIdRef.current) return;

    const nextRound = room.current_round + 1;

    if (nextRound > room.total_rounds) {
      // Oyun bitti
      await supabase
        .from("arena_rooms")
        .update({
          status: "finished",
          ended_at: new Date().toISOString(),
        })
        .eq("id", room.id);
      return;
    }

    // Sıradaki soruyu localStorage'dan al
    const stored = JSON.parse(localStorage.getItem(`pairfc_arena_q_${room.id}`) || "[]");
    const nextQ = stored[nextRound - 1];
    if (!nextQ) {
      setError("Sıradaki soru bulunamadı.");
      return;
    }
    await startNextRound(nextRound, nextQ);
  };

  // ============================================
  // Cevap gönderme (oyuncu — host dahil)
  // ============================================
  const submitAnswer = async () => {
    if (!currentQuestion || myAnswer) return;
    const trimmed = answerInput.trim();
    if (!trimmed) return;

    const startMs = new Date(room.phase_started_at).getTime();
    const responseTimeMs = Date.now() - startMs;
    if (responseTimeMs > QUESTION_DURATION_MS) return; // süre bitti

    const isCorrect = checkArenaAnswer(trimmed, currentQuestion.correct_answers);
    const score = calculateArenaScore(isCorrect, responseTimeMs, QUESTION_DURATION_MS);

    const myPlayer = players.find((p) => p.user_id === userIdRef.current);
    const nickname = myPlayer?.nickname || "Anonim";

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

    if (ansErr) {
      // Duplicate veya hata - sessizce geç
      console.warn("Cevap kaydı:", ansErr.message);
    }

    setAnswerInput("");
  };

  // ============================================
  // Faz timer'ları (host otomatik geçiş)
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

  // Setup ekranı (oda yok)
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

  // Lobi
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

  // Soru fazı
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

  // Leaderboard
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

  // Final
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
// ArenaSetup — Oda aç / Odaya katıl seçimi
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
          <button type="button" onClick={onExit} className="arena-back">←</button>
          <h1>🏟️ Arena</h1>
          <span className="arena-sub">Çok kişili canlı yarışma</span>
        </div>

        <div className="arena-setup-grid">
          <button
            type="button"
            onClick={() => setSetupMode("create")}
            className="arena-setup-card arena-setup-host"
          >
            <span className="arena-setup-icon">📡</span>
            <strong>Yayıncı Ol</strong>
            <small>Oda aç, PIN üret, oyunu yönet</small>
          </button>

          <button
            type="button"
            onClick={() => setSetupMode("join")}
            className="arena-setup-card arena-setup-guest"
          >
            <span className="arena-setup-icon">🎮</span>
            <strong>Odaya Katıl</strong>
            <small>PIN'i yaz, yarışmaya katıl</small>
          </button>
        </div>

        <div className="arena-info">
          <p><strong>Nasıl oynanır?</strong></p>
          <ul>
            <li>Yayıncı oda açar, 6 haneli PIN üretilir.</li>
            <li>Katılımcılar PIN ile odaya girer (en fazla 50 kişi).</li>
            <li>Her soruda 2 takım gösterilir, 20 saniye içinde ortak oyuncuyu yazarsın.</li>
            <li>Hızlı doğru cevap = daha çok puan.</li>
            <li>Yayıncı kaç soru sorulacağını seçer (5–30).</li>
          </ul>
        </div>
      </div>
    );
  }

  if (setupMode === "create") {
    return (
      <div className="arena-screen">
        <div className="arena-header">
          <button type="button" onClick={() => setSetupMode(null)} className="arena-back">←</button>
          <h1>📡 Oda Aç</h1>
        </div>

        <div className="arena-form">
          <label className="arena-label">
            <span>Yayıncı adın</span>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="Örn: Özge"
              maxLength={20}
              className="arena-input"
            />
          </label>

          <label className="arena-label">
            <span>Kaç soru?</span>
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
            Oda Aç
          </button>
        </div>
      </div>
    );
  }

  if (setupMode === "join") {
    return (
      <div className="arena-screen">
        <div className="arena-header">
          <button type="button" onClick={() => setSetupMode(null)} className="arena-back">←</button>
          <h1>🎮 Odaya Katıl</h1>
        </div>

        <div className="arena-form">
          <label className="arena-label">
            <span>Oda PIN'i (6 hane)</span>
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
            <span>Rumuzun</span>
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Örn: Mehmet"
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
            Katıl
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// =============================================
// ArenaLobby — Bekleme odası
// =============================================
function ArenaLobby({ room, players, isHost, userId, onStart, onLeave }) {
  const myPlayer = players.find((p) => p.user_id === userId);

  return (
    <div className="arena-screen">
      <div className="arena-header">
        <button type="button" onClick={onLeave} className="arena-back">←</button>
        <h1>🏟️ Lobi</h1>
      </div>

      <div className="arena-lobby">
        <div className="arena-pin-display">
          <span className="arena-pin-label">Oda PIN'i</span>
          <strong className="arena-pin-value">{room.pin}</strong>
          <small>{room.total_rounds} soru</small>
        </div>

        <div className="arena-players-list">
          <div className="arena-players-header">
            <strong>Katılımcılar ({players.length})</strong>
            {!isHost && <span className="arena-waiting">Yayıncı bekleniyor…</span>}
          </div>
          {players.map((p) => (
            <div key={p.id} className={`arena-player-row ${p.user_id === userId ? "me" : ""}`}>
              <span className="arena-player-name">
                {p.is_host && "📡 "}
                {p.nickname}
                {p.user_id === userId && " (sen)"}
              </span>
            </div>
          ))}
          {players.length === 0 && (
            <div className="arena-empty">Henüz kimse katılmadı.</div>
          )}
        </div>

        {isHost && (
          <button
            type="button"
            onClick={onStart}
            disabled={players.length < 1}
            className="arena-cta"
          >
            {players.length < 2 ? "Bekleniyor… (en az 1 misafir önerilir)" : "Oyunu Başlat"}
          </button>
        )}

        {isHost && (
          <p className="arena-host-hint">
            PIN'i takipçilerinle paylaş. Hazır olunca "Oyunu Başlat"a bas.
          </p>
        )}
      </div>
    </div>
  );
}

// =============================================
// ArenaQuestion — Soru ekranı (20 saniye)
// =============================================
function ArenaQuestion({ room, question, players, answers, myAnswer, answerInput, setAnswerInput, onSubmit, remainingMs, isHost }) {
  if (!question) {
    return (
      <div className="arena-screen">
        <div className="arena-loading">Soru yükleniyor…</div>
      </div>
    );
  }

  const seconds = formatMs(remainingMs);
  const isLowTime = remainingMs < 5000;
  const answeredCount = answers.length;

  // Kulüp logosu URL (gameData'da TEAM_LOGOS dict)
  const logoA = TEAM_LOGOS[question.club_a] || null;
  const logoB = TEAM_LOGOS[question.club_b] || null;

  return (
    <div className="arena-screen arena-question-screen">
      <div className="arena-question-header">
        <span className="arena-round-counter">
          Soru {room.current_round} / {room.total_rounds}
        </span>
        <span className={`arena-timer ${isLowTime ? "low" : ""}`}>
          ⏱️ {seconds}s
        </span>
      </div>

      <div className="arena-question-clubs">
        <div className="arena-club">
          {logoA && <img src={logoA} alt={question.club_a} className="arena-club-logo" />}
          <strong>{question.club_a}</strong>
        </div>
        <div className="arena-vs">×</div>
        <div className="arena-club">
          {logoB && <img src={logoB} alt={question.club_b} className="arena-club-logo" />}
          <strong>{question.club_b}</strong>
        </div>
      </div>

      <div className="arena-question-prompt">
        Bu iki kulüpte de oynamış bir oyuncu yaz:
      </div>

      {!myAnswer ? (
        <div className="arena-answer-area">
          <input
            type="text"
            value={answerInput}
            onChange={(e) => setAnswerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && answerInput.trim()) onSubmit();
            }}
            placeholder="Oyuncu adı (örn: Sneijder)"
            autoFocus
            maxLength={50}
            className="arena-input arena-answer-input"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!answerInput.trim()}
            className="arena-cta arena-submit"
          >
            Gönder
          </button>
          <small className="arena-hint">Tek hak — gönderdiğinde değiştiremezsin.</small>
        </div>
      ) : (
        <div className={`arena-my-result ${myAnswer.is_correct ? "correct" : "wrong"}`}>
          <strong>{myAnswer.is_correct ? "✅ Doğru!" : "❌ Yanlış"}</strong>
          <span>Cevabın: {myAnswer.answer_text}</span>
          {myAnswer.is_correct && (
            <span className="arena-score-gained">+{myAnswer.score} puan</span>
          )}
          <small>Diğerlerini bekle…</small>
        </div>
      )}

      <div className="arena-progress">
        <small>{answeredCount} / {players.length} cevapladı</small>
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
// ArenaLeaderboard — Tur sonu liderlik
// =============================================
function ArenaLeaderboard({ room, players, question, answers, myAnswer, userId, remainingMs, isLastRound }) {
  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const seconds = formatMs(remainingMs);

  // Doğru cevaplar listesi
  const correctList = question?.correct_answers || [];

  return (
    <div className="arena-screen arena-leaderboard-screen">
      <div className="arena-question-header">
        <span className="arena-round-counter">
          Soru {room.current_round} / {room.total_rounds}
        </span>
        <span className="arena-timer">
          {isLastRound ? "Final…" : `Sıradaki: ${seconds}s`}
        </span>
      </div>

      <div className="arena-correct-answers">
        <strong>{question?.club_a} × {question?.club_b}</strong>
        <small>Doğru cevaplar:</small>
        <div className="arena-correct-chips">
          {correctList.slice(0, 8).map((a) => (
            <span key={a} className="arena-correct-chip">{a}</span>
          ))}
          {correctList.length > 8 && <span className="arena-correct-chip more">+{correctList.length - 8}</span>}
        </div>
      </div>

      <div className="arena-leaderboard-list">
        <strong className="arena-leaderboard-title">📊 Sıralama</strong>
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
// ArenaFinal — Final scoreboard
// =============================================
function ArenaFinal({ room, players, userId, onExit }) {
  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const winner = sorted[0];
  const myRank = sorted.findIndex((p) => p.user_id === userId) + 1;
  const isMyWin = winner?.user_id === userId;

  const sharetxt = encodeURIComponent(
    `${winner?.nickname} Arena'da şampiyon oldu! 🏆\n${room.total_rounds} soru, ${players.length} oyuncu.\npairfc.com`
  );

  return (
    <div className="arena-screen arena-final-screen">
      <div className="arena-final-trophy">🏆</div>
      <h1 className="arena-final-title">
        {isMyWin ? "Şampiyon Sensin!" : `${winner?.nickname} Şampiyon!`}
      </h1>
      <small className="arena-final-sub">
        {room.total_rounds} soru, {players.length} oyuncu. Sıralaman: {myRank}.
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
          📱 Paylaş
        </a>
        <button type="button" onClick={onExit} className="arena-cta arena-exit">
          Anasayfaya Dön
        </button>
      </div>
    </div>
  );
}
