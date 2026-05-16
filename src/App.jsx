import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { PLAYERS, TEAMS, ANSWER_INDEX, getPairKey, getAnswers } from "./data/gameData";
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

  return `${player.name} bu eşleşme için doğru olmalıydı; veri kontrolü gerekiyor.

/* v17 mobile: remove huge empty team cards */
@media (max-width: 760px) {
  .teams-grid {
    grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr) !important;
    gap: 7px !important;
    margin: 6px 0 8px !important;
    align-items: stretch !important;
  }

  .team-card {
    min-height: 92px !important;
    height: 96px !important;
    max-height: 96px !important;
    padding: 8px 6px !important;
    border-radius: 18px !important;
    display: grid !important;
    grid-template-rows: 14px 38px auto !important;
    align-items: center !important;
    justify-items: center !important;
    overflow: hidden !important;
  }

  .team-card span {
    font-size: 10px !important;
    line-height: 1 !important;
    margin: 0 !important;
  }

  .team-logo {
    width: 38px !important;
    height: 38px !important;
    margin: 0 auto 2px !important;
    border-radius: 14px !important;
    padding: 3px !important;
    box-shadow: 0 6px 12px rgba(15, 23, 42, 0.14) !important;
  }

  .team-logo::after {
    inset: 3px !important;
    border-radius: 10px !important;
  }

  .team-logo__ring {
    border-radius: 10px !important;
  }

  .team-logo__inner {
    width: 28px !important;
    height: 28px !important;
    border-radius: 9px !important;
    padding: 3px !important;
  }

  .team-logo span {
    font-size: 11px !important;
  }

  .team-card strong {
    font-size: 15px !important;
    line-height: 1.05 !important;
    max-width: 100% !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
    text-align: center !important;
  }

  .versus {
    font-size: 13px !important;
    padding: 0 !important;
    align-self: center !important;
  }

  .single-answer-card {
    margin-top: 4px !important;
  }

  .bottom-actions {
    margin-top: 6px !important;
  }
}

@media (max-height: 740px) and (max-width: 760px) {
  .team-card {
    min-height: 78px !important;
    height: 80px !important;
    max-height: 80px !important;
    grid-template-rows: 12px 30px auto !important;
    padding: 6px 5px !important;
  }

  .team-logo {
    width: 30px !important;
    height: 30px !important;
  }

  .team-logo__inner {
    width: 22px !important;
    height: 22px !important;
    padding: 2px !important;
  }

  .team-card strong {
    font-size: 13px !important;
  }

  .team-card span {
    font-size: 9px !important;
  }
}



/* v18 hard mobile app layout: no giant white team cards, fit active game to one screen */
@media (max-width: 760px) {
  html,
  body,
  #root {
    height: 100%;
    min-height: 100%;
    overflow-x: hidden;
  }

  body {
    overscroll-behavior: none;
  }

  .app-shell {
    height: 100svh !important;
    min-height: 100svh !important;
    max-height: 100svh !important;
    overflow: hidden !important;
    padding: 4px !important;
  }

  .game-container {
    height: 100% !important;
    max-width: 100% !important;
    overflow: hidden !important;
  }

  .hero,
  .compact-hero {
    display: none !important;
  }

  .game-area {
    height: 100% !important;
    max-height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 5px !important;
    overflow: hidden !important;
  }

  .online-bar {
    display: none !important;
  }

  .score-grid,
  .score-grid.compact-score {
    flex: 0 0 auto !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 5px !important;
    margin: 0 !important;
  }

  .score-card {
    min-height: 44px !important;
    height: 44px !important;
    padding: 5px 8px !important;
    border-radius: 14px !important;
  }

  .score-card span {
    font-size: 10px !important;
    line-height: 1 !important;
  }

  .score-card strong {
    font-size: 24px !important;
    line-height: 1 !important;
    margin: 1px 0 0 !important;
  }

  .score-card em {
    display: none !important;
  }

  .series-bar {
    display: none !important;
  }

  .panel,
  .game-panel-compact {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    height: auto !important;
    overflow: hidden !important;
    padding: 7px !important;
    border-radius: 16px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 5px !important;
  }

  .top-row {
    flex: 0 0 auto !important;
    margin: 0 !important;
    display: grid !important;
    grid-template-columns: 1fr auto 1fr !important;
    align-items: center !important;
    gap: 4px !important;
  }

  .top-row .light-button {
    grid-column: 2 !important;
    min-height: 34px !important;
    padding: 6px 12px !important;
    border-radius: 14px !important;
    font-size: 13px !important;
  }

  .round-pill {
    grid-column: 2 !important;
    min-height: 30px !important;
    padding: 6px 10px !important;
    border-radius: 999px !important;
    font-size: 12px !important;
    justify-self: center !important;
  }

  .timer-box {
    flex: 0 0 auto !important;
    max-width: 100px !important;
    padding: 4px 8px !important;
    border-radius: 12px !important;
    margin: 0 auto !important;
  }

  .timer-box span,
  .timer-box em {
    display: none !important;
  }

  .timer-box strong {
    font-size: 20px !important;
    line-height: 1 !important;
  }

  .teams-grid,
  .teams-grid.compact-teams {
    flex: 0 0 auto !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr) !important;
    align-items: center !important;
    gap: 6px !important;
    margin: 2px 0 !important;
    height: 92px !important;
    min-height: 92px !important;
    max-height: 92px !important;
  }

  .team-card {
    height: 92px !important;
    min-height: 92px !important;
    max-height: 92px !important;
    background: rgba(255, 255, 255, 0.94) !important;
    border-radius: 18px !important;
    padding: 6px 5px !important;
    display: grid !important;
    grid-template-rows: 12px 34px 1fr !important;
    justify-items: center !important;
    align-items: center !important;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18) !important;
    overflow: hidden !important;
  }

  .team-card span {
    font-size: 9px !important;
    line-height: 1 !important;
    margin: 0 !important;
    color: #64748b !important;
  }

  .team-logo {
    width: 32px !important;
    height: 32px !important;
    min-width: 32px !important;
    min-height: 32px !important;
    margin: 0 !important;
    padding: 2px !important;
    border-radius: 11px !important;
    box-shadow: none !important;
  }

  .team-logo::after {
    display: none !important;
  }

  .team-logo__ring {
    border-radius: 9px !important;
  }

  .team-logo__inner {
    width: 25px !important;
    height: 25px !important;
    padding: 2px !important;
    border-radius: 8px !important;
  }

  .team-logo span {
    font-size: 10px !important;
  }

  .team-card strong {
    font-size: 14px !important;
    line-height: 1.08 !important;
    font-weight: 950 !important;
    max-width: 100% !important;
    text-align: center !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
  }

  .versus {
    font-size: 12px !important;
    font-weight: 950 !important;
    text-align: center !important;
    padding: 0 !important;
    color: #bbf7d0 !important;
  }

  .single-answer-card,
  .single-answer-card.compact-answer {
    flex: 0 0 auto !important;
    padding: 7px !important;
    border-radius: 16px !important;
    margin: 0 !important;
  }

  .single-answer-card label {
    display: none !important;
  }

  .wrong-right-info {
    font-size: 10px !important;
    padding: 4px 7px !important;
    margin: 0 0 5px !important;
  }

  .answer-row {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 82px !important;
    gap: 6px !important;
    align-items: stretch !important;
  }

  .single-answer-card input {
    height: 42px !important;
    min-height: 42px !important;
    padding: 8px 10px !important;
    border-radius: 13px !important;
    font-size: 16px !important;
  }

  .answer-row .primary-button {
    width: 82px !important;
    min-width: 82px !important;
    height: 42px !important;
    min-height: 42px !important;
    padding: 6px !important;
    border-radius: 13px !important;
    font-size: 12px !important;
  }

  .suggestions {
    max-height: 122px !important;
    border-radius: 14px !important;
  }

  .suggestions button {
    padding: 9px 10px !important;
    font-size: 12px !important;
  }

  .status-message {
    flex: 0 0 auto !important;
    margin: 0 !important;
    padding: 6px 8px !important;
    border-radius: 12px !important;
    font-size: 11px !important;
    max-height: 42px !important;
    overflow: hidden !important;
  }

  .wrong-explanation-card,
  .answers-box,
  .round-animation,
  .goal-animation,
  .concede-animation,
  .wrong-animation {
    flex: 0 1 auto !important;
    max-height: 82px !important;
    overflow: auto !important;
    margin: 0 !important;
    padding: 7px !important;
    border-radius: 14px !important;
    font-size: 11px !important;
  }

  .answers-box p {
    display: none !important;
  }

  .answer-tags {
    gap: 5px !important;
  }

  .answer-tags span,
  .answer-tags.clickable button {
    padding: 5px 7px !important;
    font-size: 10px !important;
  }

  .bottom-actions {
    flex: 0 0 auto !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 6px !important;
    margin: 0 !important;
  }

  .bottom-actions .light-button {
    min-height: 36px !important;
    height: 36px !important;
    padding: 5px !important;
    border-radius: 13px !important;
    font-size: 11px !important;
  }

  .challenge-tools {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 6px !important;
    margin: 0 !important;
  }

  .challenge-tools .light-button {
    min-height: 34px !important;
    height: 34px !important;
    padding: 5px !important;
    font-size: 10px !important;
    border-radius: 12px !important;
  }

  .joker-hint {
    margin: 0 !important;
    padding: 6px !important;
    max-height: 34px !important;
    overflow: hidden !important;
    font-size: 10px !important;
  }

  .pre-round-count {
    width: 84px !important;
    height: 84px !important;
    font-size: 46px !important;
  }
}

@media (max-width: 760px) and (max-height: 700px) {
  .score-grid {
    display: none !important;
  }

  .panel,
  .game-panel-compact {
    padding: 5px !important;
    gap: 4px !important;
  }

  .top-row .light-button,
  .round-pill {
    min-height: 28px !important;
    padding: 4px 9px !important;
    font-size: 11px !important;
  }

  .teams-grid,
  .teams-grid.compact-teams {
    height: 76px !important;
    min-height: 76px !important;
    max-height: 76px !important;
  }

  .team-card {
    height: 76px !important;
    min-height: 76px !important;
    max-height: 76px !important;
    grid-template-rows: 10px 26px 1fr !important;
  }

  .team-logo {
    width: 25px !important;
    height: 25px !important;
  }

  .team-logo__inner {
    width: 19px !important;
    height: 19px !important;
  }

  .team-card strong {
    font-size: 12px !important;
  }

  .single-answer-card input,
  .answer-row .primary-button {
    height: 38px !important;
    min-height: 38px !important;
  }

  .answer-row {
    grid-template-columns: minmax(0, 1fr) 72px !important;
  }

  .answer-row .primary-button {
    width: 72px !important;
    min-width: 72px !important;
  }
}

`;
}

function getCorrectPlayersForRound(round) {
  return getRoundAnswers(round).map((name) => ({ name }));
}

function getPlayerSuggestions(userInput) {
  const query = normalizeText(userInput);
  if (query.length < 1) return [];

  return SORTED_PLAYERS
    .filter((player) => player.suggestionTokens.some((token) => token.startsWith(query)))
    .slice(0, 8);
}

function getRoundKey(round) {
  return getPairKey(round.teams[0], round.teams[1]);
}

const PLAYABLE_TEAM_PAIRS = Object.keys(ANSWER_INDEX).map((key) => {
  const [teamA, teamB] = key.split("|");
  return { teams: [teamA, teamB] };
});

function getPlayableTeamPairs() {
  return PLAYABLE_TEAM_PAIRS;
}

function getRandomRound(usedRoundKeys = []) {
  const available = PLAYABLE_TEAM_PAIRS.filter((round) => !usedRoundKeys.includes(getRoundKey(round)));
  const pool = available.length > 0 ? available : PLAYABLE_TEAM_PAIRS;
  const selected = pool[Math.floor(Math.random() * pool.length)] || { teams: ["Fenerbahçe", "Galatasaray"] };
  return selected;
}

