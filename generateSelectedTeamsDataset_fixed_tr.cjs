/**
 * Selected team dataset generator with corrected Turkish club QIDs
 * and manual Turkish/European transfer overrides.
 *
 * Run from project root:
 *   node generateSelectedTeamsDataset_fixed_tr.cjs
 *
 * Output:
 *   src/data/players.js
 *   src/data/teams.js
 */

const fs = require("fs");
const path = require("path");

const CLUBS = [
  // Spain
  { qid: "Q8682", name: "Real Madrid" },
  { qid: "Q7156", name: "Barcelona" },
  { qid: "Q8701", name: "Atletico Madrid" },
  { qid: "Q10329", name: "Sevilla" },

  // Italy
  { qid: "Q1543", name: "Milan" },
  { qid: "Q631", name: "Inter" },
  { qid: "Q1422", name: "Juventus" },
  { qid: "Q2739", name: "Roma" },

  // France
  { qid: "Q483020", name: "PSG" },
  { qid: "Q704", name: "Lyon" },
  { qid: "Q185163", name: "Nice" },

  // England
  { qid: "Q9610", name: "Chelsea" },
  { qid: "Q18656", name: "Manchester United" },
  { qid: "Q50602", name: "Manchester City" },
  { qid: "Q1130849", name: "Liverpool" },
  { qid: "Q18741", name: "Tottenham" },
  { qid: "Q9617", name: "Arsenal" },

  // Netherlands
  { qid: "Q81888", name: "Ajax" },

  // Turkey - corrected QIDs
  { qid: "Q172567", name: "Beşiktaş" },
  { qid: "Q19648", name: "Fenerbahçe" },
  { qid: "Q495299", name: "Galatasaray" },
  { qid: "Q192641", name: "Trabzonspor" },
  { qid: "Q857938", name: "Başakşehir" },
  { qid: "Q372599", name: "Sivasspor" },
  { qid: "Q608122", name: "Kayserispor" },
  { qid: "Q43710", name: "Antalyaspor" }
];

