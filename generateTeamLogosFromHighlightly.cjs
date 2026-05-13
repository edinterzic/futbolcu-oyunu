/**
 * Generate teamLogos.js from Highlightly team data.
 *
 * Requirements:
 * - .env.highlightly file in project root:
 *   HIGHLIGHTLY_API_KEY=...
 *
 * Run:
 *   node generateTeamLogosFromHighlightly.cjs
 *
 * Output:
 *   src/data/teamLogos.js
 *   reports/highlightly-team-logos-report.json
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://soccer.highlightly.net";
const ENV_FILE = ".env.highlightly";
const OUTPUT_FILE = path.join("src", "data", "teamLogos.js");
const REPORT_DIR = "reports";
const REPORT_FILE = path.join(REPORT_DIR, "highlightly-team-logos-report.json");
const CACHE_DIR = ".highlightly-cache";
const REQUEST_DELAY_MS = 250;

const TARGET_TEAMS = [
  { name: "Real Madrid", search: ["Real Madrid", "Real Madrid CF"], initials: "RMA", primary: "#ffffff", secondary: "#facc15" },
  { name: "Barcelona", search: ["Barcelona", "FC Barcelona"], initials: "BAR", primary: "#a50044", secondary: "#004d98" },
  { name: "Atletico Madrid", search: ["Atletico Madrid", "Atlético Madrid", "Club Atlético de Madrid"], initials: "ATM", primary: "#c8102e", secondary: "#ffffff" },
  { name: "Sevilla", search: ["Sevilla", "Sevilla FC"], initials: "SEV", primary: "#ffffff", secondary: "#d71920" },

  { name: "Milan", search: ["Milan", "AC Milan", "A.C. Milan"], initials: "MIL", primary: "#fb090b", secondary: "#000000" },
  { name: "Inter", search: ["Inter", "Inter Milan", "Internazionale"], initials: "INT", primary: "#0057b8", secondary: "#000000" },
  { name: "Juventus", search: ["Juventus", "Juventus FC"], initials: "JUV", primary: "#ffffff", secondary: "#000000" },
  { name: "Roma", search: ["Roma", "AS Roma"], initials: "ROM", primary: "#8e1f2f", secondary: "#f0bc42" },

  { name: "PSG", search: ["PSG", "Paris Saint-Germain", "Paris Saint-Germain FC"], initials: "PSG", primary: "#004170", secondary: "#da291c" },
  { name: "Lyon", search: ["Lyon", "Olympique Lyonnais"], initials: "LYO", primary: "#ffffff", secondary: "#1d428a" },
  { name: "Nice", search: ["Nice", "OGC Nice"], initials: "NIC", primary: "#d71920", secondary: "#000000" },

  { name: "Chelsea", search: ["Chelsea", "Chelsea FC"], initials: "CHE", primary: "#034694", secondary: "#ffffff" },
  { name: "Manchester United", search: ["Manchester United", "Manchester United FC", "Man United"], initials: "MUN", primary: "#da291c", secondary: "#fbe122" },
  { name: "Manchester City", search: ["Manchester City", "Manchester City FC", "Man City"], initials: "MCI", primary: "#6cabdd", secondary: "#ffffff" },
  { name: "Liverpool", search: ["Liverpool", "Liverpool FC"], initials: "LIV", primary: "#c8102e", secondary: "#00b2a9" },
  { name: "Tottenham", search: ["Tottenham", "Tottenham Hotspur", "Tottenham Hotspur FC"], initials: "TOT", primary: "#132257", secondary: "#ffffff" },
  { name: "Arsenal", search: ["Arsenal", "Arsenal FC"], initials: "ARS", primary: "#ef0107", secondary: "#ffffff" },

  { name: "Ajax", search: ["Ajax", "AFC Ajax"], initials: "AJA", primary: "#ffffff", secondary: "#d2122e" },

  { name: "Beşiktaş", search: ["Beşiktaş", "Besiktas", "Beşiktaş JK", "Besiktas JK"], initials: "BJK", primary: "#000000", secondary: "#ffffff" },
  { name: "Fenerbahçe", search: ["Fenerbahçe", "Fenerbahce", "Fenerbahçe SK", "Fenerbahce SK"], initials: "FB", primary: "#002d72", secondary: "#fedd00" },
  { name: "Galatasaray", search: ["Galatasaray", "Galatasaray SK"], initials: "GS", primary: "#a90432", secondary: "#fdb912" },
  { name: "Trabzonspor", search: ["Trabzonspor"], initials: "TS", primary: "#781f35", secondary: "#55acee" },
  { name: "Başakşehir", search: ["Başakşehir", "Basaksehir", "Istanbul Basaksehir", "İstanbul Başakşehir"], initials: "IBFK", primary: "#f58220", secondary: "#003b79" },
  { name: "Sivasspor", search: ["Sivasspor", "Sivasspor Kulübü"], initials: "SIV", primary: "#d71920", secondary: "#ffffff" },
  { name: "Kayserispor", search: ["Kayserispor"], initials: "KAY", primary: "#e31b23", secondary: "#ffd100" },
  { name: "Antalyaspor", search: ["Antalyaspor"], initials: "ANT", primary: "#e30613", secondary: "#ffffff" }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(`${ENV_FILE} bulunamadı. İçine HIGHLIGHTLY_API_KEY=... yazmalısın.`);
  }

  const env = {};
  const content = fs.readFileSync(ENV_FILE, "utf8");

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
    throw new Error(`${ENV_FILE} içinde HIGHLIGHTLY_API_KEY yok.`);
  }

  return env;
}

function ensureGitIgnore() {
  const gitignorePath = ".gitignore";
  const linesToAdd = [".highlightly-cache/", "reports/highlightly-team-logos-report.json"];
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

function cachePathFor(query) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `team-search-${normalizeText(query)}.json`);
}

async function apiGet(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-rapidapi-key": apiKey
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  return text ? JSON.parse(text) : null;
}

async function searchTeam(query, apiKey) {
  const cachePath = cachePathFor(query);

  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  }

  const urlsToTry = [
    `${BASE_URL}/teams?name=${encodeURIComponent(query)}&limit=10&offset=0`,
    `${BASE_URL}/teams?search=${encodeURIComponent(query)}&limit=10&offset=0`
  ];

  let lastError = null;

  for (const url of urlsToTry) {
    try {
      const data = await apiGet(url, apiKey);
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
      await sleep(REQUEST_DELAY_MS);
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function unwrapList(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.teams)) return response.teams;
  return [];
}

function getLogo(team) {
  return (
    team?.logo ||
    team?.logoUrl ||
    team?.image ||
    team?.imageUrl ||
    team?.crest ||
    team?.crestUrl ||
    team?.badge ||
    team?.badgeUrl ||
    ""
  );
}

function getName(team) {
  return team?.name || team?.fullName || team?.teamName || team?.title || "";
}

function scoreCandidate(candidate, targetName, query) {
  const candidateName = normalizeText(getName(candidate));
  const target = normalizeText(targetName);
  const q = normalizeText(query);

  if (!candidateName) return 0;
  if (candidateName === target) return 100;
  if (candidateName === q) return 90;
  if (candidateName.includes(target) || target.includes(candidateName)) return 75;
  if (candidateName.includes(q) || q.includes(candidateName)) return 65;
  return 10;
}

async function findTeamLogo(target, apiKey) {
  const tried = [];

  for (const query of target.search) {
    const response = await searchTeam(query, apiKey);
    const list = unwrapList(response);

    tried.push({
      query,
      count: list.length,
      names: list.slice(0, 5).map((item) => getName(item))
    });

    if (!list.length) continue;

    const best = list
      .map((item) => ({ item, score: scoreCandidate(item, target.name, query) }))
      .sort((a, b) => b.score - a.score)[0];

    const logo = getLogo(best.item);

    if (best && best.score >= 60 && logo) {
      return {
        logo,
        matchedName: getName(best.item),
        id: best.item.id || best.item.teamId || null,
        tried
      };
    }
  }

  return {
    logo: "",
    matchedName: "",
    id: null,
    tried
  };
}

async function main() {
  ensureGitIgnore();
  const { HIGHLIGHTLY_API_KEY } = readEnvFile();

  const output = {};
  const report = {
    startedAt: new Date().toISOString(),
    found: [],
    missing: []
  };

  console.log(`Takım sayısı: ${TARGET_TEAMS.length}`);
  console.log("");

  for (const team of TARGET_TEAMS) {
    try {
      console.log(`Searching logo: ${team.name}`);
      const result = await findTeamLogo(team, HIGHLIGHTLY_API_KEY);

      output[team.name] = {
        initials: team.initials,
        primary: team.primary,
        secondary: team.secondary,
        logo: result.logo || ""
      };

      if (result.logo) {
        console.log(`  found: ${result.matchedName} -> ${result.logo}`);
        report.found.push({
          team: team.name,
          matchedName: result.matchedName,
          id: result.id,
          logo: result.logo
        });
      } else {
        console.log("  missing logo");
        report.missing.push({
          team: team.name,
          tried: result.tried
        });
      }
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);

      output[team.name] = {
        initials: team.initials,
        primary: team.primary,
        secondary: team.secondary,
        logo: ""
      };

      report.missing.push({
        team: team.name,
        error: error.message
      });
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `export const TEAM_LOGOS = ${JSON.stringify(output, null, 2)};\n`,
    "utf8"
  );

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log("");
  console.log(`Found logos: ${report.found.length}`);
  console.log(`Missing logos: ${report.missing.length}`);
  console.log(`File updated: ${OUTPUT_FILE}`);
  console.log(`Report: ${REPORT_FILE}`);
  console.log("");
  console.log("Şimdi npm run dev ile test et.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