function runSelfTests() {
  console.assert(normalizeText("Mesut Özil") === normalizeText("mesut ozil"), "Turkish character normalization failed");
  console.assert(normalizeText("Hakan Şükür") === normalizeText("hakan sukur"), "Turkish s/ü normalization failed");
  console.assert(getPlayerSuggestions("xzy").length === 0, "Suggestions should be empty when there is no match");
  console.assert(getPlayableTeamPairs().length === Object.keys(ANSWER_INDEX).length, "Playable pairs must come from ANSWER_INDEX");
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



function TeamLogo({ teamName }) {
  const data = TEAM_LOGOS[teamName] || {};
  const [logoError, setLogoError] = useState(false);

  const initials = data.initials || teamName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();

  const showImage = Boolean(data.logo) && !logoError;

  return (
    <div
      className={`team-logo ${showImage ? "has-image" : "fallback"}`}
      style={{
        "--team-primary": data.primary || "#10b981",
        "--team-secondary": data.secondary || "#ffffff"
      }}
      aria-label={`${teamName} logosu`}
    >
      <div className="team-logo__ring">
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
    </div>
  );
}


function AcceptedPlayersBox({ title = "Kabul edilen oyuncular", players, actualAnswer, onReportPlayer }) {
  if (!players?.length) return null;

  const normalizedActual = normalizeText(actualAnswer);
  const otherPlayers = players.filter((player) => normalizeText(player.name) !== normalizedActual);
  const visiblePlayers = otherPlayers.length ? otherPlayers : players;

  return (
    <div className="answers-box improved">
      <strong>{title}</strong>
      <p>Bu eşleşmede kabul edilen diğer oyuncular. Hatalı olduğunu düşündüğün oyuncuyu bildirebilirsin.</p>
      <div className="answer-tags clickable">
        {visiblePlayers.slice(0, 18).map((player) => (
          <button key={player.name} type="button" onClick={() => onReportPlayer?.(player)}>
            <span>{player.name}</span>
            <em>Hatalı olabilir</em>
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
      <div className="wrong-icon">🧐</div>
      <div>
        <strong>Cevap kontrolü</strong>
        <p>{report.feedback}</p>
        <button type="button" className="light-button compact" onClick={onReport}>
          Bu cevap doğru olmalıydı
        </button>
      </div>
    </div>
  );
}

function MatchSummary({ playerNames, scores, winner, targetScore, seriesWins, matchHistory, currentCorrectRounds = [] }) {
  if (winner === null || winner === undefined) return null;

  const currentMatch = (matchHistory || [])[Math.max((matchHistory || []).length - 1, 0)] || {};
  const correctRounds = currentCorrectRounds.length ? currentCorrectRounds : (currentMatch.correctRounds || []);
  const lastMatches = (matchHistory || []).slice(-3).reverse();

  return (
    <div className="match-summary-card final-summary">
      <h3>Maç Özeti</h3>

      <div className="summary-grid final-summary-grid">
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

      <div className="correct-rounds-summary">
        <strong>Doğru cevaplananlar</strong>
        {correctRounds.length > 0 ? (
          <div className="correct-rounds-list">
            {correctRounds.slice(0, 6).map((item, index) => (
              <div className="correct-round-item" key={`${item.teamA}-${item.teamB}-${item.answer}-${index}`}>
                <span className="round-no">#{index + 1}</span>
                <span className="round-pair">{item.teamA} - {item.teamB}</span>
                <span className="round-answer">{item.answer}</span>
                <span className="round-player">{item.playerName}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-summary">Bu maç için doğru cevap kaydı bulunamadı.</p>
        )}
      </div>

      {lastMatches.length > 1 && (
        <div className="match-history compact-history">
          {lastMatches.map((match, index) => (
            <span key={`${match.finishedAt}-${index}`}>
              {match.winnerName}: {match.score?.[0]} - {match.score?.[1]}
            </span>
          ))}
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
    // Sound is optional; ignore browser autoplay/audio errors.
  }
}

function playGameSound(soundName) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem("footballGameMuted") === "true") return;

  const soundMap = {
    ownGoal: {
      frequencies: [523.25, 659.25, 783.99, 1046.5],
      duration: 0.34,
      type: "triangle",
      volume: 0.09
    },
    opponentGoal: {
      frequencies: [392, 349.23, 293.66],
      duration: 0.34,
      type: "sawtooth",
      volume: 0.055
    },
    wrong: {
      frequencies: [180, 130],
      duration: 0.28,
      type: "square",
      volume: 0.045
    },
    matchEnd: {
      frequencies: [392, 523.25, 659.25, 783.99, 1046.5],
      duration: 0.48,
      type: "triangle",
      volume: 0.085
    },
    countdown: {
      frequencies: [440],
      duration: 0.08,
      type: "sine",
      volume: 0.035
    }
  };

  playTone(soundMap[soundName] || soundMap.countdown);
}


export default function App() {
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
  const [challengeJokerUsed, setChallengeJokerUsed] = useState(false);
  const [challengeJokerHint, setChallengeJokerHint] = useState(null);

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
    }
  }, [screen, winner]);

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
    setCorrectRounds([]);
    setLastWrongReport(null);
    setReportStatus(null);
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
    setLastWrongReport(null);
    setReportStatus(null);
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
      lastAction: null,
      seriesWins,
      matchHistory,
      correctRounds
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
      lastAction: null,
      seriesWins,
      matchHistory,
      correctRounds
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
      lastAction: null,
      seriesWins: [0, 0],
      matchHistory: [],
      correctRounds: []
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
        : `${wrongExplanation} Bu turdaki yanlış hakkını kullandın. Rakibin süre bitene kadar cevap verebilir.`
    };
    const sharedWrongMessage = {
      type: bothPlayersUsedWrong ? "error" : "info",
      text: bothPlayersUsedWrong
        ? `${wrongExplanation} İki oyuncu da yanlış hakkını kullandı. Tur bitti.`
        : `${playerNames[playerIndex] || "Rakip"} yanlış cevap verdi. Diğer oyuncunun cevap hakkı devam ediyor.`
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
      message: sharedWrongMessage,
      winner: null,
      showAnswers: bothPlayersUsedWrong,
      roundLocked: bothPlayersUsedWrong,
      roundEndsAt: bothPlayersUsedWrong ? null : roundEndsAt,
      preRoundEndsAt: null,
      wrongAttempts: newWrongAttempts,
      lastAction: { type: "wrong", playerIndex, answer: raw },
      seriesWins,
      matchHistory,
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
      lastAction: { type: "timeout" },
      seriesWins,
      matchHistory,
      correctRounds
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
    if (preRoundLeft > 0 && preRoundLeft <= ROUND_REVEAL_SECONDS && screen === "game") {
      playGameSound("countdown");
    }
  }, [preRoundLeft, screen]);

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
      lastAction: { type: "timeout" },
      seriesWins,
      matchHistory
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
    setChallengeLastWrongReport(null);
    setChallengeReportStatus(null);
    setChallengeJokerUsed(false);
    setChallengeJokerHint(null);
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
    if (challengePreRoundLeft > 0 && challengePreRoundLeft <= ROUND_REVEAL_SECONDS && screen === "challenge") {
      playGameSound("countdown");
    }
  }, [challengePreRoundLeft, screen]);

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

  const endChallenge = (reasonText, reportAnswer = null, reportRound = challengeRound) => {
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
    setChallengeLastAction({ type: "wrong", answer: reportAnswer });
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


  const useChallengeJoker = () => {
    if (challengeJokerUsed) {
      setChallengeMessage({ type: "info", text: "Joker hakkını bu challenge içinde zaten kullandın." });
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

    setChallengeJokerUsed(true);
    setChallengeJokerHint(hint);
    setChallengeMessage({ type: "info", text: `Joker kullanıldı: ${hint}` });
  };

  const revealChallengeAnswerAndEnd = () => {
    const first = challengeCorrectPlayers[0];
    const reason = first
      ? `Cevap gösterildi. Örnek doğru cevap: ${first.name}.`
      : "Cevap gösterildi ancak bu tur için kayıtlı doğru cevap bulunamadı.";

    endChallenge(reason, null, challengeRound);
    setChallengeShowAnswers(true);
    setChallengeMessage({
      type: "info",
      text: `${reason} Seri bitti. Üst üste doğru sayın: ${challengeScore}.`
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
      setChallengeLastAction({ type: "correct", answer: raw });
      setChallengeLastWrongReport(null);
      setChallengeReportStatus(null);
      setChallengeJokerHint(null);
      setChallengeMessage({ type: "success", text: `Doğru! Seri: ${nextScore}. Yeni tur 3 saniye sonra açılacak.` });
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
      opponentJoined: true,
      gameStarted: false,
      targetScore,
      scores: [0, 0],
      round: next,
      usedRoundKeys: [getRoundKey(next)],
      message: { type: "info", text: "Rövanş hazır. İki oyuncu da Oyunu Başlat'a basınca maç başlayacak." },
      winner: null,
      showAnswers: false,
      roundLocked: false,
      roundEndsAt: null,
      preRoundEndsAt: null,
      wrongAttempts: [0, 0],
      lastAction: null,
      seriesWins,
      matchHistory
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

    setStatus({ type: "success", text: "Bildirim alındı. Bu cevabı data düzeltme listesine ekledik." });
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

  return (
    <div className={`app-shell ${screen === "game" || screen === "challenge" || screen === "winner" ? "game-screen" : "home-screen"}`}>
      <style>{css}</style>

      <main className="game-container">
        <header className={`hero ${screen === "game" || screen === "challenge" || screen === "winner" ? "hero-in-game" : ""}`}>
          <div className="badge">🌍 Online Futbolcu Kapışması</div>
          <h1>İki Takım, Tek Futbolcu</h1>
          <p>
            Oda oluştur, linki arkadaşına gönder, iki kişi hazır olunca aynı anda oyuna başlayın.
          </p>
          <button type="button" onClick={toggleSound} className="sound-toggle">
            {soundEnabled ? "🔊 Ses açık" : "🔇 Ses kapalı"}
          </button>
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
              <section className="panel waiting-panel challenge-waiting">
                <div className="waiting-icon">⏱️</div>
                <h2>Takımlar hazırlanıyor</h2>
                <p>Takımlar {challengePreRoundLeft} saniye sonra görünecek.</p>
                <div className="pre-round-count">{challengePreRoundLeft}</div>
              </section>
            ) : (
              <div className={`panel challenge-panel ${challengeRoundLocked ? "challenge-ended" : challengeShowAnswers || challengeLastAction || challengeMessage || challengeJokerHint ? "challenge-feedback" : "challenge-live"}`}>
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

                <div className="challenge-tools">
                  <button type="button" className="light-button compact" onClick={useChallengeJoker} disabled={!challengeCanAnswer || challengeJokerUsed}>
                    🃏 Joker {challengeJokerUsed ? "kullanıldı" : "kullan"}
                  </button>
                  <button type="button" className="light-button compact danger" onClick={revealChallengeAnswerAndEnd} disabled={challengeIsPreRound || challengeRoundLocked}>
                    👀 Cevabı göster ve bitir
                  </button>
                </div>

                {challengeJokerHint && (
                  <div className="joker-hint">🃏 {challengeJokerHint}</div>
                )}

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
                <WrongExplanationCard
                  report={challengeLastWrongReport}
                  onReport={() =>
                    submitAnswerReport(challengeLastWrongReport, setChallengeReportStatus, () => setChallengeLastWrongReport(null))
                  }
                />
                <StatusMessage message={challengeReportStatus} />

                {challengeLastWrongReport && (
                  <div className="report-box">
                    <span>Bu cevabın doğru olduğunu düşünüyorsan bildirebilirsin.</span>
                    <button
                      type="button"
                      onClick={() => submitAnswerReport(challengeLastWrongReport, setChallengeReportStatus, () => setChallengeLastWrongReport(null))}
                      className="light-button"
                    >
                      Bu cevap doğru olmalıydı
                    </button>
                  </div>
                )}

                {challengeShowAnswers && (
                  <AcceptedPlayersBox
                    title="Bu tur için kabul edilen oyuncular"
                    players={challengeCorrectPlayers}
                    actualAnswer={challengeLastAction?.answer}
                    onReportPlayer={(player) => reportAcceptedPlayer("challenge", challengeRound, player)}
                  />
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

            <div className="series-bar">
              <span>Seri durumu</span>
              <strong>{playerNames[0]} {seriesWins[0]} - {seriesWins[1]} {playerNames[1]}</strong>
            </div>

            {screen === "winner" && winner !== null ? (
              <section className="panel winner-panel">
                <div className="trophy">🏆</div>
                <h2>Kazanan: {playerNames[winner]}</h2>
                <p>
                  Final skor: {playerNames[0]} {scores[0]} - {scores[1]} {playerNames[1]}
                </p>

                <MatchSummary
                  playerNames={playerNames}
                  scores={scores}
                  winner={winner}
                  targetScore={targetScore}
                  seriesWins={seriesWins}
                  matchHistory={matchHistory}
                  currentCorrectRounds={correctRounds}
                />

                <div className="winner-actions">
                  <button type="button" onClick={startRematch} className="primary-button big">
                    Rövanş Başlat
                  </button>
                  <button type="button" onClick={resetGame} className="light-button big">
                    Seriyi Sıfırla
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
                        : lastAction.type === "wrong"
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
                            : lastAction.type === "wrong"
                              ? "Rakip yanlış yaptı, cevap hakkı sende!"
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

                <WrongExplanationCard
                  report={lastWrongReport}
                  onReport={() => submitAnswerReport(lastWrongReport, setReportStatus, () => setLastWrongReport(null))}
                />

                <StatusMessage message={reportStatus} />

                {showAnswers && (
                  <AcceptedPlayersBox
                    title="Bu tur için kabul edilen oyuncular"
                    players={correctPlayers}
                    actualAnswer={lastAction?.answer}
                    onReportPlayer={(player) => reportAcceptedPlayer("online", round, player)}
                  />
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



.sound-toggle {
  margin: 16px auto 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.12);
  color: white;
  border-radius: 999px;
  padding: 10px 14px;
  font-weight: 850;
  cursor: pointer;
}

.sound-toggle:hover {
  background: rgba(255, 255, 255, 0.18);
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
  backdrop-filter: blur(10px);
}

.team-card span {
  display: block;
  color: #64748b;
  font-size: 14px;
  margin-bottom: 6px;
}

.team-logo {
  width: 110px;
  height: 110px;
  margin: 10px auto 14px;
  border-radius: 32px;
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.35), transparent 34%),
    linear-gradient(145deg, var(--team-primary), var(--team-secondary));
  padding: 7px;
  box-shadow:
    0 18px 34px rgba(15, 23, 42, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  position: relative;
}

.team-logo::after {
  content: "";
  position: absolute;
  inset: 7px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  pointer-events: none;
}

.team-logo__ring {
  width: 100%;
  height: 100%;
  border-radius: 26px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(241, 245, 249, 0.92));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    inset 0 2px 8px rgba(255, 255, 255, 0.6),
    inset 0 -6px 12px rgba(15, 23, 42, 0.08);
}

.team-logo__inner {
  width: 78px;
  height: 78px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 8px 18px rgba(15, 23, 42, 0.12),
    inset 0 0 0 1px rgba(15, 23, 42, 0.05);
  overflow: hidden;
  padding: 10px;
}

.team-logo.has-image .team-logo__inner {
  background: white;
}

.team-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 3px 5px rgba(15, 23, 42, 0.08));
}

.team-logo span {
  color: #0f172a;
  font-size: 24px;
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

.report-box {
  margin-top: 18px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.12);
  border-radius: 18px;
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.report-box span {
  color: #fffbeb;
  font-weight: 800;
}

.report-box button {
  white-space: nowrap;
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



.series-bar {
  margin: 0 0 18px;
  display: flex;
  justify-content: center;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  border-radius: 18px;
  padding: 12px 16px;
  background: rgba(15, 23, 42, 0.18);
  color: rgba(209, 250, 229, 0.9);
}

.series-bar strong {
  color: white;
}

.answers-box.improved p {
  margin: 7px 0 12px;
  color: rgba(209, 250, 229, 0.82);
  font-size: 14px;
}

.answer-tags.clickable button {
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: white;
  padding: 8px 10px;
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  cursor: pointer;
}

.answer-tags.clickable button:hover {
  background: rgba(16, 185, 129, 0.24);
}

.answer-tags.clickable em {
  font-size: 10px;
  color: rgba(209, 250, 229, 0.78);
  font-style: normal;
}

.wrong-explanation-card {
  margin: 14px 0;
  display: flex;
  gap: 14px;
  align-items: flex-start;
  background: rgba(251, 113, 133, 0.16);
  border: 1px solid rgba(251, 113, 133, 0.35);
  border-radius: 22px;
  padding: 15px;
  color: white;
}

.wrong-explanation-card p {
  margin: 5px 0 12px;
  color: rgba(255, 255, 255, 0.86);
}

.wrong-icon {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 24px;
}

.light-button.compact {
  padding: 9px 12px;
  min-height: auto;
}

.light-button.danger {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.45);
}

.challenge-tools {
  margin: 14px 0 0;
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.joker-hint {
  margin: 12px auto 0;
  max-width: 520px;
  border-radius: 18px;
  background: rgba(250, 204, 21, 0.18);
  border: 1px solid rgba(250, 204, 21, 0.32);
  padding: 12px 14px;
  text-align: center;
  color: #fef9c3;
  font-weight: 800;
}

.match-summary-card {
  margin: 18px auto;
  max-width: 720px;
  border-radius: 26px;
  background: rgba(15, 23, 42, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.16);
  padding: 18px;
  text-align: left;
}

.match-summary-card h3 {
  margin: 0 0 14px;
  text-align: center;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.summary-grid div {
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.12);
  padding: 12px;
  text-align: center;
}

.summary-grid span,
.match-history span {
  display: block;
  color: rgba(209, 250, 229, 0.82);
  font-size: 12px;
}

.summary-grid strong {
  display: block;
  margin-top: 4px;
  color: white;
}

.summary-line {
  margin: 14px 0 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.86);
}

.match-history {
  margin-top: 14px;
  display: grid;
  gap: 6px;
  text-align: center;
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
  .bottom-actions,
  .report-box {
    flex-direction: column;
    align-items: stretch;
  }

  .mini-button {
    margin-left: 0;
    width: 100%;
  }

  .team-logo {
    width: 88px;
    height: 88px;
    border-radius: 26px;
  }

  .team-logo::after {
    inset: 6px;
    border-radius: 20px;
  }

  .team-logo__ring {
    border-radius: 20px;
  }

  .team-logo__inner {
    width: 62px;
    height: 62px;
    border-radius: 18px;
    padding: 8px;
  }

  .team-logo span {
    font-size: 19px;
  }

  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }

  .challenge-tools {
    flex-direction: column;
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

/* v16 strict mobile app layout */
@media (max-width: 760px) {
  html,
  body,
  #root {
    width: 100%;
    min-height: 100%;
  }

  body {
    overflow-x: hidden;
  }

  .app-shell {
    padding: 8px;
  }

  .app-shell.game-screen {
    height: 100svh;
    max-height: 100svh;
    overflow: hidden;
    padding: 6px;
  }

  .game-screen .game-container {
    height: 100%;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .hero.hero-in-game {
    display: none;
  }

  .game-screen .game-area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow: hidden;
  }

  .game-screen .online-bar {
    flex: 0 0 auto;
    position: static;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 3px;
    padding: 4px;
    border-radius: 12px;
  }

  .game-screen .online-bar span {
    min-width: 0;
    padding: 4px 5px;
    border-radius: 9px;
    font-size: 9.5px;
    line-height: 1.1;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .game-screen .online-bar span:nth-child(2),
  .game-screen .online-bar span:nth-child(3) {
    display: none;
  }

  .game-screen .online-bar .mini-button {
    display: none;
  }

  .game-screen .score-grid {
    flex: 0 0 auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }

  .game-screen .score-card {
    border-radius: 12px;
    padding: 5px 7px;
  }

  .game-screen .score-card span {
    font-size: 10px;
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .game-screen .score-card strong {
    font-size: 21px;
    line-height: 1;
    margin-top: 1px;
  }

  .game-screen .score-card em {
    display: none;
  }

  .game-screen .series-bar {
    flex: 0 0 auto;
    margin: 0;
    padding: 4px 7px;
    border-radius: 11px;
    font-size: 10.5px;
    line-height: 1.1;
  }

  .game-screen .series-bar span {
    display: none;
  }

  .game-screen .panel {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 7px;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
  }

  .game-screen .waiting-panel {
    justify-content: center;
    text-align: center;
  }

  .game-screen .waiting-panel h2 {
    margin: 6px 0;
    font-size: 20px;
  }

  .game-screen .waiting-panel p {
    margin: 4px 0;
    font-size: 12px;
  }

  .game-screen .top-row {
    flex: 0 0 auto;
    margin: 0;
    gap: 5px;
    align-items: center;
  }

  .game-screen .round-pill {
    padding: 4px 7px;
    border-radius: 999px;
    font-size: 10px;
  }

  .game-screen .timer-box {
    flex: 0 0 auto;
    margin: 3px auto 0;
    padding: 4px 8px;
    max-width: 110px;
    border-radius: 12px;
  }

  .game-screen .timer-box span,
  .game-screen .timer-box em {
    display: none;
  }

  .game-screen .timer-box strong {
    font-size: 22px;
    line-height: 1;
  }

  .game-screen .challenge-tools {
    flex: 0 0 auto;
    margin: 5px 0 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }

  .game-screen .challenge-tools .light-button {
    min-height: 32px;
    padding: 5px 6px;
    border-radius: 10px;
    font-size: 10px;
  }

  .game-screen .joker-hint {
    flex: 0 0 auto;
    margin: 4px 0 0;
    padding: 5px 7px;
    border-radius: 10px;
    font-size: 10px;
  }

  .game-screen .teams-grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr);
    align-items: stretch;
    gap: 5px;
    margin: 5px 0;
  }

  .game-screen .team-card {
    min-width: 0;
    border-radius: 14px;
    padding: 5px 4px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .game-screen .team-card span {
    font-size: 9px;
    line-height: 1;
    margin-bottom: 2px;
  }

  .game-screen .team-logo {
    width: clamp(42px, 13vw, 58px);
    height: clamp(42px, 13vw, 58px);
    margin: 2px auto 5px;
    border-radius: 16px;
    padding: 4px;
  }

  .game-screen .team-logo::after {
    inset: 4px;
    border-radius: 12px;
  }

  .game-screen .team-logo__ring {
    border-radius: 12px;
  }

  .game-screen .team-logo__inner {
    width: clamp(31px, 9.8vw, 44px);
    height: clamp(31px, 9.8vw, 44px);
    border-radius: 10px;
    padding: 4px;
  }

  .game-screen .team-logo span {
    font-size: 12px;
  }

  .game-screen .team-card strong {
    font-size: clamp(12px, 4.2vw, 16px);
    line-height: 1.05;
    letter-spacing: -0.02em;
    word-break: break-word;
  }

  .game-screen .versus {
    align-self: center;
    text-align: center;
    font-size: 12px;
    padding: 0;
  }

  .game-screen .single-answer-card {
    flex: 0 0 auto;
    padding: 6px;
    border-radius: 13px;
  }

  .game-screen .single-answer-card label {
    display: none;
  }

  .game-screen .wrong-right-info {
    margin: 0 0 4px;
    padding: 4px 6px;
    font-size: 10px;
    border-radius: 9px;
  }

  .game-screen .answer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 78px;
    gap: 5px;
    align-items: stretch;
  }

  .game-screen .single-answer-card input {
    min-height: 38px;
    height: 38px;
    border-radius: 11px;
    padding: 8px 10px;
    font-size: 16px;
  }

  .game-screen .answer-row .primary-button {
    width: auto;
    min-width: 0;
    min-height: 38px;
    height: 38px;
    padding: 6px 7px;
    border-radius: 11px;
    font-size: 11.5px;
  }

  .game-screen .suggestions {
    bottom: 45px;
    top: auto;
    margin-top: 0;
    max-height: 132px;
    border-radius: 12px;
  }

  .game-screen .suggestions button {
    padding: 8px 10px;
    font-size: 12px;
  }

  .game-screen .status-message {
    flex: 0 0 auto;
    margin-top: 4px;
    padding: 5px 7px;
    border-radius: 10px;
    font-size: 10.5px;
    line-height: 1.15;
  }

  .game-screen .wrong-explanation-card,
  .game-screen .answers-box,
  .game-screen .match-summary-card {
    flex: 0 1 auto;
    margin-top: 5px;
    padding: 7px;
    border-radius: 12px;
    max-height: 96px;
    overflow: auto;
    font-size: 10.5px;
  }

  .game-screen .wrong-explanation-card p,
  .game-screen .answers-box p,
  .game-screen .summary-line,
  .game-screen .match-history {
    display: none;
  }

  .game-screen .wrong-icon {
    width: 30px;
    height: 30px;
    flex-basis: 30px;
    border-radius: 10px;
    font-size: 16px;
  }

  .game-screen .answer-tags {
    gap: 4px;
  }

  .game-screen .answer-tags span,
  .game-screen .answer-tags.clickable button {
    padding: 4px 6px;
    border-radius: 999px;
    font-size: 10px;
  }

  .game-screen .answer-tags.clickable em {
    display: none;
  }

  .game-screen .bottom-actions {
    flex: 0 0 auto;
    margin-top: 5px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }

  .game-screen .bottom-actions .light-button {
    min-height: 34px;
    padding: 5px;
    border-radius: 10px;
    font-size: 10px;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    flex: 0 0 auto;
    margin: 4px 0;
    padding: 5px;
    border-radius: 12px;
    min-height: 42px;
  }

  .game-screen .goal-scene {
    max-width: 150px;
  }

  .game-screen .pre-round-count {
    width: 74px;
    height: 74px;
    font-size: 42px;
    margin: 8px auto;
  }

  .game-screen .winner-panel {
    justify-content: center;
    text-align: center;
  }

  .game-screen .winner-panel .trophy {
    font-size: 34px;
  }

  .game-screen .winner-panel h2 {
    margin: 4px 0;
    font-size: 22px;
  }

  .game-screen .winner-panel p {
    margin: 3px 0;
    font-size: 12px;
  }

  .game-screen .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }

  .game-screen .summary-grid div {
    padding: 6px;
    border-radius: 10px;
  }

  .game-screen .summary-grid span {
    font-size: 9px;
  }

  .game-screen .summary-grid strong {
    font-size: 12px;
  }

  .game-screen .winner-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 8px;
  }

  .game-screen .winner-actions .primary-button,
  .game-screen .winner-actions .light-button {
    min-height: 38px;
    padding: 6px;
    border-radius: 11px;
    font-size: 11px;
  }

  .home-screen .hero h1 {
    font-size: 28px;
  }

  .home-screen .hero p {
    display: none;
  }

  .home-screen .panel {
    padding: 14px;
  }

  .home-screen .mode-grid {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .home-screen .mode-card {
    padding: 12px;
    border-radius: 16px;
  }

  .home-screen .mode-card small {
    display: none;
  }

  .home-screen .room-actions {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
}

@media (max-width: 390px) {
  .game-screen .online-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .game-screen .online-bar span:nth-child(4) {
    display: none;
  }

  .game-screen .score-card strong {
    font-size: 19px;
  }

  .game-screen .team-logo {
    width: 42px;
    height: 42px;
  }

  .game-screen .team-logo__inner {
    width: 31px;
    height: 31px;
  }

  .game-screen .team-card strong {
    font-size: 12px;
  }

  .game-screen .answer-row {
    grid-template-columns: minmax(0, 1fr) 68px;
  }

  .game-screen .answer-row .primary-button {
    font-size: 10.5px;
  }
}

@media (max-height: 690px) and (max-width: 760px) {
  .game-screen .online-bar {
    display: none;
  }

  .game-screen .series-bar {
    display: none;
  }

  .game-screen .timer-box {
    display: none;
  }

  .game-screen .team-card {
    padding: 4px;
  }

  .game-screen .team-logo {
    width: 40px;
    height: 40px;
    margin-bottom: 3px;
  }

  .game-screen .team-logo__inner {
    width: 30px;
    height: 30px;
  }

  .game-screen .single-answer-card input,
  .game-screen .answer-row .primary-button {
    height: 36px;
    min-height: 36px;
  }

  .game-screen .status-message,
  .game-screen .wrong-explanation-card,
  .game-screen .answers-box {
    max-height: 70px;
  }
}




/* v19 FIX: team cards must NOT stretch. Mobile active game fits one screen. */
@media (max-width: 760px) {
  .app-shell.game-screen {
    height: 100svh !important;
    max-height: 100svh !important;
    overflow: hidden !important;
    padding: 4px !important;
  }

  .game-screen .game-container,
  .game-screen .game-area {
    height: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
  }

  .game-screen .online-bar,
  .game-screen .series-bar {
    display: none !important;
  }

  .game-screen .score-grid {
    flex: 0 0 44px !important;
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
    margin: 0 !important;
    gap: 5px !important;
  }

  .game-screen .score-card {
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
    padding: 5px 8px !important;
  }

  .game-screen .score-card strong {
    font-size: 24px !important;
  }

  .game-screen .panel {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    overflow: hidden !important;
    padding: 6px !important;
    gap: 5px !important;
  }

  .game-screen .top-row {
    flex: 0 0 36px !important;
    height: 36px !important;
    min-height: 36px !important;
    max-height: 36px !important;
    margin: 0 !important;
    justify-content: center !important;
  }

  .game-screen .top-row .light-button {
    min-height: 32px !important;
    height: 32px !important;
    padding: 5px 12px !important;
    font-size: 13px !important;
    border-radius: 14px !important;
  }

  .game-screen .round-pill {
    min-height: 28px !important;
    height: 28px !important;
    padding: 5px 10px !important;
    font-size: 11px !important;
  }

  .game-screen .timer-box {
    flex: 0 0 30px !important;
    height: 30px !important;
    min-height: 30px !important;
    max-height: 30px !important;
    margin: 0 auto !important;
    padding: 4px 8px !important;
  }

  .game-screen .timer-box strong {
    font-size: 20px !important;
  }

  .game-screen .teams-grid {
    flex: 0 0 104px !important;
    height: 104px !important;
    min-height: 104px !important;
    max-height: 104px !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr) !important;
    align-items: center !important;
    gap: 6px !important;
    margin: 2px 0 !important;
    overflow: hidden !important;
  }

  .game-screen .team-card {
    height: 96px !important;
    min-height: 96px !important;
    max-height: 96px !important;
    width: 100% !important;
    padding: 7px 5px !important;
    border-radius: 18px !important;
    display: grid !important;
    grid-template-rows: 12px 36px 1fr !important;
    justify-items: center !important;
    align-items: center !important;
    justify-content: initial !important;
    overflow: hidden !important;
  }

  .game-screen .team-card span {
    font-size: 9px !important;
    line-height: 1 !important;
    margin: 0 !important;
  }

  .game-screen .team-logo {
    width: 34px !important;
    height: 34px !important;
    min-width: 34px !important;
    min-height: 34px !important;
    margin: 0 !important;
    padding: 2px !important;
    border-radius: 12px !important;
  }

  .game-screen .team-logo::after {
    display: none !important;
  }

  .game-screen .team-logo__ring {
    border-radius: 10px !important;
  }

  .game-screen .team-logo__inner {
    width: 27px !important;
    height: 27px !important;
    padding: 2px !important;
    border-radius: 9px !important;
  }

  .game-screen .team-card strong {
    font-size: 14px !important;
    line-height: 1.05 !important;
    max-width: 100% !important;
    text-align: center !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
  }

  .game-screen .versus {
    align-self: center !important;
    font-size: 12px !important;
    padding: 0 !important;
  }

  .game-screen .single-answer-card {
    flex: 0 0 auto !important;
    padding: 7px !important;
    margin: 0 !important;
    border-radius: 15px !important;
  }

  .game-screen .answer-row {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 82px !important;
    gap: 6px !important;
  }

  .game-screen .single-answer-card input,
  .game-screen .answer-row .primary-button {
    height: 42px !important;
    min-height: 42px !important;
  }

  .game-screen .answer-row .primary-button {
    width: 82px !important;
    min-width: 82px !important;
    padding: 6px !important;
    font-size: 12px !important;
  }

  .game-screen .bottom-actions {
    flex: 0 0 38px !important;
    height: 38px !important;
    min-height: 38px !important;
    max-height: 38px !important;
    margin: 0 !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 6px !important;
  }

  .game-screen .bottom-actions .light-button {
    height: 38px !important;
    min-height: 38px !important;
    padding: 5px !important;
    font-size: 11px !important;
    border-radius: 13px !important;
  }

  .game-screen .status-message,
  .game-screen .wrong-explanation-card,
  .game-screen .answers-box,
  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    flex: 0 1 auto !important;
    max-height: 76px !important;
    overflow: auto !important;
    margin: 0 !important;
    padding: 7px !important;
    font-size: 11px !important;
  }
}

@media (max-width: 760px) and (max-height: 720px) {
  .game-screen .score-grid {
    display: none !important;
  }

  .game-screen .teams-grid {
    flex-basis: 88px !important;
    height: 88px !important;
    min-height: 88px !important;
    max-height: 88px !important;
  }

  .game-screen .team-card {
    height: 82px !important;
    min-height: 82px !important;
    max-height: 82px !important;
    grid-template-rows: 10px 28px 1fr !important;
    padding: 5px !important;
  }

  .game-screen .team-logo {
    width: 27px !important;
    height: 27px !important;
  }

  .game-screen .team-logo__inner {
    width: 21px !important;
    height: 21px !important;
  }

  .game-screen .team-card strong {
    font-size: 12px !important;
  }

  .game-screen .top-row,
  .game-screen .timer-box {
    display: none !important;
  }
}



/* v20 balanced mobile layout: use the screen without giant cards */
@media (max-width: 760px) {
  .app-shell {
    min-height: 100svh !important;
    padding: 6px !important;
    overflow-x: hidden !important;
  }

  .game-container {
    max-width: 100% !important;
  }

  /* Home screen fits in one mobile viewport */
  .home-screen .app-shell,
  .app-shell.home-screen {
    min-height: 100svh !important;
    max-height: 100svh !important;
    overflow: hidden !important;
  }

  .hero:not(.game-screen .hero) {
    margin-bottom: 8px !important;
  }

  .badge {
    font-size: 11px !important;
    padding: 6px 10px !important;
    margin-bottom: 6px !important;
  }

  .hero h1 {
    font-size: 25px !important;
    line-height: 1.02 !important;
  }

  .hero p {
    display: none !important;
  }

  .sound-toggle {
    margin-top: 7px !important;
    padding: 7px 10px !important;
    font-size: 12px !important;
  }

  .mode-grid {
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
  }

  .mode-card {
    min-height: 92px !important;
    padding: 12px 8px !important;
    border-radius: 18px !important;
  }

  .mode-card span {
    font-size: 24px !important;
    margin-bottom: 5px !important;
  }

  .mode-card strong {
    font-size: 14px !important;
    line-height: 1.12 !important;
  }

  .mode-card small {
    display: none !important;
  }

  .input-card,
  .score-select-box,
  .room-card {
    padding: 11px !important;
    border-radius: 16px !important;
    margin-top: 8px !important;
  }

  .input-card label,
  .score-select-box label {
    font-size: 12px !important;
    margin-bottom: 5px !important;
  }

  .input-card input,
  .join-box input {
    min-height: 42px !important;
    padding: 10px 12px !important;
    font-size: 16px !important;
    border-radius: 12px !important;
  }

  .score-options {
    gap: 6px !important;
  }

  .score-options button {
    min-height: 38px !important;
    padding: 7px !important;
    border-radius: 12px !important;
    font-size: 13px !important;
  }

  .room-actions {
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
  }

  .room-actions .primary-button,
  .room-actions .light-button {
    min-height: 42px !important;
    padding: 8px !important;
    font-size: 12px !important;
    border-radius: 14px !important;
  }

  /* Active game screen */
  .app-shell.game-screen {
    min-height: 100svh !important;
    height: 100svh !important;
    max-height: 100svh !important;
    overflow: hidden !important;
    padding: 6px !important;
  }

  .game-screen .game-container,
  .game-screen .game-area {
    height: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
  }

  .game-screen .game-area {
    display: grid !important;
    grid-template-rows: auto 1fr !important;
    gap: 7px !important;
  }

  .game-screen .online-bar,
  .game-screen .series-bar,
  .game-screen .hero {
    display: none !important;
  }

  .game-screen .score-grid {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 6px !important;
    height: 54px !important;
    min-height: 54px !important;
    max-height: 54px !important;
    margin: 0 !important;
  }

  .game-screen .score-card {
    height: 54px !important;
    min-height: 54px !important;
    max-height: 54px !important;
    padding: 7px 8px !important;
    border-radius: 16px !important;
  }

  .game-screen .score-card span {
    font-size: 11px !important;
  }

  .game-screen .score-card strong {
    font-size: 28px !important;
    line-height: 1 !important;
  }

  .game-screen .score-card em {
    display: none !important;
  }

  .game-screen .panel {
    height: 100% !important;
    min-height: 0 !important;
    overflow: hidden !important;
    padding: 8px !important;
    border-radius: 18px !important;
    display: grid !important;
    grid-template-rows: auto auto auto auto auto auto !important;
    align-content: start !important;
    gap: 8px !important;
  }

  .game-screen .top-row {
    height: 42px !important;
    min-height: 42px !important;
    max-height: 42px !important;
    margin: 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
  }

  .game-screen .top-row .light-button {
    min-height: 38px !important;
    height: 38px !important;
    padding: 7px 16px !important;
    border-radius: 16px !important;
    font-size: 14px !important;
  }

  .game-screen .round-pill {
    min-height: 34px !important;
    height: 34px !important;
    padding: 7px 12px !important;
    font-size: 13px !important;
  }

  .game-screen .timer-box {
    height: 34px !important;
    min-height: 34px !important;
    max-height: 34px !important;
    max-width: 132px !important;
    padding: 5px 10px !important;
    border-radius: 14px !important;
    margin: 0 auto !important;
  }

  .game-screen .timer-box span,
  .game-screen .timer-box em {
    display: none !important;
  }

  .game-screen .timer-box strong {
    font-size: 23px !important;
    line-height: 1 !important;
  }

  .game-screen .teams-grid {
    height: 154px !important;
    min-height: 154px !important;
    max-height: 154px !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 30px minmax(0, 1fr) !important;
    gap: 7px !important;
    align-items: center !important;
    margin: 0 !important;
    overflow: hidden !important;
  }

  .game-screen .team-card {
    height: 146px !important;
    min-height: 146px !important;
    max-height: 146px !important;
    width: 100% !important;
    padding: 10px 7px !important;
    border-radius: 20px !important;
    display: grid !important;
    grid-template-rows: 15px 56px 1fr !important;
    justify-items: center !important;
    align-items: center !important;
    overflow: hidden !important;
    background: rgba(255, 255, 255, 0.96) !important;
  }

  .game-screen .team-card span {
    font-size: 11px !important;
    line-height: 1 !important;
    margin: 0 !important;
  }

  .game-screen .team-logo {
    width: 54px !important;
    height: 54px !important;
    min-width: 54px !important;
    min-height: 54px !important;
    margin: 0 !important;
    padding: 4px !important;
    border-radius: 16px !important;
    box-shadow: 0 8px 14px rgba(15, 23, 42, 0.12) !important;
  }

  .game-screen .team-logo::after {
    display: none !important;
  }

  .game-screen .team-logo__ring {
    border-radius: 13px !important;
  }

  .game-screen .team-logo__inner {
    width: 43px !important;
    height: 43px !important;
    padding: 4px !important;
    border-radius: 12px !important;
  }

  .game-screen .team-logo span {
    font-size: 14px !important;
  }

  .game-screen .team-card strong {
    font-size: 20px !important;
    line-height: 1.08 !important;
    max-width: 100% !important;
    text-align: center !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
  }

  .game-screen .versus {
    align-self: center !important;
    font-size: 14px !important;
    font-weight: 950 !important;
    padding: 0 !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    height: 78px !important;
    min-height: 78px !important;
    max-height: 78px !important;
    margin: 0 !important;
    padding: 8px !important;
    border-radius: 16px !important;
  }

  .game-screen .single-answer-card {
    padding: 9px !important;
    border-radius: 17px !important;
    margin: 0 !important;
  }

  .game-screen .single-answer-card label {
    display: none !important;
  }

  .game-screen .wrong-right-info {
    font-size: 11px !important;
    padding: 5px 8px !important;
    margin: 0 0 6px !important;
  }

  .game-screen .answer-row {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 88px !important;
    gap: 7px !important;
    align-items: stretch !important;
  }

  .game-screen .single-answer-card input {
    height: 46px !important;
    min-height: 46px !important;
    padding: 10px 12px !important;
    border-radius: 14px !important;
    font-size: 16px !important;
  }

  .game-screen .answer-row .primary-button {
    width: 88px !important;
    min-width: 88px !important;
    height: 46px !important;
    min-height: 46px !important;
    padding: 7px !important;
    border-radius: 14px !important;
    font-size: 12px !important;
  }

  .game-screen .status-message {
    max-height: 50px !important;
    min-height: 38px !important;
    margin: 0 !important;
    padding: 8px 10px !important;
    border-radius: 15px !important;
    font-size: 12px !important;
    overflow: hidden !important;
  }

  .game-screen .answers-box {
    max-height: 82px !important;
    min-height: 66px !important;
    margin: 0 !important;
    padding: 9px !important;
    border-radius: 16px !important;
    overflow: auto !important;
  }

  .game-screen .answers-box p {
    display: none !important;
  }

  .game-screen .answer-tags {
    gap: 6px !important;
  }

  .game-screen .answer-tags span,
  .game-screen .answer-tags.clickable button {
    padding: 6px 8px !important;
    font-size: 11px !important;
  }

  .game-screen .bottom-actions {
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
    margin: 0 !important;
  }

  .game-screen .bottom-actions .light-button {
    height: 44px !important;
    min-height: 44px !important;
    padding: 7px !important;
    border-radius: 15px !important;
    font-size: 12px !important;
  }
}

@media (max-width: 760px) and (max-height: 720px) {
  .game-screen .score-grid {
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
  }

  .game-screen .score-card {
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
    padding: 5px !important;
  }

  .game-screen .score-card strong {
    font-size: 23px !important;
  }

  .game-screen .top-row {
    display: none !important;
  }

  .game-screen .teams-grid {
    height: 124px !important;
    min-height: 124px !important;
    max-height: 124px !important;
  }

  .game-screen .team-card {
    height: 118px !important;
    min-height: 118px !important;
    max-height: 118px !important;
    grid-template-rows: 12px 42px 1fr !important;
  }

  .game-screen .team-logo {
    width: 42px !important;
    height: 42px !important;
  }

  .game-screen .team-logo__inner {
    width: 32px !important;
    height: 32px !important;
  }

  .game-screen .team-card strong {
    font-size: 16px !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    height: 58px !important;
    min-height: 58px !important;
    max-height: 58px !important;
  }

  .game-screen .answers-box {
    max-height: 64px !important;
    min-height: 52px !important;
  }
}



/* v21 mobile polish: fix team label/logo overlap and expand accepted answers area */
@media (max-width: 760px) {
  .game-screen .panel {
    grid-template-rows: auto auto auto auto auto auto !important;
    align-content: start !important;
    gap: 9px !important;
  }

  .game-screen .teams-grid {
    height: 170px !important;
    min-height: 170px !important;
    max-height: 170px !important;
    grid-template-columns: minmax(0, 1fr) 30px minmax(0, 1fr) !important;
    gap: 8px !important;
    margin: 0 !important;
  }

  .game-screen .team-card {
    height: 162px !important;
    min-height: 162px !important;
    max-height: 162px !important;
    padding: 11px 8px 10px !important;
    border-radius: 22px !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: center !important;
    align-items: center !important;
    gap: 7px !important;
    overflow: hidden !important;
  }

  .game-screen .team-card > span {
    order: 1 !important;
    font-size: 11px !important;
    line-height: 1 !important;
    margin: 0 !important;
    min-height: 12px !important;
    color: #64748b !important;
  }

  .game-screen .team-logo {
    order: 2 !important;
    width: 58px !important;
    height: 58px !important;
    min-width: 58px !important;
    min-height: 58px !important;
    margin: 0 !important;
    padding: 4px !important;
    border-radius: 18px !important;
    flex: 0 0 auto !important;
  }

  .game-screen .team-logo__ring {
    border-radius: 14px !important;
  }

  .game-screen .team-logo__inner {
    width: 46px !important;
    height: 46px !important;
    padding: 4px !important;
    border-radius: 13px !important;
  }

  .game-screen .team-card strong {
    order: 3 !important;
    font-size: 20px !important;
    line-height: 1.08 !important;
    max-width: 100% !important;
    min-height: 42px !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
    text-align: center !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    height: 68px !important;
    min-height: 68px !important;
    max-height: 68px !important;
    padding: 7px !important;
  }

  .game-screen .single-answer-card {
    padding: 8px !important;
  }

  .game-screen .status-message {
    min-height: 38px !important;
    max-height: 46px !important;
  }

  .game-screen .answers-box {
    min-height: 118px !important;
    max-height: 150px !important;
    height: 132px !important;
    overflow-y: auto !important;
    padding: 10px !important;
    border-radius: 18px !important;
  }

  .game-screen .answers-box strong {
    display: block !important;
    margin-bottom: 8px !important;
    font-size: 13px !important;
  }

  .game-screen .answer-tags {
    display: flex !important;
    flex-wrap: wrap !important;
    align-content: flex-start !important;
    gap: 7px !important;
    padding-bottom: 4px !important;
  }

  .game-screen .answer-tags span,
  .game-screen .answer-tags.clickable button {
    padding: 7px 10px !important;
    font-size: 12px !important;
    border-radius: 999px !important;
  }

  .game-screen .bottom-actions {
    height: 46px !important;
    min-height: 46px !important;
    max-height: 46px !important;
  }

  .game-screen .bottom-actions .light-button {
    height: 46px !important;
    min-height: 46px !important;
    font-size: 12px !important;
  }
}

@media (max-width: 760px) and (max-height: 720px) {
  .game-screen .teams-grid {
    height: 140px !important;
    min-height: 140px !important;
    max-height: 140px !important;
  }

  .game-screen .team-card {
    height: 134px !important;
    min-height: 134px !important;
    max-height: 134px !important;
    gap: 5px !important;
  }

  .game-screen .team-logo {
    width: 44px !important;
    height: 44px !important;
    min-width: 44px !important;
    min-height: 44px !important;
  }

  .game-screen .team-logo__inner {
    width: 34px !important;
    height: 34px !important;
  }

  .game-screen .team-card strong {
    font-size: 17px !important;
    min-height: 36px !important;
  }

  .game-screen .answers-box {
    min-height: 88px !important;
    height: 96px !important;
    max-height: 108px !important;
  }
}



/* v22 desktop + mobile summary polish */
@media (min-width: 761px) {
  .app-shell {
    padding: 16px 14px !important;
  }

  .game-container {
    max-width: 980px !important;
  }

  .hero {
    margin-bottom: 14px !important;
  }

  .hero h1 {
    font-size: clamp(30px, 4.2vw, 46px) !important;
  }

  .hero p {
    margin-top: 8px !important;
    line-height: 1.35 !important;
  }

  .panel {
    padding: 18px !important;
    border-radius: 24px !important;
  }

  .mode-grid {
    gap: 14px !important;
  }

  .mode-card {
    padding: 18px !important;
    min-height: 150px !important;
  }

  .input-card,
  .single-answer-card,
  .score-select-box {
    padding: 12px !important;
  }

  .online-bar {
    padding: 8px !important;
  }

  .score-card {
    padding: 12px !important;
  }

  .teams-grid {
    margin: 12px 0 !important;
  }

  .team-card {
    padding: 16px 12px !important;
  }

  .team-logo {
    width: 86px !important;
    height: 86px !important;
  }

  .team-logo__inner {
    width: 62px !important;
    height: 62px !important;
  }

  .bottom-actions {
    margin-top: 10px !important;
  }

  .match-summary-card {
    max-width: 820px !important;
    width: 100% !important;
    margin: 14px auto !important;
    padding: 16px !important;
  }
}

.match-summary-card {
  width: min(100%, 820px) !important;
  overflow: visible !important;
}

.correct-rounds-summary {
  margin-top: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.1);
  padding: 12px;
}

.correct-rounds-summary > strong {
  display: block;
  text-align: center;
  margin-bottom: 10px;
}

.correct-rounds-list {
  display: grid;
  gap: 7px;
}

.correct-round-item {
  display: grid;
  grid-template-columns: 38px 1.4fr 1fr 0.9fr;
  gap: 8px;
  align-items: center;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.12);
  padding: 9px 10px;
}

.round-no {
  color: #bbf7d0;
  font-weight: 950;
}

.round-pair {
  color: white;
  font-weight: 850;
}

.round-answer {
  color: #d1fae5;
  font-weight: 950;
}

.round-player {
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  text-align: right;
}

@media (max-width: 760px) {
  .app-shell.home-screen {
    min-height: 100svh !important;
    max-height: 100svh !important;
    overflow: hidden !important;
    padding: 8px !important;
  }

  .home-screen .hero {
    display: block !important;
    margin-bottom: 8px !important;
  }

  .home-screen .badge {
    font-size: 11px !important;
    padding: 5px 9px !important;
    margin-bottom: 5px !important;
  }

  .home-screen .hero h1 {
    font-size: 24px !important;
  }

  .home-screen .hero p {
    display: none !important;
  }

  .home-screen .sound-toggle {
    margin-top: 6px !important;
    padding: 7px 10px !important;
    font-size: 12px !important;
  }

  .home-screen .panel {
    padding: 10px !important;
    border-radius: 18px !important;
  }

  .home-screen .mode-grid {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
  }

  .home-screen .mode-card {
    min-height: 86px !important;
    padding: 10px 8px !important;
    border-radius: 16px !important;
  }

  .home-screen .mode-card span {
    font-size: 22px !important;
    margin-bottom: 4px !important;
  }

  .home-screen .mode-card strong {
    font-size: 13px !important;
    line-height: 1.12 !important;
  }

  .home-screen .mode-card small {
    display: none !important;
  }

  .home-screen .input-card,
  .home-screen .score-select-box {
    margin-top: 8px !important;
    padding: 9px !important;
    border-radius: 15px !important;
  }

  .home-screen .input-card label,
  .home-screen .score-select-box label {
    font-size: 11px !important;
    margin-bottom: 5px !important;
  }

  .home-screen .input-card input {
    height: 40px !important;
    min-height: 40px !important;
    padding: 8px 10px !important;
    font-size: 16px !important;
  }

  .home-screen .score-options {
    gap: 6px !important;
  }

  .home-screen .score-option {
    min-height: 36px !important;
    padding: 6px !important;
    font-size: 13px !important;
  }

  .home-screen .room-actions {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
  }

  .home-screen .room-actions .primary-button,
  .home-screen .room-actions .light-button {
    min-height: 42px !important;
    padding: 7px !important;
    font-size: 12px !important;
  }

  .winner-panel {
    justify-content: start !important;
    gap: 8px !important;
  }

  .winner-panel .trophy {
    width: 92px !important;
    height: 92px !important;
    font-size: 40px !important;
    margin: 8px auto 4px !important;
  }

  .winner-panel h2 {
    font-size: 25px !important;
    margin: 4px 0 !important;
  }

  .winner-panel p {
    margin: 4px 0 !important;
    font-size: 14px !important;
  }

  .match-summary-card {
    width: 100% !important;
    max-width: 100% !important;
    margin: 8px auto !important;
    padding: 10px !important;
    border-radius: 18px !important;
    overflow: visible !important;
  }

  .match-summary-card h3 {
    margin-bottom: 8px !important;
    font-size: 17px !important;
  }

  .summary-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 6px !important;
  }

  .summary-grid div {
    padding: 7px 4px !important;
    border-radius: 12px !important;
    min-width: 0 !important;
  }

  .summary-grid span {
    font-size: 9px !important;
  }

  .summary-grid strong {
    font-size: 13px !important;
    margin-top: 2px !important;
    white-space: nowrap !important;
  }

  .summary-line {
    margin: 8px 0 0 !important;
    font-size: 12px !important;
  }

  .correct-rounds-summary {
    margin-top: 8px !important;
    padding: 8px !important;
    border-radius: 14px !important;
    max-height: none !important;
    overflow: visible !important;
  }

  .correct-rounds-summary > strong {
    margin-bottom: 6px !important;
    font-size: 13px !important;
  }

  .correct-rounds-list {
    gap: 5px !important;
  }

  .correct-round-item {
    grid-template-columns: 24px 1fr auto !important;
    grid-template-areas:
      "no pair answer"
      "no player player";
    gap: 3px 6px !important;
    padding: 6px 7px !important;
    border-radius: 12px !important;
  }

  .round-no {
    grid-area: no;
    font-size: 11px !important;
  }

  .round-pair {
    grid-area: pair;
    font-size: 11px !important;
    line-height: 1.1 !important;
  }

  .round-answer {
    grid-area: answer;
    font-size: 12px !important;
    text-align: right !important;
  }

  .round-player {
    grid-area: player;
    font-size: 10px !important;
    text-align: right !important;
  }

  .match-history {
    display: none !important;
  }

  .winner-actions {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
    margin-top: 8px !important;
  }

  .winner-actions .primary-button,
  .winner-actions .light-button {
    min-height: 42px !important;
    padding: 7px !important;
    font-size: 12px !important;
  }
}



/* v23 final: true one-screen layout for mobile and desktop */
html,
body,
#root {
  min-height: 100%;
}

@media (min-width: 761px) {
  .app-shell {
    min-height: 100vh !important;
    height: 100vh !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    padding: 14px !important;
  }

  .game-container {
    height: 100% !important;
    max-width: 1080px !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }

  .hero {
    flex: 0 0 auto !important;
    margin-bottom: 10px !important;
  }

  .hero h1 {
    font-size: clamp(28px, 3.2vw, 40px) !important;
  }

  .hero p {
    margin-top: 6px !important;
    line-height: 1.25 !important;
    font-size: 14px !important;
  }

  .panel {
    padding: 16px !important;
    border-radius: 22px !important;
  }

  .game-area {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    display: grid !important;
    grid-template-rows: auto auto 1fr !important;
    gap: 10px !important;
    overflow: hidden !important;
  }

  .online-bar {
    padding: 8px !important;
  }

  .score-grid {
    gap: 10px !important;
  }

  .score-card {
    padding: 10px !important;
    border-radius: 18px !important;
  }

  .score-card strong {
    font-size: 30px !important;
  }

  .teams-grid {
    margin: 10px 0 !important;
  }

  .team-card {
    padding: 14px 12px !important;
    border-radius: 20px !important;
  }

  .team-logo {
    width: 78px !important;
    height: 78px !important;
    margin-bottom: 8px !important;
  }

  .team-logo__inner {
    width: 58px !important;
    height: 58px !important;
  }

  .single-answer-card {
    padding: 11px !important;
  }

  .answer-row {
    align-items: stretch !important;
  }

  .answer-row .primary-button,
  .single-answer-card input {
    min-height: 44px !important;
  }

  .winner-panel {
    height: 100% !important;
    min-height: 0 !important;
    display: grid !important;
    grid-template-rows: auto auto auto auto auto !important;
    align-content: center !important;
    justify-items: center !important;
    gap: 10px !important;
    padding: 18px !important;
    overflow: hidden !important;
  }

  .winner-panel .trophy {
    width: 86px !important;
    height: 86px !important;
    font-size: 42px !important;
    margin: 0 !important;
  }

  .winner-panel h2 {
    font-size: 34px !important;
    margin: 0 !important;
  }

  .winner-panel > p {
    margin: 0 !important;
    font-size: 18px !important;
  }

  .match-summary-card.final-summary {
    width: min(100%, 860px) !important;
    max-width: 860px !important;
    margin: 0 auto !important;
    padding: 14px !important;
    border-radius: 20px !important;
    overflow: hidden !important;
  }

  .winner-actions {
    margin: 0 !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 10px !important;
    width: min(100%, 520px) !important;
  }

  .winner-actions .primary-button,
  .winner-actions .light-button {
    min-height: 44px !important;
    padding: 10px !important;
  }

  .home-screen .panel {
    flex: 1 1 auto !important;
    overflow: hidden !important;
  }

  .home-screen .mode-grid {
    gap: 12px !important;
  }

  .home-screen .mode-card {
    min-height: 130px !important;
    padding: 16px !important;
  }

  .home-screen .input-card,
  .home-screen .score-select-box {
    padding: 11px !important;
    margin-top: 10px !important;
  }
}

.match-summary-card.final-summary {
  box-sizing: border-box !important;
  overflow: hidden !important;
}

.final-summary h3 {
  margin: 0 0 8px !important;
}

.final-summary-grid {
  display: grid !important;
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  gap: 8px !important;
}

.final-summary-grid div {
  min-width: 0 !important;
  padding: 9px 6px !important;
  border-radius: 14px !important;
}

.final-summary-grid span {
  font-size: 11px !important;
}

.final-summary-grid strong {
  font-size: 18px !important;
  white-space: nowrap !important;
}

.correct-rounds-summary {
  margin-top: 10px !important;
  padding: 10px !important;
  border-radius: 16px !important;
  background: rgba(255, 255, 255, 0.1) !important;
}

.correct-rounds-summary > strong {
  display: block !important;
  text-align: center !important;
  margin-bottom: 7px !important;
}

.correct-rounds-list {
  display: grid !important;
  gap: 6px !important;
}

.correct-round-item {
  display: grid !important;
  grid-template-columns: 30px minmax(0, 1.35fr) minmax(0, 0.8fr) minmax(0, 0.7fr) !important;
  gap: 7px !important;
  align-items: center !important;
  padding: 7px 8px !important;
  border-radius: 12px !important;
  background: rgba(255, 255, 255, 0.12) !important;
  min-width: 0 !important;
}

.round-no,
.round-pair,
.round-answer,
.round-player {
  min-width: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.round-no {
  font-weight: 950 !important;
  color: #bbf7d0 !important;
}

.round-pair {
  font-weight: 800 !important;
  color: white !important;
}

.round-answer {
  font-weight: 950 !important;
  color: #d1fae5 !important;
}

.round-player {
  text-align: right !important;
  font-size: 12px !important;
  color: rgba(255, 255, 255, 0.74) !important;
}

.empty-summary {
  margin: 0 !important;
  text-align: center !important;
  color: rgba(255, 255, 255, 0.75) !important;
}

@media (max-width: 760px) {
  .app-shell {
    min-height: 100svh !important;
    height: 100svh !important;
    max-height: 100svh !important;
    overflow: hidden !important;
    padding: 6px !important;
  }

  .game-container {
    height: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
  }

  .winner-panel {
    height: 100% !important;
    min-height: 0 !important;
    display: grid !important;
    grid-template-rows: auto auto auto auto auto !important;
    align-content: center !important;
    justify-items: center !important;
    gap: 8px !important;
    padding: 10px !important;
    overflow: hidden !important;
    text-align: center !important;
  }

  .winner-panel .trophy {
    width: 84px !important;
    height: 84px !important;
    font-size: 38px !important;
    margin: 0 !important;
  }

  .winner-panel h2 {
    font-size: 31px !important;
    line-height: 1.05 !important;
    margin: 0 !important;
  }

  .winner-panel > p {
    margin: 0 !important;
    font-size: 14px !important;
    line-height: 1.2 !important;
  }

  .match-summary-card.final-summary {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 9px !important;
    border-radius: 18px !important;
  }

  .final-summary h3 {
    font-size: 18px !important;
    margin-bottom: 7px !important;
  }

  .final-summary-grid {
    gap: 5px !important;
  }

  .final-summary-grid div {
    padding: 7px 3px !important;
    border-radius: 12px !important;
  }

  .final-summary-grid span {
    font-size: 9px !important;
  }

  .final-summary-grid strong {
    font-size: 14px !important;
  }

  .correct-rounds-summary {
    margin-top: 8px !important;
    padding: 7px !important;
    border-radius: 14px !important;
  }

  .correct-rounds-summary > strong {
    font-size: 13px !important;
    margin-bottom: 5px !important;
  }

  .correct-rounds-list {
    gap: 4px !important;
  }

  .correct-round-item {
    grid-template-columns: 22px minmax(0, 1fr) minmax(0, 0.72fr) !important;
    grid-template-areas:
      "no pair answer"
      "no player player" !important;
    gap: 2px 5px !important;
    padding: 5px 6px !important;
    border-radius: 10px !important;
  }

  .round-no {
    grid-area: no !important;
    font-size: 10px !important;
  }

  .round-pair {
    grid-area: pair !important;
    font-size: 10px !important;
  }

  .round-answer {
    grid-area: answer !important;
    font-size: 11px !important;
    text-align: right !important;
  }

  .round-player {
    grid-area: player !important;
    font-size: 9px !important;
    text-align: right !important;
  }

  .compact-history,
  .match-history {
    display: none !important;
  }

  .winner-actions {
    width: 100% !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
    margin: 0 !important;
  }

  .winner-actions .primary-button,
  .winner-actions .light-button {
    min-height: 42px !important;
    height: 42px !important;
    padding: 7px !important;
    border-radius: 14px !important;
    font-size: 12px !important;
  }

  .home-screen .hero {
    margin-bottom: 7px !important;
  }

  .home-screen .hero h1 {
    font-size: 23px !important;
  }

  .home-screen .hero p {
    display: none !important;
  }

  .home-screen .panel {
    padding: 9px !important;
    border-radius: 18px !important;
    overflow: hidden !important;
  }

  .home-screen .mode-grid {
    grid-template-columns: 1fr 1fr !important;
    gap: 7px !important;
  }

  .home-screen .mode-card {
    min-height: 82px !important;
    padding: 9px 7px !important;
  }

  .home-screen .mode-card span {
    font-size: 21px !important;
    margin-bottom: 3px !important;
  }

  .home-screen .mode-card strong {
    font-size: 13px !important;
  }

  .home-screen .mode-card small {
    display: none !important;
  }
}

@media (max-width: 760px) and (max-height: 720px) {
  .winner-panel .trophy {
    width: 62px !important;
    height: 62px !important;
    font-size: 30px !important;
  }

  .winner-panel h2 {
    font-size: 25px !important;
  }

  .winner-panel > p {
    font-size: 12px !important;
  }

  .correct-rounds-summary {
    margin-top: 5px !important;
  }

  .correct-round-item {
    padding: 4px 5px !important;
  }

  .winner-actions .primary-button,
  .winner-actions .light-button {
    height: 38px !important;
    min-height: 38px !important;
  }
}



/* v24: desktop home must fit without scrolling */
@media (min-width: 761px) {
  .app-shell.home-screen {
    height: 100vh !important;
    min-height: 100vh !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    padding: 10px 18px !important;
  }

  .home-screen .game-container {
    height: 100% !important;
    max-width: 1120px !important;
    display: grid !important;
    grid-template-rows: auto 1fr !important;
    gap: 8px !important;
    overflow: hidden !important;
  }

  .home-screen .hero {
    margin: 0 !important;
    padding: 0 !important;
  }

  .home-screen .badge {
    padding: 5px 11px !important;
    font-size: 12px !important;
    margin-bottom: 5px !important;
  }

  .home-screen .hero h1 {
    font-size: 34px !important;
    line-height: 0.95 !important;
    margin: 0 !important;
  }

  .home-screen .hero p {
    margin: 6px auto 0 !important;
    font-size: 13px !important;
    line-height: 1.2 !important;
  }

  .home-screen .sound-toggle {
    margin-top: 7px !important;
    padding: 6px 10px !important;
    font-size: 12px !important;
  }

  .home-screen .panel {
    min-height: 0 !important;
    height: 100% !important;
    overflow: hidden !important;
    padding: 14px !important;
    border-radius: 22px !important;
    display: grid !important;
    grid-template-rows: auto auto auto 1fr !important;
    gap: 10px !important;
  }

  .home-screen .mode-grid {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 10px !important;
  }

  .home-screen .mode-card {
    min-height: 96px !important;
    padding: 13px 16px !important;
    border-radius: 18px !important;
  }

  .home-screen .mode-card span {
    font-size: 28px !important;
    margin-bottom: 5px !important;
  }

  .home-screen .mode-card strong {
    font-size: 18px !important;
    line-height: 1.05 !important;
  }

  .home-screen .mode-card small {
    font-size: 13px !important;
    line-height: 1.2 !important;
    margin-top: 6px !important;
  }

  .home-screen .input-card,
  .home-screen .score-select-box {
    margin: 0 !important;
    padding: 11px 14px !important;
    border-radius: 18px !important;
  }

  .home-screen .input-card label,
  .home-screen .score-select-box label {
    font-size: 12px !important;
    margin-bottom: 6px !important;
    text-align: center !important;
  }

  .home-screen .input-card input {
    min-height: 42px !important;
    height: 42px !important;
    padding: 8px 12px !important;
    font-size: 16px !important;
    border-radius: 13px !important;
  }

  .home-screen .score-options {
    display: flex !important;
    gap: 8px !important;
    align-items: center !important;
  }

  .home-screen .score-option {
    min-height: 40px !important;
    padding: 7px 18px !important;
    border-radius: 13px !important;
    font-size: 14px !important;
  }

  .home-screen .score-select-box p {
    margin: 6px 0 0 !important;
    font-size: 12px !important;
    line-height: 1.2 !important;
  }

  .home-screen .room-actions {
    align-self: end !important;
    display: grid !important;
    grid-template-columns: 1.2fr 1fr 1fr !important;
    gap: 10px !important;
    min-height: 50px !important;
  }

  .home-screen .room-actions .primary-button,
  .home-screen .room-actions .light-button {
    min-height: 48px !important;
    height: 48px !important;
    padding: 8px 10px !important;
    border-radius: 16px !important;
    font-size: 14px !important;
  }

  .home-screen .join-box {
    display: grid !important;
    grid-template-columns: 1fr auto !important;
    gap: 8px !important;
  }

  .home-screen .join-box input {
    height: 48px !important;
    min-height: 48px !important;
    padding: 8px 12px !important;
    border-radius: 16px !important;
    font-size: 16px !important;
  }

  .home-screen .status-message {
    margin: 0 !important;
    padding: 8px 10px !important;
    min-height: 36px !important;
    max-height: 42px !important;
    overflow: hidden !important;
  }
}

/* For shorter laptop screens */
@media (min-width: 761px) and (max-height: 760px) {
  .home-screen .hero h1 {
    font-size: 28px !important;
  }

  .home-screen .hero p,
  .home-screen .mode-card small,
  .home-screen .score-select-box p {
    display: none !important;
  }

  .home-screen .sound-toggle {
    margin-top: 5px !important;
    padding: 5px 9px !important;
  }

  .home-screen .panel {
    padding: 10px !important;
    gap: 8px !important;
  }

  .home-screen .mode-card {
    min-height: 78px !important;
    padding: 10px 14px !important;
  }

  .home-screen .mode-card span {
    font-size: 23px !important;
    margin-bottom: 3px !important;
  }

  .home-screen .mode-card strong {
    font-size: 16px !important;
  }

  .home-screen .input-card,
  .home-screen .score-select-box {
    padding: 9px 12px !important;
  }

  .home-screen .input-card input,
  .home-screen .join-box input {
    height: 40px !important;
    min-height: 40px !important;
  }

  .home-screen .score-option {
    min-height: 36px !important;
    padding: 6px 14px !important;
  }

  .home-screen .room-actions .primary-button,
  .home-screen .room-actions .light-button {
    height: 42px !important;
    min-height: 42px !important;
  }
}

/* Desktop active game also tighter, but not cut */
@media (min-width: 761px) {
  .app-shell.game-screen {
    height: 100vh !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    padding: 10px 18px !important;
  }

  .game-screen .game-container {
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }

  .game-screen .hero {
    display: none !important;
  }

  .game-screen .game-area {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    overflow: hidden !important;
    display: grid !important;
    grid-template-rows: auto auto 1fr !important;
    gap: 8px !important;
  }

  .game-screen .online-bar {
    padding: 7px !important;
  }

  .game-screen .online-bar span {
    padding: 6px 9px !important;
    font-size: 12px !important;
  }

  .game-screen .score-grid {
    gap: 8px !important;
  }

  .game-screen .score-card {
    padding: 9px !important;
    border-radius: 18px !important;
  }

  .game-screen .score-card strong {
    font-size: 28px !important;
  }

  .game-screen .panel {
    min-height: 0 !important;
    overflow: hidden !important;
    padding: 12px !important;
    border-radius: 20px !important;
  }

  .game-screen .teams-grid {
    margin: 8px 0 !important;
  }

  .game-screen .team-card {
    padding: 12px !important;
  }

  .game-screen .team-logo {
    width: 72px !important;
    height: 72px !important;
  }

  .game-screen .team-logo__inner {
    width: 52px !important;
    height: 52px !important;
  }

  .game-screen .single-answer-card {
    padding: 10px !important;
  }

  .game-screen .bottom-actions {
    margin-top: 8px !important;
  }
}



/* v25: desktop active game must fit input/control in one screen */
@media (min-width: 761px) {
  .app-shell.game-screen {
    height: 100vh !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    padding: 8px 14px !important;
  }

  .game-screen .game-container {
    height: 100% !important;
    max-width: 1160px !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }

  .game-screen .hero {
    display: none !important;
  }

  .game-screen .game-area {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    height: 100% !important;
    overflow: hidden !important;
    display: grid !important;
    grid-template-rows: auto auto auto 1fr !important;
    gap: 6px !important;
  }

  .game-screen .online-bar {
    min-height: 44px !important;
    height: 44px !important;
    max-height: 44px !important;
    padding: 5px 8px !important;
    border-radius: 16px !important;
    gap: 7px !important;
    overflow: hidden !important;
  }

  .game-screen .online-bar span {
    padding: 5px 8px !important;
    font-size: 12px !important;
    white-space: nowrap !important;
  }

  .game-screen .online-bar .mini-button {
    min-height: 34px !important;
    height: 34px !important;
    padding: 5px 12px !important;
    border-radius: 13px !important;
    font-size: 13px !important;
  }

  .game-screen .score-grid {
    height: 76px !important;
    min-height: 76px !important;
    max-height: 76px !important;
    gap: 8px !important;
    margin: 0 !important;
  }

  .game-screen .score-card {
    height: 76px !important;
    min-height: 76px !important;
    max-height: 76px !important;
    padding: 8px 10px !important;
    border-radius: 18px !important;
  }

  .game-screen .score-card span {
    font-size: 13px !important;
  }

  .game-screen .score-card strong {
    font-size: 30px !important;
    line-height: 1 !important;
    margin: 2px 0 !important;
  }

  .game-screen .score-card em {
    font-size: 12px !important;
  }

  .game-screen .series-bar {
    min-height: 36px !important;
    height: 36px !important;
    max-height: 36px !important;
    margin: 0 !important;
    padding: 6px 10px !important;
    border-radius: 14px !important;
    font-size: 14px !important;
  }

  .game-screen .panel {
    min-height: 0 !important;
    height: 100% !important;
    overflow: hidden !important;
    padding: 10px !important;
    border-radius: 20px !important;
    display: grid !important;
    grid-template-rows: 42px 54px 170px auto auto auto !important;
    align-content: start !important;
    gap: 7px !important;
  }

  .game-screen .top-row {
    height: 42px !important;
    min-height: 42px !important;
    max-height: 42px !important;
    margin: 0 !important;
    display: grid !important;
    grid-template-columns: 1fr auto !important;
    align-items: center !important;
    gap: 8px !important;
  }

  .game-screen .round-pill {
    justify-self: start !important;
    min-height: 34px !important;
    height: 34px !important;
    padding: 6px 12px !important;
    font-size: 13px !important;
    border-radius: 999px !important;
  }

  .game-screen .top-row .light-button {
    justify-self: end !important;
    min-height: 36px !important;
    height: 36px !important;
    padding: 6px 13px !important;
    border-radius: 14px !important;
    font-size: 13px !important;
  }

  .game-screen .timer-box {
    height: 54px !important;
    min-height: 54px !important;
    max-height: 54px !important;
    max-width: 100% !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 6px 10px !important;
    border-radius: 16px !important;
    display: grid !important;
    grid-template-columns: 1fr auto 1fr !important;
    align-items: center !important;
  }

  .game-screen .timer-box span {
    justify-self: end !important;
    font-size: 13px !important;
  }

  .game-screen .timer-box strong {
    font-size: 34px !important;
    line-height: 1 !important;
    margin: 0 14px !important;
  }

  .game-screen .timer-box em {
    justify-self: start !important;
    font-size: 13px !important;
  }

  .game-screen .teams-grid {
    height: 170px !important;
    min-height: 170px !important;
    max-height: 170px !important;
    margin: 0 !important;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 52px minmax(0, 1fr) !important;
    gap: 8px !important;
    align-items: center !important;
    overflow: hidden !important;
  }

  .game-screen .team-card {
    height: 160px !important;
    min-height: 160px !important;
    max-height: 160px !important;
    padding: 10px 12px !important;
    border-radius: 20px !important;
    display: grid !important;
    grid-template-rows: 18px 62px 1fr !important;
    justify-items: center !important;
    align-items: center !important;
    overflow: hidden !important;
  }

  .game-screen .team-card span {
    font-size: 12px !important;
    margin: 0 !important;
    line-height: 1 !important;
  }

  .game-screen .team-logo {
    width: 58px !important;
    height: 58px !important;
    margin: 0 !important;
    padding: 4px !important;
    border-radius: 16px !important;
  }

  .game-screen .team-logo::after {
    display: none !important;
  }

  .game-screen .team-logo__ring {
    border-radius: 13px !important;
  }

  .game-screen .team-logo__inner {
    width: 46px !important;
    height: 46px !important;
    padding: 4px !important;
    border-radius: 12px !important;
  }

  .game-screen .team-card strong {
    font-size: 31px !important;
    line-height: 1.02 !important;
    max-width: 100% !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 2 !important;
    -webkit-box-orient: vertical !important;
    overflow: hidden !important;
    text-align: center !important;
  }

  .game-screen .versus {
    font-size: 26px !important;
    font-weight: 950 !important;
    text-align: center !important;
    align-self: center !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    height: 58px !important;
    min-height: 58px !important;
    max-height: 58px !important;
    margin: 0 !important;
    padding: 6px 10px !important;
    border-radius: 16px !important;
  }

  .game-screen .single-answer-card {
    min-height: 70px !important;
    padding: 9px 10px !important;
    border-radius: 17px !important;
    margin: 0 !important;
  }

  .game-screen .single-answer-card label {
    display: none !important;
  }

  .game-screen .wrong-right-info {
    margin: 0 0 6px !important;
    padding: 5px 8px !important;
    font-size: 12px !important;
  }

  .game-screen .answer-row {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 128px !important;
    gap: 8px !important;
    align-items: stretch !important;
  }

  .game-screen .single-answer-card input {
    height: 46px !important;
    min-height: 46px !important;
    padding: 10px 12px !important;
    border-radius: 14px !important;
    font-size: 16px !important;
  }

  .game-screen .answer-row .primary-button {
    height: 46px !important;
    min-height: 46px !important;
    width: 128px !important;
    min-width: 128px !important;
    padding: 8px !important;
    border-radius: 14px !important;
    font-size: 13px !important;
  }

  .game-screen .status-message {
    margin: 0 !important;
    min-height: 38px !important;
    max-height: 44px !important;
    padding: 8px 10px !important;
    border-radius: 14px !important;
    font-size: 13px !important;
    overflow: hidden !important;
  }

  .game-screen .answers-box {
    max-height: 74px !important;
    min-height: 56px !important;
    overflow: auto !important;
    margin: 0 !important;
    padding: 8px 10px !important;
    border-radius: 15px !important;
  }

  .game-screen .answers-box strong {
    font-size: 13px !important;
    margin-bottom: 5px !important;
  }

  .game-screen .answers-box p {
    display: none !important;
  }

  .game-screen .answer-tags {
    gap: 6px !important;
  }

  .game-screen .answer-tags span,
  .game-screen .answer-tags.clickable button {
    padding: 6px 8px !important;
    font-size: 12px !important;
  }

  .game-screen .bottom-actions {
    height: 42px !important;
    min-height: 42px !important;
    max-height: 42px !important;
    margin: 0 !important;
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
  }

  .game-screen .bottom-actions .light-button {
    height: 42px !important;
    min-height: 42px !important;
    padding: 7px !important;
    border-radius: 14px !important;
    font-size: 12px !important;
  }
}

@media (min-width: 761px) and (max-height: 760px) {
  .game-screen .online-bar {
    display: none !important;
  }

  .game-screen .game-area {
    grid-template-rows: auto auto 1fr !important;
  }

  .game-screen .score-grid {
    height: 56px !important;
    min-height: 56px !important;
    max-height: 56px !important;
  }

  .game-screen .score-card {
    height: 56px !important;
    min-height: 56px !important;
    max-height: 56px !important;
    padding: 5px 8px !important;
  }

  .game-screen .score-card strong {
    font-size: 24px !important;
  }

  .game-screen .score-card em {
    display: none !important;
  }

  .game-screen .series-bar {
    display: none !important;
  }

  .game-screen .panel {
    grid-template-rows: 36px 42px 132px auto auto auto !important;
    gap: 5px !important;
    padding: 8px !important;
  }

  .game-screen .top-row {
    height: 36px !important;
    min-height: 36px !important;
    max-height: 36px !important;
  }

  .game-screen .top-row .light-button,
  .game-screen .round-pill {
    height: 30px !important;
    min-height: 30px !important;
    padding: 5px 10px !important;
    font-size: 12px !important;
  }

  .game-screen .timer-box {
    height: 42px !important;
    min-height: 42px !important;
    max-height: 42px !important;
  }

  .game-screen .timer-box strong {
    font-size: 26px !important;
  }

  .game-screen .teams-grid {
    height: 132px !important;
    min-height: 132px !important;
    max-height: 132px !important;
  }

  .game-screen .team-card {
    height: 126px !important;
    min-height: 126px !important;
    max-height: 126px !important;
    grid-template-rows: 14px 46px 1fr !important;
    padding: 7px 10px !important;
  }

  .game-screen .team-logo {
    width: 42px !important;
    height: 42px !important;
  }

  .game-screen .team-logo__inner {
    width: 32px !important;
    height: 32px !important;
  }

  .game-screen .team-card strong {
    font-size: 25px !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    height: 46px !important;
    min-height: 46px !important;
    max-height: 46px !important;
  }

  .game-screen .single-answer-card {
    min-height: 60px !important;
    padding: 7px !important;
  }

  .game-screen .single-answer-card input,
  .game-screen .answer-row .primary-button {
    height: 40px !important;
    min-height: 40px !important;
  }

  .game-screen .bottom-actions,
  .game-screen .bottom-actions .light-button {
    height: 36px !important;
    min-height: 36px !important;
    max-height: 36px !important;
  }
}



/* v26 polish: fix scoreboard, animation, accepted players size, waiting text, mobile timer */

/* Desktop game screen improvements */
@media (min-width: 761px) {
  .game-screen .score-grid {
    height: 84px !important;
    min-height: 84px !important;
    max-height: 84px !important;
  }

  .game-screen .score-card {
    height: 84px !important;
    min-height: 84px !important;
    max-height: 84px !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: center !important;
    gap: 4px !important;
    padding: 10px 12px !important;
  }

  .game-screen .score-card span {
    font-size: 12px !important;
    line-height: 1.1 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    max-width: 100% !important;
  }

  .game-screen .score-card strong {
    font-size: 32px !important;
    line-height: 1 !important;
    margin: 0 !important;
  }

  .game-screen .score-card em {
    font-size: 11px !important;
    white-space: nowrap !important;
  }

  .game-screen .series-bar {
    min-height: 32px !important;
    height: 32px !important;
    max-height: 32px !important;
    font-size: 13px !important;
  }

  .game-screen .series-bar strong {
    font-size: 15px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    max-width: 100% !important;
  }

  .game-screen .panel.waiting-panel {
    justify-content: center !important;
    align-items: center !important;
    text-align: center !important;
    gap: 10px !important;
    padding: 18px !important;
  }

  .game-screen .waiting-panel h2 {
    font-size: 28px !important;
    line-height: 1.08 !important;
    margin: 0 !important;
  }

  .game-screen .waiting-panel p {
    max-width: 760px !important;
    font-size: 15px !important;
    line-height: 1.3 !important;
    margin: 0 !important;
  }

  .game-screen .room-code-large {
    font-size: 28px !important;
    line-height: 1 !important;
    padding: 10px 16px !important;
    border-radius: 16px !important;
  }

  .game-screen .ready-grid {
    width: 100% !important;
    max-width: 760px !important;
    gap: 10px !important;
  }

  .game-screen .ready-card {
    min-height: 84px !important;
    padding: 12px !important;
  }

  .game-screen .ready-card strong {
    font-size: 18px !important;
  }

  .game-screen .ready-card span {
    font-size: 13px !important;
  }

  .game-screen .panel {
    grid-template-rows: 40px 48px 146px auto auto auto !important;
    gap: 6px !important;
  }

  .game-screen .timer-box {
    height: 48px !important;
    min-height: 48px !important;
    max-height: 48px !important;
    padding: 5px 10px !important;
  }

  .game-screen .timer-box strong {
    font-size: 30px !important;
  }

  .game-screen .teams-grid {
    height: 146px !important;
    min-height: 146px !important;
    max-height: 146px !important;
  }

  .game-screen .team-card {
    height: 138px !important;
    min-height: 138px !important;
    max-height: 138px !important;
    grid-template-rows: 16px 52px 1fr !important;
  }

  .game-screen .team-logo {
    width: 50px !important;
    height: 50px !important;
  }

  .game-screen .team-logo__inner {
    width: 40px !important;
    height: 40px !important;
  }

  .game-screen .team-card strong {
    font-size: 25px !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    height: 76px !important;
    min-height: 76px !important;
    max-height: 76px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 14px !important;
    overflow: hidden !important;
    padding: 8px 14px !important;
  }

  .game-screen .goal-scene {
    width: 110px !important;
    min-width: 110px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
  }

  .game-screen .goal-animation .ball,
  .game-screen .concede-animation .ball,
  .game-screen .wrong-animation .ball {
    font-size: 32px !important;
  }

  .game-screen .goal-net {
    font-size: 34px !important;
  }

  .game-screen .goal-animation strong,
  .game-screen .concede-animation strong,
  .game-screen .wrong-animation strong,
  .game-screen .round-animation strong {
    font-size: 18px !important;
    line-height: 1.15 !important;
  }

  .game-screen .single-answer-card {
    min-height: 76px !important;
  }

  .game-screen .answers-box {
    min-height: 112px !important;
    max-height: 128px !important;
    padding: 10px 12px !important;
  }

  .game-screen .answers-box strong {
    font-size: 15px !important;
    margin-bottom: 8px !important;
  }

  .game-screen .answer-tags {
    gap: 8px !important;
  }

  .game-screen .answer-tags span,
  .game-screen .answer-tags.clickable button {
    padding: 7px 10px !important;
    font-size: 12px !important;
  }

  .game-screen .host-note {
    margin: 0 !important;
    text-align: center !important;
    font-size: 12px !important;
  }
}

/* Shorter desktop screens */
@media (min-width: 761px) and (max-height: 820px) {
  .game-screen .score-grid {
    height: 72px !important;
    min-height: 72px !important;
    max-height: 72px !important;
  }

  .game-screen .score-card {
    height: 72px !important;
    min-height: 72px !important;
    max-height: 72px !important;
    padding: 8px 10px !important;
  }

  .game-screen .score-card strong {
    font-size: 28px !important;
  }

  .game-screen .series-bar {
    min-height: 28px !important;
    height: 28px !important;
    max-height: 28px !important;
  }

  .game-screen .panel {
    grid-template-rows: 36px 42px 126px auto auto auto !important;
    gap: 5px !important;
    padding: 8px !important;
  }

  .game-screen .top-row {
    height: 36px !important;
    min-height: 36px !important;
    max-height: 36px !important;
  }

  .game-screen .round-pill,
  .game-screen .top-row .light-button {
    height: 30px !important;
    min-height: 30px !important;
    font-size: 12px !important;
    padding: 5px 10px !important;
  }

  .game-screen .timer-box {
    height: 42px !important;
    min-height: 42px !important;
    max-height: 42px !important;
  }

  .game-screen .timer-box strong {
    font-size: 25px !important;
  }

  .game-screen .teams-grid {
    height: 126px !important;
    min-height: 126px !important;
    max-height: 126px !important;
  }

  .game-screen .team-card {
    height: 118px !important;
    min-height: 118px !important;
    max-height: 118px !important;
    grid-template-rows: 14px 42px 1fr !important;
  }

  .game-screen .team-logo {
    width: 40px !important;
    height: 40px !important;
  }

  .game-screen .team-logo__inner {
    width: 30px !important;
    height: 30px !important;
  }

  .game-screen .team-card strong {
    font-size: 22px !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    height: 58px !important;
    min-height: 58px !important;
    max-height: 58px !important;
  }

  .game-screen .answers-box {
    min-height: 90px !important;
    max-height: 104px !important;
  }

  .game-screen .bottom-actions,
  .game-screen .bottom-actions .light-button {
    height: 38px !important;
    min-height: 38px !important;
  }
}

/* Mobile: timer should always be visible */
@media (max-width: 760px) {
  .game-screen .score-card span {
    font-size: 10px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }

  .game-screen .score-card strong {
    font-size: 24px !important;
  }

  .game-screen .timer-box {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 8px !important;
    width: 100% !important;
    max-width: none !important;
    min-height: 38px !important;
    height: 38px !important;
    max-height: 38px !important;
    margin: 2px 0 0 !important;
    padding: 5px 8px !important;
    border-radius: 12px !important;
  }

  .game-screen .timer-box span,
  .game-screen .timer-box em {
    display: inline !important;
    font-size: 11px !important;
    line-height: 1 !important;
  }

  .game-screen .timer-box strong {
    font-size: 24px !important;
    line-height: 1 !important;
  }

  .game-screen .round-animation,
  .game-screen .goal-animation,
  .game-screen .concede-animation,
  .game-screen .wrong-animation {
    min-height: 62px !important;
    height: 62px !important;
    max-height: 62px !important;
    padding: 7px 10px !important;
  }

  .game-screen .goal-animation .ball,
  .game-screen .concede-animation .ball,
  .game-screen .wrong-animation .ball {
    font-size: 26px !important;
  }

  .game-screen .goal-net {
    font-size: 28px !important;
  }

  .game-screen .answers-box {
    min-height: 104px !important;
    height: 104px !important;
    max-height: 118px !important;
  }

  .game-screen .waiting-panel h2 {
    font-size: 22px !important;
    line-height: 1.1 !important;
  }

  .game-screen .waiting-panel p {
    font-size: 12px !important;
    line-height: 1.28 !important;
  }

  .game-screen .room-code-large {
    font-size: 22px !important;
  }
}



/* v27 final mobile challenge polish */
@media (max-width: 760px) {
  .challenge-waiting {
    justify-content: center !important;
    align-items: center !important;
    min-height: 100% !important;
    padding: 18px 16px !important;
    gap: 18px !important;
  }

  .challenge-waiting .waiting-icon {
    width: 88px !important;
    height: 88px !important;
    margin: 0 auto !important;
    font-size: 42px !important;
  }

  .challenge-waiting h2 {
    margin: 0 !important;
    font-size: 28px !important;
    line-height: 1.1 !important;
  }

  .challenge-waiting p {
    margin: 0 !important;
    font-size: 16px !important;
    line-height: 1.35 !important;
    max-width: 280px !important;
  }

  .challenge-waiting .pre-round-count {
    width: 104px !important;
    height: 104px !important;
    margin: 0 !important;
    font-size: 52px !important;
  }

  .challenge-panel.challenge-live {
    justify-content: space-between !important;
  }

  .challenge-panel.challenge-live .teams-grid {
    height: 236px !important;
    min-height: 236px !important;
    max-height: 236px !important;
    grid-template-columns: minmax(0, 1fr) 42px minmax(0, 1fr) !important;
    gap: 10px !important;
    margin: 4px 0 6px !important;
  }

  .challenge-panel.challenge-live .team-card {
    height: 236px !important;
    min-height: 236px !important;
    max-height: 236px !important;
    grid-template-rows: 28px 78px 1fr !important;
    padding: 14px 10px !important;
    border-radius: 28px !important;
  }

  .challenge-panel.challenge-live .team-card span {
    font-size: 15px !important;
  }

  .challenge-panel.challenge-live .team-logo {
    width: 72px !important;
    height: 72px !important;
    border-radius: 22px !important;
    padding: 6px !important;
  }

  .challenge-panel.challenge-live .team-logo__inner {
    width: 56px !important;
    height: 56px !important;
    border-radius: 18px !important;
  }

  .challenge-panel.challenge-live .team-logo span {
    font-size: 24px !important;
  }

  .challenge-panel.challenge-live .team-card strong {
    font-size: 26px !important;
    line-height: 1.05 !important;
    -webkit-line-clamp: 2 !important;
  }

  .challenge-panel.challenge-live .versus {
    font-size: 24px !important;
  }

  .challenge-panel.challenge-live .single-answer-card {
    margin-top: 6px !important;
  }

  .challenge-panel.challenge-live .single-answer-card input {
    height: 54px !important;
    min-height: 54px !important;
    font-size: 17px !important;
  }

  .challenge-panel.challenge-live .answer-row {
    grid-template-columns: minmax(0, 1fr) 110px !important;
  }

  .challenge-panel.challenge-live .answer-row .primary-button {
    width: 110px !important;
    min-width: 110px !important;
    height: 54px !important;
    min-height: 54px !important;
    font-size: 15px !important;
  }

  .challenge-panel.challenge-live .timer-box {
    min-height: 50px !important;
    height: 50px !important;
    max-height: 50px !important;
    padding: 8px 14px !important;
  }

  .challenge-panel.challenge-live .timer-box span,
  .challenge-panel.challenge-live .timer-box em {
    display: inline !important;
    font-size: 14px !important;
  }

  .challenge-panel.challenge-live .timer-box strong {
    font-size: 34px !important;
  }

  .challenge-panel.challenge-live .challenge-tools .light-button {
    height: 44px !important;
    min-height: 44px !important;
    font-size: 13px !important;
    padding: 8px 10px !important;
  }

  .challenge-panel.challenge-feedback .teams-grid,
  .challenge-panel.challenge-ended .teams-grid {
    height: 150px !important;
    min-height: 150px !important;
    max-height: 150px !important;
    grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr) !important;
  }

  .challenge-panel.challenge-feedback .team-card,
  .challenge-panel.challenge-ended .team-card {
    height: 150px !important;
    min-height: 150px !important;
    max-height: 150px !important;
    grid-template-rows: 18px 50px 1fr !important;
    padding: 10px 8px !important;
  }

  .challenge-panel.challenge-feedback .team-card span,
  .challenge-panel.challenge-ended .team-card span {
    font-size: 12px !important;
  }

  .challenge-panel.challenge-feedback .team-logo,
  .challenge-panel.challenge-ended .team-logo {
    width: 46px !important;
    height: 46px !important;
  }

  .challenge-panel.challenge-feedback .team-logo__inner,
  .challenge-panel.challenge-ended .team-logo__inner {
    width: 36px !important;
    height: 36px !important;
  }

  .challenge-panel.challenge-feedback .team-card strong,
  .challenge-panel.challenge-ended .team-card strong {
    font-size: 18px !important;
  }

  .challenge-panel.challenge-feedback .wrong-animation,
  .challenge-panel.challenge-feedback .goal-animation,
  .challenge-panel.challenge-ended .wrong-animation,
  .challenge-panel.challenge-ended .goal-animation {
    min-height: 70px !important;
    max-height: 70px !important;
    height: 70px !important;
  }

  .challenge-panel.challenge-feedback .answers-box,
  .challenge-panel.challenge-ended .answers-box {
    min-height: 136px !important;
    max-height: 150px !important;
    height: auto !important;
    overflow: auto !important;
  }

  .challenge-panel.challenge-feedback .answer-tags,
  .challenge-panel.challenge-ended .answer-tags {
    gap: 10px !important;
  }

  .challenge-panel.challenge-feedback .answer-tags span,
  .challenge-panel.challenge-feedback .answer-tags.clickable button,
  .challenge-panel.challenge-ended .answer-tags span,
  .challenge-panel.challenge-ended .answer-tags.clickable button {
    padding: 10px 14px !important;
    font-size: 14px !important;
    border-radius: 999px !important;
  }

  .challenge-result {
    margin-top: 6px !important;
    gap: 8px !important;
    padding: 14px !important;
    border-radius: 18px !important;
  }

  .challenge-result strong {
    font-size: 18px !important;
    line-height: 1.15 !important;
  }

  .challenge-result span {
    font-size: 15px !important;
    line-height: 1.2 !important;
  }

  .challenge-result .primary-button.big {
    min-height: 54px !important;
    height: 54px !important;
    font-size: 18px !important;
    border-radius: 16px !important;
  }
}

@media (max-width: 760px) and (max-height: 780px) {
  .challenge-panel.challenge-live .teams-grid {
    height: 200px !important;
    min-height: 200px !important;
    max-height: 200px !important;
  }

  .challenge-panel.challenge-live .team-card {
    height: 200px !important;
    min-height: 200px !important;
    max-height: 200px !important;
    grid-template-rows: 24px 66px 1fr !important;
  }

  .challenge-panel.challenge-live .team-logo {
    width: 60px !important;
    height: 60px !important;
  }

  .challenge-panel.challenge-live .team-logo__inner {
    width: 46px !important;
    height: 46px !important;
  }

  .challenge-panel.challenge-live .team-card strong {
    font-size: 22px !important;
  }
}


/* v28 fix overflow / mobile keyboard / compact result */
@media (max-width: 760px) {
  .challenge-panel.challenge-feedback .status-message,
  .challenge-panel.challenge-ended .status-message {
    max-height: none !important;
    min-height: 44px !important;
    padding: 8px 10px !important;
    font-size: 12px !important;
    line-height: 1.28 !important;
    white-space: normal !important;
  }

  .challenge-panel.challenge-ended .answers-box {
    min-height: 112px !important;
    max-height: 124px !important;
    padding: 10px !important;
  }

  .challenge-panel.challenge-ended .challenge-result {
    margin-top: 4px !important;
    gap: 6px !important;
    padding: 10px 12px !important;
  }

  .challenge-panel.challenge-ended .challenge-result strong {
    font-size: 17px !important;
  }

  .challenge-panel.challenge-ended .challenge-result span {
    font-size: 14px !important;
  }

  .challenge-panel.challenge-ended .challenge-result .primary-button.big {
    height: 48px !important;
    min-height: 48px !important;
    font-size: 15px !important;
    border-radius: 14px !important;
  }

  .challenge-panel.challenge-feedback .team-card strong,
  .challenge-panel.challenge-ended .team-card strong,
  .challenge-panel.challenge-live .team-card strong {
    word-break: normal !important;
    overflow-wrap: break-word !important;
    hyphens: none !important;
  }

  .challenge-panel.challenge-live .challenge-tools .light-button,
  .challenge-panel.challenge-feedback .challenge-tools .light-button,
  .challenge-panel.challenge-ended .challenge-tools .light-button {
    line-height: 1.15 !important;
    text-align: center !important;
  }
}

@media (max-width: 760px) and (max-height: 720px) {
  .challenge-panel.challenge-feedback .teams-grid,
  .challenge-panel.challenge-ended .teams-grid {
    height: 132px !important;
    min-height: 132px !important;
    max-height: 132px !important;
  }

  .challenge-panel.challenge-feedback .team-card,
  .challenge-panel.challenge-ended .team-card {
    height: 132px !important;
    min-height: 132px !important;
    max-height: 132px !important;
    grid-template-rows: 16px 42px 1fr !important;
  }

  .challenge-panel.challenge-feedback .team-logo,
  .challenge-panel.challenge-ended .team-logo {
    width: 40px !important;
    height: 40px !important;
  }

  .challenge-panel.challenge-feedback .team-logo__inner,
  .challenge-panel.challenge-ended .team-logo__inner {
    width: 31px !important;
    height: 31px !important;
  }

  .challenge-panel.challenge-feedback .team-card strong,
  .challenge-panel.challenge-ended .team-card strong {
    font-size: 16px !important;
    line-height: 1.05 !important;
  }

  .challenge-panel.challenge-feedback .answers-box,
  .challenge-panel.challenge-ended .answers-box {
    min-height: 100px !important;
    max-height: 110px !important;
  }

  .challenge-panel.challenge-feedback .answer-tags span,
  .challenge-panel.challenge-feedback .answer-tags.clickable button,
  .challenge-panel.challenge-ended .answer-tags span,
  .challenge-panel.challenge-ended .answer-tags.clickable button {
    padding: 8px 11px !important;
    font-size: 12px !important;
  }

  .challenge-panel.challenge-ended .challenge-result .primary-button.big {
    height: 44px !important;
    min-height: 44px !important;
    font-size: 14px !important;
  }
}

@media (max-width: 760px) and (max-height: 620px) {
  .challenge-panel.challenge-live .top-row {
    gap: 6px !important;
  }

  .challenge-panel.challenge-live .top-row .light-button {
    min-height: 36px !important;
    height: 36px !important;
    padding: 6px 10px !important;
    font-size: 12px !important;
  }

  .challenge-panel.challenge-live .round-pill {
    min-height: 28px !important;
    font-size: 11px !important;
  }

  .challenge-panel.challenge-live .timer-box {
    min-height: 42px !important;
    height: 42px !important;
    max-height: 42px !important;
    padding: 5px 10px !important;
  }

  .challenge-panel.challenge-live .timer-box span,
  .challenge-panel.challenge-live .timer-box em {
    font-size: 12px !important;
  }

  .challenge-panel.challenge-live .timer-box strong {
    font-size: 26px !important;
  }

  .challenge-panel.challenge-live .challenge-tools .light-button {
    min-height: 40px !important;
    height: 40px !important;
    font-size: 11px !important;
    padding: 6px 8px !important;
  }

  .challenge-panel.challenge-live .teams-grid {
    height: 168px !important;
    min-height: 168px !important;
    max-height: 168px !important;
    grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr) !important;
    gap: 8px !important;
  }

  .challenge-panel.challenge-live .team-card {
    height: 168px !important;
    min-height: 168px !important;
    max-height: 168px !important;
    grid-template-rows: 18px 52px 1fr !important;
    padding: 8px 7px !important;
    border-radius: 22px !important;
  }

  .challenge-panel.challenge-live .team-card span {
    font-size: 11px !important;
  }

  .challenge-panel.challenge-live .team-logo {
    width: 46px !important;
    height: 46px !important;
    border-radius: 16px !important;
  }

  .challenge-panel.challenge-live .team-logo__inner {
    width: 35px !important;
    height: 35px !important;
    border-radius: 12px !important;
  }

  .challenge-panel.challenge-live .team-logo span {
    font-size: 15px !important;
  }

  .challenge-panel.challenge-live .team-card strong {
    font-size: 16px !important;
    line-height: 1.03 !important;
    -webkit-line-clamp: 3 !important;
  }

  .challenge-panel.challenge-live .versus {
    font-size: 18px !important;
  }

  .challenge-panel.challenge-live .single-answer-card input {
    height: 46px !important;
    min-height: 46px !important;
    font-size: 15px !important;
  }

  .challenge-panel.challenge-live .answer-row {
    grid-template-columns: minmax(0, 1fr) 98px !important;
  }

  .challenge-panel.challenge-live .answer-row .primary-button {
    width: 98px !important;
    min-width: 98px !important;
    height: 46px !important;
    min-height: 46px !important;
    font-size: 14px !important;
  }
}


/* v29 challenge final polish */
.challenge-waiting {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  text-align: center !important;
}
.challenge-waiting .waiting-icon,
.challenge-waiting h2,
.challenge-waiting p,
.challenge-waiting .pre-round-count {
  align-self: center !important;
}
.challenge-waiting p {
  max-width: 320px;
}

@media (max-width: 760px) {
  .challenge-panel.challenge-feedback,
  .challenge-panel.challenge-ended {
    gap: 8px !important;
  }

  .challenge-panel.challenge-feedback .wrong-explanation-card,
  .challenge-panel.challenge-ended .wrong-explanation-card {
    padding: 12px !important;
    gap: 10px !important;
    border-radius: 18px !important;
  }

  .challenge-panel.challenge-feedback .wrong-explanation-card strong,
  .challenge-panel.challenge-ended .wrong-explanation-card strong {
    font-size: 16px !important;
  }

  .challenge-panel.challenge-feedback .wrong-explanation-card p,
  .challenge-panel.challenge-ended .wrong-explanation-card p {
    margin: 4px 0 8px !important;
    font-size: 13px !important;
    line-height: 1.28 !important;
  }

  .challenge-panel.challenge-feedback .wrong-icon,
  .challenge-panel.challenge-ended .wrong-icon {
    width: 36px !important;
    height: 36px !important;
    flex-basis: 36px !important;
    font-size: 18px !important;
    border-radius: 12px !important;
  }

  .challenge-panel.challenge-feedback .report-box,
  .challenge-panel.challenge-ended .report-box {
    margin-top: 6px !important;
    padding: 12px !important;
    border-radius: 18px !important;
    flex-direction: column !important;
    align-items: stretch !important;
    justify-content: flex-start !important;
    gap: 10px !important;
  }

  .challenge-panel.challenge-feedback .report-box span,
  .challenge-panel.challenge-ended .report-box span {
    text-align: center !important;
    font-size: 15px !important;
    line-height: 1.25 !important;
  }

  .challenge-panel.challenge-feedback .report-box .light-button,
  .challenge-panel.challenge-ended .report-box .light-button {
    width: 100% !important;
    min-height: 50px !important;
    height: 50px !important;
    font-size: 16px !important;
    border-radius: 16px !important;
  }

  .challenge-panel.challenge-feedback .status-message,
  .challenge-panel.challenge-ended .status-message {
    margin: 0 !important;
    min-height: 42px !important;
    padding: 8px 10px !important;
    font-size: 12px !important;
    line-height: 1.25 !important;
    gap: 10px !important;
  }

  .challenge-panel.challenge-feedback .status-message .status-icon,
  .challenge-panel.challenge-ended .status-message .status-icon {
    font-size: 16px !important;
  }

  .challenge-panel.challenge-feedback .answers-box,
  .challenge-panel.challenge-ended .answers-box {
    margin-top: 4px !important;
    padding: 12px !important;
    min-height: 112px !important;
    max-height: 132px !important;
  }

  .challenge-panel.challenge-feedback .answers-box strong,
  .challenge-panel.challenge-ended .answers-box strong {
    display: block !important;
    font-size: 16px !important;
    line-height: 1.15 !important;
    margin-bottom: 2px !important;
  }

  .challenge-panel.challenge-feedback .answers-box p,
  .challenge-panel.challenge-ended .answers-box p {
    display: none !important;
  }

  .challenge-panel.challenge-feedback .answer-tags,
  .challenge-panel.challenge-ended .answer-tags {
    margin-top: 8px !important;
    gap: 8px !important;
  }

  .challenge-panel.challenge-feedback .answer-tags span,
  .challenge-panel.challenge-feedback .answer-tags.clickable button,
  .challenge-panel.challenge-ended .answer-tags span,
  .challenge-panel.challenge-ended .answer-tags.clickable button {
    padding: 8px 12px !important;
    font-size: 13px !important;
  }

  .challenge-panel.challenge-ended .teams-grid,
  .challenge-panel.challenge-feedback .teams-grid {
    height: 124px !important;
    min-height: 124px !important;
    max-height: 124px !important;
    grid-template-columns: minmax(0, 1fr) 30px minmax(0, 1fr) !important;
    gap: 8px !important;
  }

  .challenge-panel.challenge-ended .team-card,
  .challenge-panel.challenge-feedback .team-card {
    height: 124px !important;
    min-height: 124px !important;
    max-height: 124px !important;
    grid-template-rows: 16px 40px 1fr !important;
    padding: 8px 7px !important;
  }

  .challenge-panel.challenge-ended .team-logo,
  .challenge-panel.challenge-feedback .team-logo {
    width: 38px !important;
    height: 38px !important;
  }

  .challenge-panel.challenge-ended .team-logo__inner,
  .challenge-panel.challenge-feedback .team-logo__inner {
    width: 30px !important;
    height: 30px !important;
  }

  .challenge-panel.challenge-ended .team-card strong,
  .challenge-panel.challenge-feedback .team-card strong {
    font-size: 16px !important;
    line-height: 1.02 !important;
    -webkit-line-clamp: 2 !important;
  }

  .challenge-panel.challenge-ended .team-card span,
  .challenge-panel.challenge-feedback .team-card span {
    font-size: 11px !important;
  }

  .challenge-panel.challenge-ended .versus,
  .challenge-panel.challenge-feedback .versus {
    font-size: 18px !important;
  }

  .challenge-panel.challenge-ended .challenge-result {
    margin-top: 2px !important;
    padding: 10px 12px !important;
    gap: 6px !important;
  }

  .challenge-panel.challenge-ended .challenge-result strong {
    font-size: 16px !important;
    line-height: 1.1 !important;
  }

  .challenge-panel.challenge-ended .challenge-result span {
    font-size: 14px !important;
  }

  .challenge-panel.challenge-ended .challenge-result .primary-button.big {
    min-height: 46px !important;
    height: 46px !important;
    font-size: 15px !important;
  }
}

@media (max-width: 760px) and (max-height: 620px) {
  .challenge-panel.challenge-live .team-card strong {
    font-size: 14px !important;
    -webkit-line-clamp: 3 !important;
  }

  .challenge-panel.challenge-live .team-card {
    height: 160px !important;
    min-height: 160px !important;
    max-height: 160px !important;
  }

  .challenge-panel.challenge-live .teams-grid {
    height: 160px !important;
    min-height: 160px !important;
    max-height: 160px !important;
  }

  .challenge-waiting {
    min-height: 100% !important;
    padding-top: 24px !important;
  }

  .challenge-waiting .waiting-icon {
    width: 76px !important;
    height: 76px !important;
    font-size: 34px !important;
    margin-bottom: 14px !important;
  }

  .challenge-waiting h2 {
    font-size: 24px !important;
    margin-bottom: 8px !important;
  }

  .challenge-waiting p {
    font-size: 14px !important;
    margin-bottom: 14px !important;
  }

  .challenge-waiting .pre-round-count {
    width: 94px !important;
    height: 94px !important;
    font-size: 46px !important;
    margin-top: 6px !important;
  }
}
`;
