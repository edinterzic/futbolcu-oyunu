import React, { useMemo, useState } from "react";

const WINNING_SCORE = 3;

const TEAMS = [
  "Ajax",
  "Arsenal",
  "Atletico Madrid",
  "Barcelona",
  "Bayern Münih",
  "Beşiktaş",
  "Borussia Dortmund",
  "Chelsea",
  "Fenerbahçe",
  "Galatasaray",
  "Inter",
  "Juventus",
  "Liverpool",
  "Manchester City",
  "Manchester United",
  "Milan",
  "PSG",
  "Real Madrid",
  "Roma",
  "Tottenham",
  "Trabzonspor"
];

const PLAYERS = [
  { name: "Ricardo Quaresma", aliases: ["Quaresma"], clubs: ["Beşiktaş", "Barcelona", "Inter", "Chelsea", "Porto"] },
  { name: "Simao Sabrosa", aliases: ["Simao", "Simão"], clubs: ["Beşiktaş", "Barcelona", "Atletico Madrid", "Benfica"] },
  { name: "Miralem Pjanic", aliases: ["Pjanic", "Pjanić"], clubs: ["Beşiktaş", "Barcelona", "Juventus", "Roma", "Lyon"] },
  { name: "Dele Alli", aliases: ["Alli"], clubs: ["Beşiktaş", "Tottenham", "Everton"] },
  { name: "Georges-Kevin N'Koudou", aliases: ["N'Koudou", "Nkoudou"], clubs: ["Beşiktaş", "Tottenham", "Marseille"] },
  { name: "Kevin Wimmer", aliases: ["Wimmer"], clubs: ["Beşiktaş", "Tottenham", "Köln"] },
  { name: "Vedran Corluka", aliases: ["Corluka", "Ćorluka"], clubs: ["Tottenham", "Manchester City", "Dinamo Zagreb"] },
  { name: "Wesley Sneijder", aliases: ["Sneijder"], clubs: ["Galatasaray", "Inter", "Real Madrid", "Ajax"] },
  { name: "Mauro Icardi", aliases: ["Icardi"], clubs: ["Galatasaray", "Inter", "PSG", "Sampdoria"] },
  { name: "Felipe Melo", aliases: ["Melo"], clubs: ["Galatasaray", "Inter", "Juventus", "Fiorentina"] },
  { name: "Hakan Şükür", aliases: ["Şükür", "Sukur", "Hakan"], clubs: ["Galatasaray", "Inter", "Torino"] },
  { name: "Okan Buruk", aliases: ["Okan"], clubs: ["Galatasaray", "Inter", "Beşiktaş"] },
  { name: "Alex Telles", aliases: ["Telles"], clubs: ["Galatasaray", "Inter", "Manchester United", "Porto"] },
  { name: "Roberto Carlos", aliases: ["Carlos"], clubs: ["Fenerbahçe", "Real Madrid", "Inter"] },
  { name: "Mesut Özil", aliases: ["Özil", "Ozil", "Mesut"], clubs: ["Fenerbahçe", "Real Madrid", "Arsenal", "Schalke 04", "Werder Bremen"] },
  { name: "Nicolas Anelka", aliases: ["Anelka"], clubs: ["Fenerbahçe", "Real Madrid", "Arsenal", "Chelsea", "Liverpool", "PSG", "Manchester City", "Juventus"] },
  { name: "Raul Meireles", aliases: ["Meireles", "Raul"], clubs: ["Fenerbahçe", "Chelsea", "Liverpool", "Porto"] },
  { name: "Michy Batshuayi", aliases: ["Batshuayi", "Batsman"], clubs: ["Fenerbahçe", "Chelsea", "Beşiktaş", "Galatasaray", "Borussia Dortmund", "Marseille"] },
  { name: "Ilkay Gündogan", aliases: ["İlkay", "Ilkay", "Gündogan", "Gundogan"], clubs: ["Galatasaray", "Manchester City", "Barcelona", "Borussia Dortmund"] },
  { name: "Fernando", aliases: ["Fernando Reges"], clubs: ["Galatasaray", "Manchester City", "Porto", "Sevilla"] },
  { name: "Jason Denayer", aliases: ["Denayer"], clubs: ["Galatasaray", "Manchester City", "Lyon"] },
  { name: "Daniel Sturridge", aliases: ["Sturridge"], clubs: ["Trabzonspor", "Chelsea", "Liverpool", "Manchester City"] },
  { name: "John Obi Mikel", aliases: ["Mikel", "Obi Mikel"], clubs: ["Trabzonspor", "Chelsea"] },
  { name: "Florent Malouda", aliases: ["Malouda"], clubs: ["Trabzonspor", "Chelsea", "Lyon"] },
  { name: "Thierry Henry", aliases: ["Henry"], clubs: ["Barcelona", "Arsenal", "Juventus", "Monaco"] },
  { name: "Cesc Fabregas", aliases: ["Fabregas", "Fàbregas"], clubs: ["Barcelona", "Arsenal", "Chelsea", "Monaco"] },
  { name: "Alex Song", aliases: ["Song"], clubs: ["Barcelona", "Arsenal"] },
  { name: "Hector Bellerin", aliases: ["Bellerin", "Bellerín"], clubs: ["Barcelona", "Arsenal", "Real Betis"] },
  { name: "Pierre-Emerick Aubameyang", aliases: ["Aubameyang"], clubs: ["Barcelona", "Arsenal", "Chelsea", "Borussia Dortmund", "Marseille"] },
  { name: "Alexis Sanchez", aliases: ["Alexis", "Sanchez", "Sánchez"], clubs: ["Barcelona", "Arsenal", "Inter", "Manchester United", "Udinese", "Marseille"] },
  { name: "Martin Odegaard", aliases: ["Odegaard", "Ødegaard"], clubs: ["Real Madrid", "Arsenal", "Real Sociedad"] },
  { name: "Dani Ceballos", aliases: ["Ceballos"], clubs: ["Real Madrid", "Arsenal", "Real Betis"] },
  { name: "Luis Suarez", aliases: ["Suarez", "Suárez"], clubs: ["Liverpool", "Barcelona", "Ajax", "Atletico Madrid"] },
  { name: "Philippe Coutinho", aliases: ["Coutinho"], clubs: ["Liverpool", "Barcelona", "Bayern Münih", "Inter", "Aston Villa"] },
  { name: "Javier Mascherano", aliases: ["Mascherano"], clubs: ["Liverpool", "Barcelona", "West Ham"] },
  { name: "Pepe Reina", aliases: ["Reina"], clubs: ["Liverpool", "Barcelona", "Bayern Münih", "Milan", "Napoli"] },
  { name: "Thiago Alcantara", aliases: ["Thiago", "Alcantara", "Alcântara"], clubs: ["Liverpool", "Barcelona", "Bayern Münih"] },
  { name: "Kaka", aliases: ["Kaká"], clubs: ["Milan", "Real Madrid"] },
  { name: "Ronaldo", aliases: ["R9", "Ronaldo Nazario", "Ronaldo Nazário"], clubs: ["Milan", "Real Madrid", "Barcelona", "Inter"] },
  { name: "David Beckham", aliases: ["Beckham"], clubs: ["Milan", "Real Madrid", "Manchester United", "PSG"] },
  { name: "Theo Hernandez", aliases: ["Theo", "Hernandez", "Hernández"], clubs: ["Milan", "Real Madrid", "Atletico Madrid"] },
  { name: "Clarence Seedorf", aliases: ["Seedorf"], clubs: ["Milan", "Real Madrid", "Inter", "Ajax"] },
  { name: "Cristiano Ronaldo", aliases: ["Cristiano", "CR7"], clubs: ["Juventus", "Manchester United", "Real Madrid", "Sporting CP"] },
  { name: "Paul Pogba", aliases: ["Pogba"], clubs: ["Juventus", "Manchester United"] },
  { name: "Patrice Evra", aliases: ["Evra"], clubs: ["Juventus", "Manchester United", "Monaco", "Marseille"] },
  { name: "Carlos Tevez", aliases: ["Tevez", "Tévez"], clubs: ["Juventus", "Manchester United", "Manchester City", "West Ham"] },
  { name: "Robert Lewandowski", aliases: ["Lewandowski"], clubs: ["Bayern Münih", "Barcelona", "Borussia Dortmund"] },
  { name: "Arturo Vidal", aliases: ["Vidal"], clubs: ["Bayern Münih", "Barcelona", "Juventus", "Inter"] },
  { name: "Neymar", aliases: ["Neymar Jr"], clubs: ["PSG", "Barcelona", "Santos"] },
  { name: "Lionel Messi", aliases: ["Messi", "Leo Messi"], clubs: ["PSG", "Barcelona", "Inter Miami"] },
  { name: "Ronaldinho", aliases: ["Ronaldinho Gaucho", "Ronaldinho Gaúcho"], clubs: ["PSG", "Barcelona", "Milan"] },
  { name: "Zlatan Ibrahimovic", aliases: ["Zlatan", "Ibrahimovic", "Ibrahimović"], clubs: ["PSG", "Barcelona", "Milan", "Inter", "Juventus", "Manchester United", "Ajax"] },
  { name: "Ousmane Dembele", aliases: ["Dembele", "Dembélé"], clubs: ["PSG", "Barcelona", "Borussia Dortmund"] },
  { name: "Sergio Ramos", aliases: ["Ramos"], clubs: ["PSG", "Real Madrid", "Sevilla"] },
  { name: "Angel Di Maria", aliases: ["Di Maria", "Di María"], clubs: ["PSG", "Real Madrid", "Manchester United", "Juventus", "Benfica"] },
  { name: "Keylor Navas", aliases: ["Navas"], clubs: ["PSG", "Real Madrid", "Levante"] },
  { name: "Achraf Hakimi", aliases: ["Hakimi"], clubs: ["PSG", "Real Madrid", "Inter", "Borussia Dortmund"] },
  { name: "Marco Asensio", aliases: ["Asensio"], clubs: ["PSG", "Real Madrid", "Mallorca"] },
  { name: "Mario Götze", aliases: ["Gotze", "Götze"], clubs: ["Borussia Dortmund", "Bayern Münih", "PSV", "Eintracht Frankfurt"] },
  { name: "Mats Hummels", aliases: ["Hummels"], clubs: ["Borussia Dortmund", "Bayern Münih"] },
  { name: "Raphael Guerreiro", aliases: ["Guerreiro"], clubs: ["Borussia Dortmund", "Bayern Münih", "Lorient"] },
  { name: "Fernando Torres", aliases: ["Torres"], clubs: ["Atletico Madrid", "Chelsea", "Liverpool", "Milan"] },
  { name: "Diego Costa", aliases: ["Costa"], clubs: ["Atletico Madrid", "Chelsea"] },
  { name: "Thibaut Courtois", aliases: ["Courtois"], clubs: ["Atletico Madrid", "Chelsea", "Real Madrid"] },
  { name: "Alvaro Morata", aliases: ["Morata", "Álvaro Morata"], clubs: ["Atletico Madrid", "Chelsea", "Real Madrid", "Juventus"] },
  { name: "Saul Niguez", aliases: ["Saul", "Saúl", "Niguez", "Ñíguez"], clubs: ["Atletico Madrid", "Chelsea"] },
  { name: "Joao Felix", aliases: ["Felix", "Félix", "João Félix"], clubs: ["Atletico Madrid", "Chelsea", "Barcelona", "Benfica"] },
  { name: "Romelu Lukaku", aliases: ["Lukaku"], clubs: ["Inter", "Manchester United", "Chelsea", "Roma", "Everton"] },
  { name: "Christian Eriksen", aliases: ["Eriksen"], clubs: ["Inter", "Manchester United", "Tottenham", "Ajax"] },
  { name: "Matteo Darmian", aliases: ["Darmian"], clubs: ["Inter", "Manchester United", "Milan", "Parma"] },
  { name: "Ashley Young", aliases: ["Young"], clubs: ["Inter", "Manchester United", "Aston Villa"] },
  { name: "Nemanja Vidic", aliases: ["Vidic", "Vidić"], clubs: ["Inter", "Manchester United"] },
  { name: "Mohamed Salah", aliases: ["Salah"], clubs: ["Roma", "Liverpool", "Chelsea", "Fiorentina"] },
  { name: "Alisson Becker", aliases: ["Alisson", "Becker"], clubs: ["Roma", "Liverpool"] },
  { name: "Fabio Borini", aliases: ["Borini"], clubs: ["Roma", "Liverpool", "Chelsea", "Milan"] },
  { name: "John Arne Riise", aliases: ["Riise"], clubs: ["Roma", "Liverpool", "Monaco"] },
  { name: "Johan Cruyff", aliases: ["Cruyff"], clubs: ["Ajax", "Barcelona"] },
  { name: "Frenkie de Jong", aliases: ["Frenkie", "De Jong"], clubs: ["Ajax", "Barcelona"] },
  { name: "Patrick Kluivert", aliases: ["Kluivert"], clubs: ["Ajax", "Barcelona", "Milan"] },
  { name: "Frank de Boer", aliases: ["De Boer"], clubs: ["Ajax", "Barcelona", "Galatasaray"] },
  { name: "Ronald de Boer", aliases: ["Ronald de Boer"], clubs: ["Ajax", "Barcelona"] },
  { name: "Jasper Cillessen", aliases: ["Cillessen"], clubs: ["Ajax", "Barcelona", "Valencia"] }
];

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
  const [screen, setScreen] = useState("setup");
  const [playerNames, setPlayerNames] = useState(["Oyuncu 1", "Oyuncu 2"]);
  const [scores, setScores] = useState([0, 0]);
  const [round, setRound] = useState(() => getRandomRound());
  const [usedRoundKeys, setUsedRoundKeys] = useState([]);
  const [inputs, setInputs] = useState(["", ""]);
  const [message, setMessage] = useState(null);
  const [winner, setWinner] = useState(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [roundLocked, setRoundLocked] = useState(false);

  const suggestions = useMemo(() => inputs.map((input) => getPlayerSuggestions(input)), [inputs]);
  const correctPlayers = useMemo(() => getCorrectPlayersForRound(round), [round]);

  const startGame = () => {
    const firstRound = getRandomRound([]);
    setScores([0, 0]);
    setUsedRoundKeys([getRoundKey(firstRound)]);
    setRound(firstRound);
    setInputs(["", ""]);
    setMessage(null);
    setWinner(null);
    setShowAnswers(false);
    setRoundLocked(false);
    setScreen("game");
  };

  const nextRound = () => {
    const next = getRandomRound(usedRoundKeys);
    const nextKey = getRoundKey(next);
    const playableCount = getPlayableTeamPairs().length;
    const nextUsed = usedRoundKeys.length >= playableCount ? [nextKey] : [...usedRoundKeys, nextKey];

    setRound(next);
    setUsedRoundKeys(nextUsed);
    setInputs(["", ""]);
    setMessage(null);
    setShowAnswers(false);
    setRoundLocked(false);
  };

  const resetGame = () => {
    setScreen("setup");
    setScores([0, 0]);
    setWinner(null);
    setMessage(null);
    setInputs(["", ""]);
    setShowAnswers(false);
    setRoundLocked(false);
    setUsedRoundKeys([]);
  };

  const updatePlayerName = (index, value) => {
    const next = [...playerNames];
    next[index] = value || `Oyuncu ${index + 1}`;
    setPlayerNames(next);
  };

  const updateInput = (index, value) => {
    if (roundLocked) return;
    const next = [...inputs];
    next[index] = value;
    setInputs(next);
  };

  const selectSuggestion = (index, playerName) => {
    if (roundLocked) return;
    const next = [...inputs];
    next[index] = playerName;
    setInputs(next);
  };

  const checkAnswer = (playerIndex) => {
    if (roundLocked) {
      setMessage({ type: "info", text: "Bu tur bitti. Devam etmek için Sonraki Tur'a basın." });
      return;
    }

    const raw = inputs[playerIndex];
    const normalized = normalizeText(raw);

    if (!normalized) {
      setMessage({ type: "error", text: "Önce bir futbolcu adı yazmalısın." });
      return;
    }

    if (isCorrectAnswer(round, raw)) {
      const newScores = [...scores];
      newScores[playerIndex] += 1;
      setScores(newScores);
      setRoundLocked(true);
      setShowAnswers(true);

      if (newScores[playerIndex] >= WINNING_SCORE) {
        setWinner(playerIndex);
        setScreen("winner");
        return;
      }

      setMessage({
        type: "success",
        text: `${playerNames[playerIndex]} doğru bildi: ${raw}. Tur bitti, 1 puan aldı!`
      });
      return;
    }

    const player = findPlayerByInput(raw);
    const errorText = player
      ? `${player.name} var ama bu iki takımda da oynamamış görünüyor.`
      : `${raw} oyuncu havuzunda bulunamadı veya bu eşleşme için doğru değil.`;

    setMessage({ type: "error", text: errorText });
  };

  const skipRound = () => {
    if (roundLocked) return;
    setMessage({ type: "info", text: "Tur geçildi. Cevapları aşağıda görebilirsin." });
    setShowAnswers(true);
    setRoundLocked(true);
  };

  return (
    <div className="app-shell">
      <style>{css}</style>

      <main className="game-container">
        <header className="hero">
          <div className="badge">🛡️ Ortak Futbolcu Kapışması</div>
          <h1>İki Takım, Tek Futbolcu</h1>
          <p>
            Aynı anda iki takım çıkar. İki takımda da oynamış futbolcuyu ilk yazan puanı alır.
            {" "}
            {WINNING_SCORE} puana ulaşan kazanır.
          </p>
        </header>

        {screen === "setup" && (
          <section className="panel">
            <div className="players-grid">
              {[0, 1].map((index) => (
                <div key={index} className="input-card">
                  <label>👤 Oyuncu {index + 1}</label>
                  <input value={playerNames[index]} onChange={(event) => updatePlayerName(index, event.target.value)} />
                </div>
              ))}
            </div>

            <div className="rules">
              <h2>Kurallar</h2>
              <ul>
                <li>Doğru futbolcu adı yazan oyuncu 1 puan alır ve tur hemen biter.</li>
                <li>Tur bittikten sonra diğer oyuncu aynı turda cevap veremez.</li>
                <li>Toplam {WINNING_SCORE} puana ulaşan oyuncu oyunu kazanır.</li>
                <li>Türkçe karakter kullanmasan bile cevap kabul edilir.</li>
                <li>Soyadı veya bilinen kısa adı yazınca da cevap kontrolünde kabul edilir.</li>
                <li>Öneri kutusu tüm oyuncu havuzundan çalışır; sadece doğru cevapları göstermez.</li>
              </ul>
            </div>

            <button type="button" onClick={startGame} className="primary-button full-width">
              ▶️ Oyunu Başlat
            </button>
          </section>
        )}

        {screen === "game" && (
          <section className="game-area">
            <div className="score-grid">
              {[0, 1].map((index) => (
                <div key={index} className="score-card">
                  <span>{playerNames[index]}</span>
                  <strong>{scores[index]}</strong>
                </div>
              ))}
            </div>

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

              <div className="answer-grid">
                {[0, 1].map((index) => (
                  <div key={index} className="input-card answer-card">
                    <label>{playerNames[index]} cevabı</label>
                    <div className="answer-row">
                      <div className="autocomplete-wrap">
                        <input
                          value={inputs[index]}
                          disabled={roundLocked}
                          onChange={(event) => updateInput(index, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") checkAnswer(index);
                          }}
                          placeholder="Futbolcu adı yaz... örn. Suarez, Messi, Quaresma"
                        />

                        {!roundLocked && suggestions[index].length > 0 && (
                          <div className="suggestions">
                            {suggestions[index].map((player) => (
                              <button
                                key={player.name}
                                type="button"
                                onClick={() => selectSuggestion(index, player.name)}
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
                        onClick={() => checkAnswer(index)}
                        className="primary-button"
                      >
                        Kontrol
                      </button>
                    </div>
                  </div>
                ))}
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
                <button type="button" disabled={roundLocked} onClick={skipRound} className="light-button big">
                  Cevapları Göster
                </button>
                <button type="button" onClick={nextRound} className="light-button big strong">
                  Sonraki Tur
                </button>
              </div>
            </div>
          </section>
        )}

        {screen === "winner" && winner !== null && (
          <section className="panel winner-panel">
            <div className="trophy">🏆</div>
            <h2>Kazanan: {playerNames[winner]}</h2>
            <p>
              Final skor: {playerNames[0]} {scores[0]} - {scores[1]} {playerNames[1]}
            </p>

            <div className="winner-actions">
              <button type="button" onClick={startGame} className="primary-button big">
                Yeni Maç
              </button>
              <button type="button" onClick={resetGame} className="light-button big">
                Oyuncuları Değiştir
              </button>
            </div>
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

.players-grid,
.score-grid,
.answer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.input-card {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.22);
  border-radius: 20px;
  padding: 16px;
}

.input-card label {
  display: block;
  font-size: 14px;
  color: #d1fae5;
  margin-bottom: 8px;
  font-weight: 700;
}

.input-card input {
  width: 100%;
  border: none;
  border-radius: 14px;
  padding: 14px 15px;
  outline: none;
  color: #0f172a;
  background: white;
}

.input-card input:focus {
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.35);
}

.rules {
  margin: 18px 0;
  border: 1px solid rgba(110, 231, 183, 0.22);
  background: rgba(52, 211, 153, 0.10);
  border-radius: 20px;
  padding: 18px;
}

.rules h2 {
  margin: 0 0 10px;
  font-size: 19px;
}

.rules ul {
  margin: 0;
  padding-left: 20px;
  color: rgba(236, 253, 245, 0.93);
  line-height: 1.7;
}

.primary-button,
.light-button {
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

.light-button {
  background: rgba(255, 255, 255, 0.94);
  color: #0f172a;
}

.light-button:hover:not(:disabled) {
  background: #ecfdf5;
  transform: translateY(-1px);
}

.full-width {
  width: 100%;
  font-size: 18px;
  padding: 18px;
}

.big {
  padding: 17px 18px;
}

.strong {
  font-weight: 950;
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

.winner-panel {
  text-align: center;
}

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

.winner-panel h2 {
  margin: 0 0 10px;
  font-size: clamp(34px, 6vw, 58px);
  line-height: 1;
}

.winner-panel p {
  color: rgba(209, 250, 229, 0.9);
  margin-bottom: 24px;
}

.winner-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
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

  .players-grid,
  .score-grid,
  .answer-grid,
  .winner-actions {
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
}
`;
