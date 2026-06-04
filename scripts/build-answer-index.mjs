#!/usr/bin/env node
// =============================================
// scripts/build-answer-index.mjs
// =============================================
// players.js + teamLogos.js'ten src/data/answerIndex.js'i yeniden üretir.
//
// Kullanım:
//   npm run build-data           — manuel
//   npm run build                — otomatik (prebuild hook ile)
//
// Bu script'in görevi: tüm geçerli takım çiftlerini bulup, her birinin
// ortak oyuncu listesini "TeamA|TeamB": ["Player 1", ...] formatında yazar.
// App.jsx WEIGHTED_TEAM_PAIRS bu cache'ten okur.
//
// HER players.js veya teams.js/teamLogos.js DEĞİŞİKLİĞİNDEN SONRA ÇALIŞMASI ŞART.
// CI'da prebuild hook olarak otomatik çalışır; manuel deploy öncesi de.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PLAYERS_PATH = path.join(ROOT, "src/data/players.js");
const TEAM_LOGOS_PATH = path.join(ROOT, "src/data/teamLogos.js");
const OUT_PATH = path.join(ROOT, "src/data/answerIndex.js");

// Pretty stderr — Vercel logs için
function log(level, msg) {
  const prefix = { info: "ℹ ", ok: "✓ ", warn: "⚠ ", err: "✗ " }[level] || "  ";
  const target = level === "err" ? process.stderr : process.stdout;
  target.write(`[build-answer-index] ${prefix}${msg}\n`);
}

async function loadModule(filePath, exportName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dosya bulunamadı: ${filePath}`);
  }
  const url = pathToFileURL(filePath).href;
  const mod = await import(url);
  if (!(exportName in mod)) {
    throw new Error(`${path.basename(filePath)} dosyasında '${exportName}' export'u yok`);
  }
  return mod[exportName];
}

async function main() {
  const startedAt = Date.now();
  log("info", `Başlıyor: ${path.relative(ROOT, PLAYERS_PATH)} + ${path.relative(ROOT, TEAM_LOGOS_PATH)}`);

  const PLAYERS = await loadModule(PLAYERS_PATH, "PLAYERS");
  const TEAM_LOGOS = await loadModule(TEAM_LOGOS_PATH, "TEAM_LOGOS");

  if (!Array.isArray(PLAYERS)) {
    throw new Error("PLAYERS dizi değil");
  }
  if (typeof TEAM_LOGOS !== "object" || !TEAM_LOGOS) {
    throw new Error("TEAM_LOGOS obje değil");
  }

  log("info", `Yüklendi: ${PLAYERS.length} oyuncu, ${Object.keys(TEAM_LOGOS).length} takım`);

  const validTeams = new Set(Object.keys(TEAM_LOGOS));

  // Çift -> oyuncu listesi
  // Key formatı: gameData.js'teki getPairKey ile uyumlu: alfabetik küçük olan önce
  const pairData = new Map();
  let skippedNoName = 0;
  let skippedInvalidTeam = new Set();

  for (const p of PLAYERS) {
    const name = p?.name;
    if (!name) { skippedNoName++; continue; }
    const rawClubs = Array.isArray(p.clubs) ? p.clubs : [];
    const clubs = [];
    for (const c of rawClubs) {
      if (validTeams.has(c)) {
        clubs.push(c);
      } else if (c) {
        skippedInvalidTeam.add(c);
      }
    }
    const unique = [...new Set(clubs)].sort();
    if (unique.length < 2) continue;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!pairData.has(key)) pairData.set(key, []);
        pairData.get(key).push(name);
      }
    }
  }

  if (skippedNoName > 0) {
    log("warn", `${skippedNoName} oyuncuda 'name' alanı boş — atlandı`);
  }
  if (skippedInvalidTeam.size > 0) {
    log("warn", `${skippedInvalidTeam.size} bilinmeyen takım ismi (teamLogos.js'te yok): ${[...skippedInvalidTeam].slice(0, 5).join(", ")}${skippedInvalidTeam.size > 5 ? ", ..." : ""}`);
  }

  // Dedupe + sırala her çift için
  const finalIndex = {};
  let totalEntries = 0;
  let pairsAtLeast2 = 0;
  for (const [key, names] of pairData.entries()) {
    const unique = [...new Set(names)].sort();
    finalIndex[key] = unique;
    totalEntries += unique.length;
    if (unique.length >= 2) pairsAtLeast2++;
  }

  // Çıktı dosyası
  const header = [
    "// Auto-generated answer index — DO NOT EDIT MANUALLY",
    "// Source: players.js + teamLogos.js",
    `// Generated: ${new Date().toISOString()}`,
    `// Pairs: ${Object.keys(finalIndex).length} total, ${pairsAtLeast2} with >=2 shared players`,
    `// Total answer entries: ${totalEntries}`,
    "",
    "export const ANSWER_INDEX = "
  ].join("\n");

  // JSON tek satır per top-level property (okunabilir + diff-friendly)
  const body = JSON.stringify(finalIndex, null, 0);
  const content = header + body + ";\n";

  fs.writeFileSync(OUT_PATH, content, "utf8");
  const sizeMB = (Buffer.byteLength(content) / 1024 / 1024).toFixed(2);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

  log("ok", `${path.relative(ROOT, OUT_PATH)} yazıldı — ${sizeMB} MB, ${elapsed}s`);
  log("ok", `Toplam ${Object.keys(finalIndex).length} çift, ${pairsAtLeast2} tanesi >=2 ortak oyuncuya sahip`);
}

main().catch((err) => {
  log("err", `HATA: ${err.message}`);
  if (err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  process.exit(1);
});
