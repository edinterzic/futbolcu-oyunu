/**
 * Generate / enrich football game players from Highlightly.
 *
 * IMPORTANT:
 * - Do NOT put your API key into React code.
 * - Keep it in .env.highlightly only.
 * - Add .env.highlightly to .gitignore.
 *
 * Usage:
 *   node generatePlayersFromHighlightly.cjs
 *
 * Optional:
 *   node generatePlayersFromHighlightly.cjs --limit=20
 *
 * Output:
 *   src/data/players.js
 *
 * It reads:
 *   highlightly-player-seeds.json
 *   src/data/players.js
 *   src/data/teams.js
 *   .env.highlightly
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://soccer.highlightly.net";
const ENV_FILE = ".env.highlightly";
const SEED_FILE = "highlightly-player-seeds.json";
const PLAYERS_FILE = path.join("src", "data", "players.js");
const TEAMS_FILE = path.join("src", "data", "teams.js");
const CACHE_DIR = path.join(".highlightly-cache");

const REQUEST_DELAY_MS = 850;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(
      `${ENV_FILE} bulunamadı. Proje klasöründe oluştur ve içine HIGHLIGHTLY_API_KEY=... yaz.`
    );
  }

  const content = fs.readFileSync(ENV_FILE, "utf8");
  const env = {};

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const index = trimmed.indexOf("=");
    if (index === -1) return;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  });

  if (!env.HIGHLIGHTLY_API_KEY) {
    throw new Error(`${ENV_FILE} içinde HIGHLIGHTLY_API_KEY bulunamadı.`);
  }

  return env;
}

function ensureGitIgnore() {
  const gitignorePath = ".gitignore";
  const linesToAdd = [ENV_FILE, ".highlightly-cache/"];

  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";

  linesToAdd.forEach((line) => {
    if (!content.includes(line)) {
      content += `${content.endsWith("\n") || content.length === 0 ? "" : "\n"}${line}\n`;
    }
  });

  fs.writeFileSync(gitignorePath, content, "utf8");
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
  const aliases = new Set(existingAliases.filter(Boolean));
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

  // Turkish/diacritic-free versions help answer matching.
  Array.from(aliases).forEach((alias) => {
    const normalizedAlias = normalizeText(alias);
    if (normalizedAlias && normalizedAlias !== normalizeText(alias)) aliases.add(normalizedAlias);
  });

  aliases.delete(name);
  return Array.from(aliases).sort((a, b) => a.localeCompare(b, "tr-TR"));
}

function loadJsArrayExport(filePath, exportName) {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf8");
  const marker = `export const ${exportName} = `;
  const start = content.indexOf(marker);
  if (start === -1) return [];

  const jsonStart = start + marker.length;
  const jsonText = content.slice(jsonStart).replace(/;\s*$/, "").trim();

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`${filePath} parse edilemedi: ${error.message}`);
  }
}

function savePlayers(players) {
  fs.mkdirSync(path.dirname(PLAYERS_FILE), { recursive: true });
  fs.writeFileSync(
    PLAYERS_FILE,
    `export const PLAYERS = ${JSON.stringify(players, null, 2)};\n`,
    "utf8"
  );
}

function loadSeeds(limit) {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`${SEED_FILE} bulunamadı.`);
  }

  const seeds = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  if (!Array.isArray(seeds)) throw new Error(`${SEED_FILE} bir array olmalı.`);

  return typeof limit === "number" ? seeds.slice(0, limit) : seeds;
}

function getArgLimit() {
  const arg = process.argv.find((item) => item.startsWith("--limit="));
  if (!arg) return null;

  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeClubName(value) {
  const raw = String(value || "").trim();
  const key = normalizeText(raw);

  const aliases = {
    // Spain
    realmadridcf: "Real Madrid",
    realmadrid: "Real Madrid",
    fcbarcelona: "Barcelona",
    barcelona: "Barcelona",
    atletimadrid: "Atletico Madrid",
    atletico: "Atletico Madrid",
    atleticoatleticomadrid: "Atletico Madrid",
    sevillafc: "Sevilla",
    sevilla: "Sevilla",

    // Italy
    acmilan: "Milan",
    milan: "Milan",
    inter: "Inter",
    internazionale: "Inter",
    intermilano: "Inter",
    juventusfc: "Juventus",
    juventus: "Juventus",
    asroma: "Roma",
    roma: "Roma",

    // France
    psg: "PSG",
    paris: "PSG",
    parissaintgermain: "PSG",
    parissaintgermainfc: "PSG",
    olympiquelyonnais: "Lyon",
    lyon: "Lyon",
    ogcnice: "Nice",
    nice: "Nice",

    // England
    chelseafc: "Chelsea",
    chelsea: "Chelsea",
    manchesterunited: "Manchester United",
    manchesterunitedfc: "Manchester United",
    manu: "Manchester United",
    manchesteru: "Manchester United",
    manchestercity: "Manchester City",
    manchestercityfc: "Manchester City",
    mancity: "Manchester City",
    liverpool: "Liverpool",
    liverpoolfc: "Liverpool",
    tottenhamhotspur: "Tottenham",
    tottenhamhotspurfc: "Tottenham",
    tottenham: "Tottenham",
    arsenal: "Arsenal",
    arsenalfc: "Arsenal",

    // Netherlands
    ajax: "Ajax",
    afcajax: "Ajax",

    // Turkey
    besiktas: "Beşiktaş",
    besiktasjk: "Beşiktaş",
    besiktasjkfootball: "Beşiktaş",
    fenerbahce: "Fenerbahçe",
    fenerbahcesk: "Fenerbahçe",
    fenerbahceskfootball: "Fenerbahçe",
    galatasaray: "Galatasaray",
    galatasaraysk: "Galatasaray",
    galatasarayskfootball: "Galatasaray",
    trabzonspor: "Trabzonspor",
    basaksehir: "Başakşehir",
    istanbulbasaksehir: "Başakşehir",
    istanbulbasaksehirfk: "Başakşehir",
    sivasspor: "Sivasspor",
    kayserispor: "Kayserispor",
    antalyaspor: "Antalyaspor"
  };

  return aliases[key] || raw;
}

function getClubName(value) {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (typeof value === "object") {
    return (
      value.name ||
      value.fullName ||
      value.club ||
      value.team ||
      value.current ||
      value.title ||
      null
    );
  }

  return null;
}

function extractClubsFromPlayerDetail(detail) {
  const clubs = new Set();

  const currentClub = detail?.profile?.club?.current;
  if (currentClub) clubs.add(normalizeClubName(currentClub));

  const transfers = Array.isArray(detail?.transfers) ? detail.transfers : [];
  transfers.forEach((transfer) => {
    const fromClub = normalizeClubName(getClubName(transfer.from));
    const toClub = normalizeClubName(getClubName(transfer.to));

    if (fromClub) clubs.add(fromClub);
    if (toClub) clubs.add(toClub);
  });

  return Array.from(clubs).filter(Boolean);
}

function cachePathFor(type, key) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `${type}-${normalizeText(key)}.json`);
}

async function apiGet(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "x-rapidapi-key": apiKey
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  return text ? JSON.parse(text) : null;
}

async function searchPlayerByName(name, apiKey) {
  const cachePath = cachePathFor("search", name);

  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  }

  const url = `${BASE_URL}/players?name=${encodeURIComponent(name)}&limit=10&offset=0`;
  const data = await apiGet(url, apiKey);

  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
  await sleep(REQUEST_DELAY_MS);

  return data;
}

async function getPlayerDetail(id, apiKey) {
  const cachePath = cachePathFor("player", String(id));

  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  }

  const url = `${BASE_URL}/players/${id}`;
  const data = await apiGet(url, apiKey);

  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
  await sleep(REQUEST_DELAY_MS);

  return data;
}

function unwrapPlayerList(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function unwrapPlayerDetail(response) {
  if (Array.isArray(response)) return response[0] || null;
  if (response?.data && Array.isArray(response.data)) return response.data[0] || null;
  if (response?.data && typeof response.data === "object") return response.data;
  if (response && typeof response === "object") return response;
  return null;
}

function pickBestSearchResult(results, seedName) {
  const normalizedSeed = normalizeText(seedName);

  return (
    results.find((player) => normalizeText(player.fullName) === normalizedSeed) ||
    results.find((player) => normalizeText(player.name) === normalizedSeed) ||
    results.find((player) => normalizeText(player.fullName || player.name).includes(normalizedSeed)) ||
    results[0] ||
    null
  );
}

function mergePlayer(existingPlayersByName, incoming) {
  const key = normalizeText(incoming.name);

  if (!existingPlayersByName.has(key)) {
    existingPlayersByName.set(key, {
      name: incoming.name,
      aliases: [],
      clubs: []
    });
  }

  const player = existingPlayersByName.get(key);

  const aliases = new Set([...(player.aliases || []), ...(incoming.aliases || [])]);
  const clubs = new Set([...(player.clubs || []), ...(incoming.clubs || [])]);

  player.aliases = buildAliases(player.name, Array.from(aliases));
  player.clubs = Array.from(clubs).sort((a, b) => a.localeCompare(b, "tr-TR"));
}

async function main() {
  ensureGitIgnore();

  const { HIGHLIGHTLY_API_KEY } = readEnvFile();
  const teams = loadJsArrayExport(TEAMS_FILE, "TEAMS");
  const allowedTeams = new Set(teams);
  const existingPlayers = loadJsArrayExport(PLAYERS_FILE, "PLAYERS");
  const existingPlayersByName = new Map();

  existingPlayers.forEach((player) => {
    existingPlayersByName.set(normalizeText(player.name), {
      name: player.name,
      aliases: player.aliases || [],
      clubs: player.clubs || []
    });
  });

  const limit = getArgLimit();
  const seeds = loadSeeds(limit);

  console.log(`Seed oyuncu sayısı: ${seeds.length}`);
  console.log(`Mevcut oyuncu sayısı: ${existingPlayers.length}`);
  console.log(`Takım filtresi: ${teams.length} takım`);
  console.log("");

  let enrichedCount = 0;
  let skippedCount = 0;

  for (const seed of seeds) {
    const seedName = typeof seed === "string" ? seed : seed.name;
    const seedAliases = typeof seed === "string" ? [] : seed.aliases || [];

    if (!seedName) continue;

    try {
      console.log(`Searching: ${seedName}`);
      const searchResponse = await searchPlayerByName(seedName, HIGHLIGHTLY_API_KEY);
      const results = unwrapPlayerList(searchResponse);
      const best = pickBestSearchResult(results, seedName);

      if (!best?.id) {
        console.log(`  not found`);
        skippedCount += 1;
        continue;
      }

      console.log(`  found: ${best.fullName || best.name} (${best.id})`);
      const detailResponse = await getPlayerDetail(best.id, HIGHLIGHTLY_API_KEY);
      const detail = unwrapPlayerDetail(detailResponse);

      if (!detail) {
        console.log(`  detail empty`);
        skippedCount += 1;
        continue;
      }

      const sourceClubs = extractClubsFromPlayerDetail(detail);

      const filteredClubs = sourceClubs.filter((club) => allowedTeams.has(club));

      if (filteredClubs.length < 2) {
        console.log(`  skipped: only ${filteredClubs.length} selected club(s): ${filteredClubs.join(", ") || "-"}`);
        skippedCount += 1;
        continue;
      }

      const name = detail.fullName || detail.name || best.fullName || best.name || seedName;

      mergePlayer(existingPlayersByName, {
        name,
        aliases: buildAliases(name, seedAliases),
        clubs: filteredClubs
      });

      enrichedCount += 1;
      console.log(`  clubs: ${filteredClubs.join(", ")}`);
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      skippedCount += 1;
    }
  }

  const mergedPlayers = Array.from(existingPlayersByName.values())
    .filter((player) => (player.clubs || []).length >= 2)
    .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));

  savePlayers(mergedPlayers);

  console.log("");
  console.log(`Highlightly enriched: ${enrichedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Final players.js count: ${mergedPlayers.length}`);
  console.log("File updated: src/data/players.js");
  console.log("");
  console.log("Not: API kotasını korumak için cevaplar .highlightly-cache içine kaydedildi.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
