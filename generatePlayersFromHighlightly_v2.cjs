const fs = require("fs");
const path = require("path");

const BASE_URL = "https://soccer.highlightly.net";
const ENV_FILE = ".env.highlightly";
const SEED_FILE = "highlightly-player-seeds-expanded.json";
const PLAYERS_FILE = path.join("src", "data", "players.js");
const TEAMS_FILE = path.join("src", "data", "teams.js");
const CACHE_DIR = ".highlightly-cache";
const REPORT_DIR = "reports";
const REPORT_FILE = path.join(REPORT_DIR, "highlightly-report.json");
const REQUEST_DELAY_MS = 250;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) throw new Error(`${ENV_FILE} bulunamadı.`);
  const env = {};
  fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  });
  if (!env.HIGHLIGHTLY_API_KEY) throw new Error(`${ENV_FILE} içinde HIGHLIGHTLY_API_KEY yok.`);
  return env;
}

function ensureGitIgnore() {
  const file = ".gitignore";
  const add = [ENV_FILE, ".highlightly-cache/", "reports/highlightly-report.json"];
  let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  add.forEach((line) => {
    if (!content.includes(line)) content += `${content.endsWith("\n") || content.length === 0 ? "" : "\n"}${line}\n`;
  });
  fs.writeFileSync(file, content, "utf8");
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ı]/g, "i").replace(/[ğ]/g, "g").replace(/[ü]/g, "u")
    .replace(/[ş]/g, "s").replace(/[ö]/g, "o").replace(/[ç]/g, "c")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function buildAliases(name, existingAliases = []) {
  const aliases = new Set(existingAliases.filter(Boolean));
  const text = String(name || "").trim();
  text.replaceAll("-", " ").split(" ").map((p) => p.trim()).filter((p) => p.length >= 3).forEach((p) => aliases.add(p));
  const parts = text.replaceAll("-", " ").split(" ").filter(Boolean);
  const lastName = parts[parts.length - 1];
  if (lastName && lastName.length >= 3) aliases.add(lastName);
  Array.from(aliases).forEach((alias) => {
    const normalizedAlias = normalizeText(alias);
    if (normalizedAlias) aliases.add(normalizedAlias);
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
  return JSON.parse(content.slice(start + marker.length).replace(/;\s*$/, "").trim());
}

function savePlayers(players) {
  fs.mkdirSync(path.dirname(PLAYERS_FILE), { recursive: true });
  fs.writeFileSync(PLAYERS_FILE, `export const PLAYERS = ${JSON.stringify(players, null, 2)};\n`, "utf8");
}

function getArgNumber(name) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return null;
  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function loadSeeds() {
  const allSeeds = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const start = getArgNumber("start") || 0;
  const limit = getArgNumber("limit");
  return {
    allCount: allSeeds.length,
    start,
    limit,
    seeds: typeof limit === "number" ? allSeeds.slice(start, start + limit) : allSeeds.slice(start)
  };
}

function normalizeClubName(value) {
  const raw = String(value || "").trim();
  const key = normalizeText(raw);
  const aliases = {
    realmadridcf:"Real Madrid", realmadrid:"Real Madrid", fcbarcelona:"Barcelona", barcelona:"Barcelona",
    atleticomadrid:"Atletico Madrid", clubatleticodemadrid:"Atletico Madrid", sevillafc:"Sevilla", sevilla:"Sevilla",
    acmilan:"Milan", milan:"Milan", inter:"Inter", internazionale:"Inter", intermilano:"Inter", fcintermilan:"Inter",
    juventusfc:"Juventus", juventus:"Juventus", asroma:"Roma", roma:"Roma",
    psg:"PSG", paris:"PSG", parissaintgermain:"PSG", parissaintgermainfc:"PSG",
    olympiquelyonnais:"Lyon", lyon:"Lyon", ogcnice:"Nice", nice:"Nice",
    chelseafc:"Chelsea", chelsea:"Chelsea", manchesterunited:"Manchester United", manchesterunitedfc:"Manchester United",
    manutd:"Manchester United", manu:"Manchester United", manchestercity:"Manchester City", manchestercityfc:"Manchester City",
    mancity:"Manchester City", liverpool:"Liverpool", liverpoolfc:"Liverpool",
    tottenhamhotspur:"Tottenham", tottenhamhotspurfc:"Tottenham", tottenham:"Tottenham", arsenal:"Arsenal", arsenalfc:"Arsenal",
    ajax:"Ajax", afcajax:"Ajax",
    besiktas:"Beşiktaş", besiktasjk:"Beşiktaş", fenerbahce:"Fenerbahçe", fenerbahcesk:"Fenerbahçe",
    galatasaray:"Galatasaray", galatasaraysk:"Galatasaray", trabzonspor:"Trabzonspor",
    basaksehir:"Başakşehir", istanbulbasaksehir:"Başakşehir", istanbulbasaksehirfk:"Başakşehir",
    sivasspor:"Sivasspor", kayserispor:"Kayserispor", antalyaspor:"Antalyaspor"
  };
  return aliases[key] || raw;
}

function getClubName(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.name || value.fullName || value.club || value.team || value.current || value.title || null;
  return null;
}

function extractClubsFromPlayerDetail(detail) {
  const clubs = new Set();
  const rawClubs = new Set();
  const currentClub = detail?.profile?.club?.current;
  if (currentClub) { rawClubs.add(String(currentClub)); clubs.add(normalizeClubName(currentClub)); }
  const transfers = Array.isArray(detail?.transfers) ? detail.transfers : [];
  transfers.forEach((transfer) => {
    const fromRaw = getClubName(transfer.from);
    const toRaw = getClubName(transfer.to);
    if (fromRaw) { rawClubs.add(String(fromRaw)); clubs.add(normalizeClubName(fromRaw)); }
    if (toRaw) { rawClubs.add(String(toRaw)); clubs.add(normalizeClubName(toRaw)); }
  });
  return { clubs: Array.from(clubs).filter(Boolean), rawClubs: Array.from(rawClubs).filter(Boolean) };
}

function cachePathFor(type, key) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `${type}-${normalizeText(key)}.json`);
}

