/**
 * More stable Wikidata generator for the football game.
 *
 * This version does NOT search club IDs online one-by-one.
 * It uses prefilled Wikidata QIDs and queries in very small chunks.
 *
 * Run:
 *   node generatePlayersFromWikidataLarge.cjs
 *
 * Output:
 *   src/data/players.js
 *   src/data/teams.js
 */

const fs = require("fs");
const path = require("path");

const CLUBS = [
  // England
  { qid: "Q18656", name: "Manchester United" },
  { qid: "Q50602", name: "Manchester City" },
  { qid: "Q1130849", name: "Liverpool" },
  { qid: "Q9610", name: "Chelsea" },
  { qid: "Q9617", name: "Arsenal" },
  { qid: "Q18741", name: "Tottenham" },
  { qid: "Q5794", name: "Everton" },
  { qid: "Q18747", name: "West Ham" },
  { qid: "Q18711", name: "Aston Villa" },
  { qid: "Q18716", name: "Newcastle United" },
  { qid: "Q19481", name: "Leicester City" },

  // Spain
  { qid: "Q7156", name: "Barcelona" },
  { qid: "Q8682", name: "Real Madrid" },
  { qid: "Q8701", name: "Atletico Madrid" },
  { qid: "Q10329", name: "Sevilla" },
  { qid: "Q10333", name: "Valencia" },
  { qid: "Q12297", name: "Villarreal" },
  { qid: "Q10315", name: "Real Sociedad" },
  { qid: "Q8723", name: "Real Betis" },

  // Italy
  { qid: "Q1543", name: "Milan" },
  { qid: "Q631", name: "Inter" },
  { qid: "Q1422", name: "Juventus" },
  { qid: "Q2739", name: "Roma" },
  { qid: "Q2641", name: "Napoli" },
  { qid: "Q2609", name: "Lazio" },
  { qid: "Q2052", name: "Fiorentina" },
  { qid: "Q628", name: "Atalanta" },
  { qid: "Q670", name: "Parma" },
  { qid: "Q1457", name: "Sampdoria" },

  // Germany
  { qid: "Q15789", name: "Bayern Münih" },
  { qid: "Q41420", name: "Borussia Dortmund" },
  { qid: "Q104761", name: "Bayer Leverkusen" },
  { qid: "Q1116223", name: "RB Leipzig" },
  { qid: "Q32494", name: "Schalke 04" },
  { qid: "Q51976", name: "Werder Bremen" },
  { qid: "Q101859", name: "Wolfsburg" },
  { qid: "Q38245", name: "Eintracht Frankfurt" },

  // France
  { qid: "Q483020", name: "PSG" },
  { qid: "Q704", name: "Lyon" },
  { qid: "Q10376", name: "Marseille" },
  { qid: "Q170465", name: "Monaco" },
  { qid: "Q19516", name: "Lille" },
  { qid: "Q185163", name: "Nice" },
  { qid: "Q19509", name: "Rennes" },

  // Netherlands / Portugal
  { qid: "Q81888", name: "Ajax" },
  { qid: "Q46295", name: "PSV" },
  { qid: "Q230184", name: "Feyenoord" },
  { qid: "Q128446", name: "Porto" },
  { qid: "Q131499", name: "Benfica" },
  { qid: "Q75729", name: "Sporting CP" },

  // Turkey
  { qid: "Q473352", name: "Galatasaray" },
  { qid: "Q19086", name: "Fenerbahçe" },
  { qid: "Q214978", name: "Beşiktaş" },
  { qid: "Q838563", name: "Trabzonspor" },
  { qid: "Q795723", name: "Başakşehir" },

  // Scotland
  { qid: "Q19593", name: "Celtic" },
  { qid: "Q19597", name: "Rangers" },

  // South America / MLS / Saudi
  { qid: "Q168400", name: "Santos" },
  { qid: "Q173070", name: "Flamengo" },
  { qid: "Q109472", name: "Boca Juniors" },
  { qid: "Q194388", name: "River Plate" },
  { qid: "Q54915", name: "Inter Miami" },
  { qid: "Q475887", name: "Al Nassr" },
  { qid: "Q243548", name: "Al Hilal" }
];

// If Wikidata returns too few players for a club because a QID is wrong,
// the script still continues. You can correct QIDs later.

const CHUNK_SIZE = 3;
const SLEEP_MS = 1500;
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

function buildAliases(name) {
  const aliases = new Set();
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

  const params = new URLSearchParams({
    query,
    format: "json"
  });

  const response = await fetch(`https://query.wikidata.org/sparql?${params.toString()}`, {
    headers: {
      "Accept": "application/sparql-results+json",
      "User-Agent": "FootballBridgeGame/1.0 (personal project; contact: local)"
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

async function main() {
  const clubByUri = new Map(CLUBS.map((club) => [`http://www.wikidata.org/entity/${club.qid}`, club]));
  const playersById = new Map();
  const chunks = chunkArray(CLUBS, CHUNK_SIZE);

  console.log(`Using ${CLUBS.length} clubs.`);
  console.log(`Fetching in ${chunks.length} small chunks...`);

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

  const players = Array.from(playersById.values())
    .map((player) => ({
      name: player.name,
      aliases: buildAliases(player.name),
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
  console.log(`Generated ${teams.length} teams.`);
  console.log("Files created:");
  console.log("  src/data/players.js");
  console.log("  src/data/teams.js");

  if (players.length < 100) {
    console.log("");
    console.log("WARNING: Generated player count is low.");
    console.log("This can happen if Wikidata rate-limits you. Wait 5-10 minutes and run again.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