const MANUAL_PLAYERS = [
  // Turkish derby / Turkish club corrections
  { name: "Emre Belözoğlu", aliases: ["Emre", "Belozoglu", "Belözoğlu"], clubs: ["Galatasaray", "Inter", "Atletico Madrid", "Fenerbahçe", "Başakşehir"] },
  { name: "Mehmet Topal", aliases: ["Topal"], clubs: ["Galatasaray", "Valencia", "Fenerbahçe", "Başakşehir"] },
  { name: "Caner Erkin", aliases: ["Caner", "Erkin"], clubs: ["Galatasaray", "Inter", "Fenerbahçe", "Beşiktaş", "Başakşehir"] },
  { name: "Burak Yılmaz", aliases: ["Burak", "Yilmaz", "Yılmaz"], clubs: ["Beşiktaş", "Fenerbahçe", "Trabzonspor", "Galatasaray", "Lille"] },
  { name: "Tümer Metin", aliases: ["Tümer", "Tumer", "Metin"], clubs: ["Beşiktaş", "Fenerbahçe"] },
  { name: "Rüştü Reçber", aliases: ["Rüştü", "Rustu", "Reçber", "Recber"], clubs: ["Fenerbahçe", "Barcelona", "Beşiktaş"] },
  { name: "Gökhan Gönül", aliases: ["Gökhan", "Gokhan", "Gönül", "Gonul"], clubs: ["Fenerbahçe", "Beşiktaş"] },
  { name: "Mehmet Aurelio", aliases: ["Aurelio", "Marco Aurelio"], clubs: ["Trabzonspor", "Fenerbahçe", "Beşiktaş"] },
  { name: "Mert Nobre", aliases: ["Nobre"], clubs: ["Fenerbahçe", "Beşiktaş", "Kayserispor"] },
  { name: "Colin Kazim-Richards", aliases: ["Kazim", "Kazım", "Kazim-Richards", "Kazım Richards"], clubs: ["Fenerbahçe", "Galatasaray"] },
  { name: "Elvir Balić", aliases: ["Balic", "Balić"], clubs: ["Fenerbahçe", "Galatasaray", "Real Madrid"] },
  { name: "Sergen Yalçın", aliases: ["Sergen", "Yalçın", "Yalcin"], clubs: ["Beşiktaş", "Fenerbahçe", "Galatasaray", "Trabzonspor"] },
  { name: "Ogün Temizkanoğlu", aliases: ["Ogün", "Ogun", "Temizkanoğlu", "Temizkanoglu"], clubs: ["Trabzonspor", "Fenerbahçe"] },
  { name: "Fatih Akyel", aliases: ["Fatih", "Akyel"], clubs: ["Galatasaray", "Fenerbahçe", "Trabzonspor"] },
  { name: "Tolga Zengin", aliases: ["Tolga", "Zengin"], clubs: ["Trabzonspor", "Beşiktaş"] },
  { name: "Olcay Şahan", aliases: ["Olcay", "Şahan", "Sahan"], clubs: ["Beşiktaş", "Trabzonspor"] },
  { name: "José Sosa", aliases: ["Sosa", "Jose Sosa"], clubs: ["Atletico Madrid", "Milan", "Beşiktaş", "Trabzonspor", "Fenerbahçe"] },
  { name: "Adem Ljajić", aliases: ["Adem", "Ljajic", "Ljajić"], clubs: ["Roma", "Inter", "Beşiktaş"] },
  { name: "Miralem Pjanić", aliases: ["Pjanic", "Pjanić"], clubs: ["Roma", "Juventus", "Barcelona", "Beşiktaş"] },
  { name: "Salih Uçan", aliases: ["Salih", "Uçan", "Ucan"], clubs: ["Fenerbahçe", "Roma", "Beşiktaş"] },
  { name: "Diego Perotti", aliases: ["Perotti"], clubs: ["Sevilla", "Roma", "Fenerbahçe"] },
  { name: "Cengiz Ünder", aliases: ["Cengiz", "Ünder", "Under"], clubs: ["Başakşehir", "Roma", "Marseille", "Fenerbahçe"] },
  { name: "Edin Džeko", aliases: ["Dzeko", "Džeko"], clubs: ["Manchester City", "Roma", "Inter", "Fenerbahçe"] },
  { name: "Dušan Tadić", aliases: ["Tadic", "Tadić"], clubs: ["Ajax", "Fenerbahçe"] },
  { name: "Fred", aliases: ["Frederico Rodrigues"], clubs: ["Manchester United", "Fenerbahçe"] },
  { name: "Dries Mertens", aliases: ["Mertens"], clubs: ["Galatasaray"] },
  { name: "Mauro Icardi", aliases: ["Icardi"], clubs: ["Inter", "PSG", "Galatasaray"] },
  { name: "Hakim Ziyech", aliases: ["Ziyech"], clubs: ["Ajax", "Chelsea", "Galatasaray"] },
  { name: "Wilfried Zaha", aliases: ["Zaha"], clubs: ["Manchester United", "Galatasaray", "Lyon"] },
  { name: "Tanguy Ndombele", aliases: ["Ndombele"], clubs: ["Lyon", "Tottenham", "Galatasaray", "Nice"] },
  { name: "Victor Osimhen", aliases: ["Osimhen"], clubs: ["Lille", "Galatasaray"] },
  { name: "Nicolò Zaniolo", aliases: ["Zaniolo", "Nicolo Zaniolo"], clubs: ["Roma", "Galatasaray"] },
  { name: "Ryan Babel", aliases: ["Babel"], clubs: ["Ajax", "Liverpool", "Beşiktaş", "Galatasaray"] },
  { name: "Gedson Fernandes", aliases: ["Gedson"], clubs: ["Galatasaray", "Beşiktaş"] },
  { name: "Demba Ba", aliases: ["Ba"], clubs: ["Chelsea", "Beşiktaş", "Başakşehir"] },
  { name: "Michy Batshuayi", aliases: ["Batshuayi"], clubs: ["Chelsea", "Borussia Dortmund", "Beşiktaş", "Fenerbahçe", "Galatasaray"] },
  { name: "Vincent Aboubakar", aliases: ["Aboubakar"], clubs: ["Porto", "Beşiktaş", "Antalyaspor"] },
  { name: "Alex Oxlade-Chamberlain", aliases: ["Oxlade", "Chamberlain", "Oxlade-Chamberlain"], clubs: ["Arsenal", "Liverpool", "Beşiktaş"] },
  { name: "Cenk Tosun", aliases: ["Cenk", "Tosun"], clubs: ["Beşiktaş", "Everton", "Fenerbahçe"] },
  { name: "Rachid Ghezzal", aliases: ["Ghezzal"], clubs: ["Lyon", "Monaco", "Leicester City", "Beşiktaş"] },
  { name: "Douglas Pereira", aliases: ["Douglas"], clubs: ["Barcelona", "Sivasspor", "Beşiktaş"] },
  { name: "Roberto Soldado", aliases: ["Soldado"], clubs: ["Real Madrid", "Valencia", "Tottenham", "Fenerbahçe"] },
  { name: "Dirk Kuyt", aliases: ["Kuyt"], clubs: ["Liverpool", "Fenerbahçe", "Feyenoord"] },
  { name: "Nani", aliases: ["Luís Nani", "Luis Nani"], clubs: ["Manchester United", "Fenerbahçe", "Valencia"] },
  { name: "Robin van Persie", aliases: ["Van Persie", "Persie"], clubs: ["Arsenal", "Manchester United", "Fenerbahçe"] },

  // Başakşehir / Sivasspor / Antalya useful links
  { name: "Emmanuel Adebayor", aliases: ["Adebayor"], clubs: ["Arsenal", "Manchester City", "Real Madrid", "Tottenham", "Başakşehir"] },
  { name: "Gaël Clichy", aliases: ["Clichy", "Gael Clichy"], clubs: ["Arsenal", "Manchester City", "Başakşehir"] },
  { name: "Robinho", aliases: ["Robson de Souza"], clubs: ["Real Madrid", "Manchester City", "Milan", "Sivasspor", "Başakşehir"] },
  { name: "Samuel Eto'o", aliases: ["Eto'o", "Etoo"], clubs: ["Real Madrid", "Barcelona", "Inter", "Chelsea", "Antalyaspor"] },
  { name: "Lukas Podolski", aliases: ["Podolski"], clubs: ["Arsenal", "Inter", "Galatasaray", "Antalyaspor"] },
  { name: "Samir Nasri", aliases: ["Nasri"], clubs: ["Arsenal", "Manchester City", "Sevilla", "Antalyaspor"] },
  { name: "Nuri Şahin", aliases: ["Nuri", "Sahin", "Şahin"], clubs: ["Real Madrid", "Liverpool", "Antalyaspor"] },
  { name: "Mario Balotelli", aliases: ["Balotelli"], clubs: ["Inter", "Manchester City", "Milan", "Liverpool", "Nice"] },
  { name: "Wesley Sneijder", aliases: ["Sneijder"], clubs: ["Ajax", "Real Madrid", "Inter", "Galatasaray", "Nice"] },
  { name: "Aaron Ramsey", aliases: ["Ramsey"], clubs: ["Arsenal", "Juventus", "Nice"] },
  { name: "Dante", aliases: ["Dante Bonfim"], clubs: ["Bayern Münih", "Nice"] },
  { name: "Memphis Depay", aliases: ["Depay", "Memphis"], clubs: ["Manchester United", "Lyon", "Barcelona", "Atletico Madrid"] },
  { name: "Alexandre Lacazette", aliases: ["Lacazette"], clubs: ["Lyon", "Arsenal"] },
  { name: "Karim Benzema", aliases: ["Benzema"], clubs: ["Lyon", "Real Madrid"] },
  { name: "Corentin Tolisso", aliases: ["Tolisso"], clubs: ["Lyon", "Bayern Münih"] },
  { name: "Moussa Dembélé", aliases: ["Dembele", "Dembélé"], clubs: ["Lyon", "Atletico Madrid"] },

  // Extra high-value European links
  { name: "Cristiano Ronaldo", aliases: ["Ronaldo", "Cristiano", "CR7"], clubs: ["Manchester United", "Real Madrid", "Juventus"] },
  { name: "Lionel Messi", aliases: ["Messi"], clubs: ["Barcelona", "PSG"] },
  { name: "Neymar", aliases: ["Neymar Jr"], clubs: ["Barcelona", "PSG"] },
  { name: "Zlatan Ibrahimović", aliases: ["Zlatan", "Ibrahimovic", "Ibrahimović"], clubs: ["Ajax", "Juventus", "Inter", "Barcelona", "Milan", "PSG", "Manchester United"] },
  { name: "Luis Suárez", aliases: ["Suarez", "Suárez"], clubs: ["Ajax", "Liverpool", "Barcelona", "Atletico Madrid"] },
  { name: "Ángel Di María", aliases: ["Di Maria", "Di María"], clubs: ["Real Madrid", "Manchester United", "PSG", "Juventus"] },
  { name: "Nicolas Anelka", aliases: ["Anelka"], clubs: ["PSG", "Arsenal", "Real Madrid", "Liverpool", "Manchester City", "Chelsea", "Juventus", "Fenerbahçe"] },
  { name: "Ricardo Quaresma", aliases: ["Quaresma"], clubs: ["Barcelona", "Inter", "Chelsea", "Beşiktaş"] },
  { name: "Alex Telles", aliases: ["Telles"], clubs: ["Galatasaray", "Inter", "Manchester United"] },
  { name: "Felipe Melo", aliases: ["Melo"], clubs: ["Galatasaray", "Juventus", "Inter"] },
  { name: "Didier Drogba", aliases: ["Drogba"], clubs: ["Chelsea", "Galatasaray"] },
  { name: "Fernando Muslera", aliases: ["Muslera"], clubs: ["Galatasaray", "Lazio"] }
];