async function apiGet(url, apiKey) {
  const response = await fetch(url, { headers: { Accept: "application/json", "x-rapidapi-key": apiKey } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function searchPlayerByName(name, apiKey) {
  const cache = cachePathFor("search", name);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const data = await apiGet(`${BASE_URL}/players?name=${encodeURIComponent(name)}&limit=10&offset=0`, apiKey);
  fs.writeFileSync(cache, JSON.stringify(data, null, 2), "utf8");
  await sleep(REQUEST_DELAY_MS);
  return data;
}

async function getPlayerDetail(id, apiKey) {
  const cache = cachePathFor("player", String(id));
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const data = await apiGet(`${BASE_URL}/players/${id}`, apiKey);
  fs.writeFileSync(cache, JSON.stringify(data, null, 2), "utf8");
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
  return results.find((p) => normalizeText(p.fullName) === normalizedSeed)
    || results.find((p) => normalizeText(p.name) === normalizedSeed)
    || results.find((p) => normalizeText(p.fullName || p.name).includes(normalizedSeed))
    || results[0]
    || null;
}

function mergePlayer(existingPlayersByName, incoming) {
  const key = normalizeText(incoming.name);
  if (!existingPlayersByName.has(key)) existingPlayersByName.set(key, { name: incoming.name, aliases: [], clubs: [] });
  const player = existingPlayersByName.get(key);
  player.aliases = buildAliases(player.name, [...(player.aliases || []), ...(incoming.aliases || [])]);
  player.clubs = Array.from(new Set([...(player.clubs || []), ...(incoming.clubs || [])])).sort((a, b) => a.localeCompare(b, "tr-TR"));
}

async function main() {
  ensureGitIgnore();
  const { HIGHLIGHTLY_API_KEY } = readEnvFile();
  const teams = loadJsArrayExport(TEAMS_FILE, "TEAMS");
  const allowedTeams = new Set(teams);
  const existingPlayers = loadJsArrayExport(PLAYERS_FILE, "PLAYERS");
  const existingPlayersByName = new Map();
  existingPlayers.forEach((p) => existingPlayersByName.set(normalizeText(p.name), { name: p.name, aliases: p.aliases || [], clubs: p.clubs || [] }));

  const { allCount, start, limit, seeds } = loadSeeds();
  console.log(`Toplam seed: ${allCount}`);
  console.log(`Bu çalışma: start=${start}, limit=${limit ?? "sonuna kadar"}, işlenecek=${seeds.length}`);
  console.log(`Mevcut oyuncu: ${existingPlayers.length}`);
  console.log("");

  const report = { startedAt: new Date().toISOString(), enriched: [], skipped: [], errors: [] };

  for (const seed of seeds) {
    const seedName = typeof seed === "string" ? seed : seed.name;
    const seedAliases = typeof seed === "string" ? [] : seed.aliases || [];
    const seedId = typeof seed === "object" ? seed.highlightlyId : null;
    try {
      console.log(`Processing: ${seedName}${seedId ? ` (#${seedId})` : ""}`);
      let best = seedId ? { id: seedId, name: seedName, fullName: seedName } : null;
      if (!best) {
        const search = await searchPlayerByName(seedName, HIGHLIGHTLY_API_KEY);
        best = pickBestSearchResult(unwrapPlayerList(search), seedName);
      }
      if (!best?.id) { console.log("  not found"); report.skipped.push({ seedName, reason: "not_found" }); continue; }

      console.log(`  using: ${best.fullName || best.name} (${best.id})`);
      const detail = unwrapPlayerDetail(await getPlayerDetail(best.id, HIGHLIGHTLY_API_KEY));
      if (!detail) { console.log("  detail empty"); report.skipped.push({ seedName, id: best.id, reason: "detail_empty" }); continue; }

      const extracted = extractClubsFromPlayerDetail(detail);
      const filteredClubs = extracted.clubs.filter((club) => allowedTeams.has(club));

      if (filteredClubs.length < 2) {
        console.log(`  skipped: selected=${filteredClubs.join(", ") || "-"} | raw=${extracted.rawClubs.join(", ") || "-"}`);
        report.skipped.push({ seedName, id: best.id, reason: "less_than_two_selected_clubs", selectedClubs: filteredClubs, rawClubs: extracted.rawClubs });
        continue;
      }

      const name = detail.fullName || detail.name || best.fullName || best.name || seedName;
      mergePlayer(existingPlayersByName, { name, aliases: buildAliases(name, seedAliases), clubs: filteredClubs });
      console.log(`  clubs: ${filteredClubs.join(", ")}`);
      report.enriched.push({ seedName, id: best.id, name, clubs: filteredClubs, rawClubs: extracted.rawClubs });
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      report.errors.push({ seedName, error: error.message });
    }
  }

  const mergedPlayers = Array.from(existingPlayersByName.values())
    .filter((p) => (p.clubs || []).length >= 2)
    .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));
  savePlayers(mergedPlayers);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  report.finishedAt = new Date().toISOString();
  report.finalPlayerCount = mergedPlayers.length;
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log("");
  console.log(`Enriched: ${report.enriched.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Errors: ${report.errors.length}`);
  console.log(`Final players.js count: ${mergedPlayers.length}`);
  console.log(`Report: ${REPORT_FILE}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