const CHUNK_SIZE = 3;
const SLEEP_MS = 1200;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildAliases(name, existingAliases = []) {
  const aliases = new Set(existingAliases);
  const text = String(name || "").trim();

  text
    .replaceAll("-", " ")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .forEach((part) => aliases.add(part));

  const parts = text.replaceAll("-", " ").split(" ").filter(Boolean);
  const lastName = parts[parts.length - 1];
  if (lastName && lastName.length >= 3) aliases.add(lastName);

  aliases.delete(name);
  return Array.from(aliases).sort((a, b) => a.localeCompare(b, "tr-TR"));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildQuery(clubs) {
  const qids = clubs.map((club) => `wd:${club.qid}`).join("\n    ");

  return `
SELECT ?player ?playerLabel ?club WHERE {
  VALUES ?club {
    ${qids}
  }

  ?player wdt:P54 ?club.

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en,tr,es,fr,de,it,pt".
  }
}
LIMIT 12000
`;
}

async function fetchChunk(clubs, attempt = 1) {
  const query = buildQuery(clubs);
  const params = new URLSearchParams({ query, format: "json" });

  const response = await fetch(`https://query.wikidata.org/sparql?${params.toString()}`, {
    headers: {
      "Accept": "application/sparql-results+json",
      "User-Agent": "FootballBridgeGame/1.0 (personal project)"
    }
  });

  if (!response.ok) {
    if (attempt < MAX_RETRIES && [429, 500, 502, 503, 504].includes(response.status)) {
      const waitMs = SLEEP_MS * attempt * 2;
      console.log(`Retrying chunk after ${waitMs}ms because of ${response.status}...`);
      await sleep(waitMs);
      return fetchChunk(clubs, attempt + 1);
    }

    throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function mergeManualPlayers(playersById) {
  MANUAL_PLAYERS.forEach((manualPlayer) => {
    const key = `manual:${normalizeText(manualPlayer.name)}`;

    if (!playersById.has(key)) {
      playersById.set(key, {
        id: key,
        name: manualPlayer.name,
        aliases: new Set(manualPlayer.aliases || []),
        clubs: []
      });
    }

    const player = playersById.get(key);

    (manualPlayer.aliases || []).forEach((alias) => player.aliases.add(alias));

    manualPlayer.clubs.forEach((club) => {
      if (!player.clubs.includes(club)) player.clubs.push(club);
    });
  });
}

async function main() {
  const clubByUri = new Map(CLUBS.map((club) => [`http://www.wikidata.org/entity/${club.qid}`, club]));
  const playersById = new Map();
  const chunks = chunkArray(CLUBS, CHUNK_SIZE);

  console.log(`Using ${CLUBS.length} selected clubs with corrected Turkish QIDs.`);
  console.log(`Fetching in ${chunks.length} chunks...`);

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const names = chunk.map((club) => club.name).join(", ");
    console.log(`Chunk ${i + 1}/${chunks.length}: ${names}`);

    try {
      const data = await fetchChunk(chunk);

      data.results.bindings.forEach((row) => {
        const playerId = row.player?.value;
        const playerName = row.playerLabel?.value;
        const club = clubByUri.get(row.club?.value);

        if (!playerId || !club || !playerName || playerName.startsWith("Q")) return;

        if (!playersById.has(playerId)) {
          playersById.set(playerId, {
            id: playerId.split("/").pop(),
            name: playerName,
            aliases: new Set(),
            clubs: []
          });
        }

        const player = playersById.get(playerId);
        if (!player.clubs.includes(club.name)) player.clubs.push(club.name);
      });

      console.log(`  total raw players so far: ${playersById.size}`);
    } catch (error) {
      console.warn(`  skipped chunk: ${error.message}`);
    }

    await sleep(SLEEP_MS);
  }

  console.log("Merging manual Turkish/European overrides...");
  mergeManualPlayers(playersById);

  const players = Array.from(playersById.values())
    .map((player) => ({
      name: player.name,
      aliases: buildAliases(player.name, Array.from(player.aliases || [])),
      clubs: player.clubs.sort((a, b) => a.localeCompare(b, "tr-TR"))
    }))
    .filter((player) => player.clubs.length >= 2)
    .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));

  const teams = CLUBS.map((club) => club.name).sort((a, b) => a.localeCompare(b, "tr-TR"));

  fs.mkdirSync(path.join("src", "data"), { recursive: true });

  fs.writeFileSync(
    path.join("src", "data", "players.js"),
    `export const PLAYERS = ${JSON.stringify(players, null, 2)};\n`,
    "utf8"
  );

  fs.writeFileSync(
    path.join("src", "data", "teams.js"),
    `export const TEAMS = ${JSON.stringify(teams, null, 2)};\n`,
    "utf8"
  );

  console.log("");
  console.log(`Generated ${players.length} multi-club players.`);
  console.log(`Generated ${teams.length} selected teams.`);
  console.log("Files created:");
  console.log("  src/data/players.js");
  console.log("  src/data/teams.js");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
