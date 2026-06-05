// =============================================
// PairFC Canvas Çizim Yardımcıları
// =============================================
// Sosyal medya paylaşım kartlarını üreten saf canvas fonksiyonları.
// Daha önce App.jsx içinde ~240 satır yer kaplıyordu. Buraya çıkarıldı —
// hem App.jsx küçüldü hem de bu görselleri başka context'lerde (örn.
// post-launch'ta paylaşım önizleme komponenti) yeniden kullanmak kolaylaştı.
//
// Bağımlılıklar: sadece i18n (t) ve logSwallowed. Native Canvas API kullanır,
// HTML-to-Canvas tipi ağır kütüphane gerektirmez.

import { t } from "../i18n";
import { logSwallowed } from "./errors";

// ─────────────────────────────────────────────
// Yuvarlatılmış dikdörtgen path (her yerde kullanılır)
// ─────────────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─────────────────────────────────────────────
// PairFC marka çift-kare + diamond bridge
// ─────────────────────────────────────────────
function drawBrandMark(ctx, cx, cy, size) {
  const gap = size * 0.22, r = size * 0.26, ty = cy - size / 2;
  roundRectPath(ctx, cx - size - gap / 2, ty, size, size, r);
  ctx.fillStyle = "#9b2dff"; ctx.fill();
  roundRectPath(ctx, cx + gap / 2, ty, size, size, r);
  ctx.fillStyle = "#f5a524"; ctx.fill();
  const d = size * 0.64;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  roundRectPath(ctx, -d / 2, -d / 2, d, d, d * 0.16);
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.strokeStyle = "#0e1022"; ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────────────────────
// Logo + wordmark (kartların üst kısmında)
// ─────────────────────────────────────────────
function drawWordmarkLockup(ctx, W, cy) {
  const size = 42, gap = size * 0.22, markW = 2 * size + gap, lockGap = 26;
  ctx.font = "800 62px 'Saira Semi Condensed', system-ui, 'Segoe UI', sans-serif";
  const wm = "PairFC", tw = ctx.measureText(wm).width, total = markW + lockGap + tw;
  const startX = (W - total) / 2;
  drawBrandMark(ctx, startX + markW / 2, cy, size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(wm, startX + markW + lockGap, cy + 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
}

// ─────────────────────────────────────────────
// Cam efektli CTA kutusu (kartların altında)
// ─────────────────────────────────────────────
function drawGlassCTA(ctx, W, line1, line2, y = 1560, h = 190) {
  const x = 120;
  const w = W - 240;
  const r = 40;
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
  const hg = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
  hg.addColorStop(0, "rgba(255,255,255,0.13)");
  hg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hg;
  roundRectPath(ctx, x, y, w, h * 0.55, r);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 48px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(line1, W / 2, y + h * 0.43);
  ctx.font = "700 42px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#ffd84d";
  ctx.fillText(line2, W / 2, y + h * 0.79);
}

// ─────────────────────────────────────────────
// Maraton skor kartı (1080x1920 — Instagram Story format)
// ─────────────────────────────────────────────
export function drawScoreShareCard({ score, best, diffLabel, isNewBest, matchups = [] }) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Arka plan gradyan
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#1d0738");
  g.addColorStop(0.55, "#4a1488");
  g.addColorStop(1, "#7d2fd6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Glow blob'lar — derinlik
  const glow = (cx, cy, rad, color) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    rg.addColorStop(0, color);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  };
  glow(170, 270, 640, "rgba(255,120,255,0.22)");
  glow(950, 1520, 760, "rgba(80,160,255,0.20)");

  // Silik futbol saha çizgileri (texture / oyun hissi)
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 230, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeRect(W / 2 - 260, -6, 520, 230);
  ctx.strokeRect(W / 2 - 130, -6, 260, 110);
  ctx.strokeRect(W / 2 - 260, H - 224, 520, 230);
  ctx.strokeRect(W / 2 - 130, H - 104, 260, 110);
  ctx.restore();

  // Vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";

  // Logo
  drawWordmarkLockup(ctx, W, 128);
  ctx.font = "700 28px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "center";
  ctx.fillText(t("share_maraton_label"), W / 2, 205);

  if (isNewBest) {
    ctx.font = "700 50px system-ui, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#ffd84d";
    ctx.fillText(t("share_maraton_record"), W / 2, 360);
  }

  // Büyük skor + oyunumsu etiket
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 340px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(String(score), W / 2, 770);
  ctx.font = "600 60px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(t("share_maraton_unit"), W / 2, 864);
  ctx.font = "500 40px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(t("share_maraton_stats", { d: diffLabel, b: best }), W / 2, 944);

  // Son çözülen eşleşme chip'leri
  const rows = (matchups || []).slice(0, 3).filter((m) => m && m[0] && m[1]);
  if (rows.length) {
    ctx.font = "600 34px system-ui, 'Segoe UI', Roboto, sans-serif";
    let cy = 1090;
    for (const m of rows) {
      const label = `${m[0]}   ↔   ${m[1]}`;
      const tw = ctx.measureText(label).width;
      const cw = Math.min(W - 140, tw + 76);
      const cx = (W - cw) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      roundRectPath(ctx, cx, cy - 44, cw, 72, 36);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(label, W / 2, cy + 4);
      cy += 96;
    }
  }

  drawGlassCTA(ctx, W, t("share_maraton_cta2"), "pairfc.com", 1650, 150);

  return canvas;
}

// ─────────────────────────────────────────────
// Maraton skor paylaşımı — canvas üret + Web Share / indirme
// ─────────────────────────────────────────────
// İçinde track() çağrısı YOK — çağıran kod kendi analytics event'ini atar.
// Canvas blob'a çevirir, navigator.share varsa file ile paylaşır, yoksa PNG
// indirir ve metni panoya kopyalar.
export async function shareScoreImage({ score, best, diffLabel, isNewBest, matchups = [] }) {
  const text = `🔥 PairFC Maraton: ${score} köprü üst üste! (Zorluk: ${diffLabel})\nBeni geçebilir misin? → pairfc.com`;

  let blob = null;
  try {
    const canvas = drawScoreShareCard({ score, best, diffLabel, isNewBest, matchups });
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch (e) {
    logSwallowed("share_score_canvas", e);
    blob = null;
  }

  if (blob && typeof navigator !== "undefined" && navigator.canShare) {
    const file = new File([blob], "pairfc-skor.png", { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return { shared: true, hasImage: true };
      } catch (e) {
        if (e && e.name === "AbortError") return { shared: false, hasImage: !!blob, aborted: true };
        logSwallowed("share_score_share_api", e);
      }
    }
  }

  if (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pairfc-skor.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  try {
    await navigator.clipboard?.writeText(text);
  } catch (e) {
    // clipboard permission denied vs. — silent fail OK
  }
  return { shared: false, hasImage: !!blob };
}

// ─────────────────────────────────────────────
// Günlük puzzle skor kartı
// ─────────────────────────────────────────────
export function drawDailyShareCard({ dayNum, correctCount, total, results, streak }) {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0a2a4a");
  g.addColorStop(0.55, "#1a5ba0");
  g.addColorStop(1, "#3bb0ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  drawWordmarkLockup(ctx, W, 128);
  ctx.font = "700 28px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "center";
  ctx.fillText(t("share_daily_label", { n: dayNum }), W / 2, 205);

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 300px system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(`${correctCount}/${total}`, W / 2, 720);

  const n = results.length || total;
  const sq = 130;
  const gap = 28;
  const totalW = n * sq + (n - 1) * gap;
  let x = (W - totalW) / 2;
  const y = 900;
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = results[i] === "correct" ? "#2ecc71" : "#e74c3c";
    roundRectPath(ctx, x, y, sq, sq, 24);
    ctx.fill();
    x += sq + gap;
  }

  if (streak > 1) {
    ctx.font = "700 56px system-ui, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "#ffd84d";
    ctx.fillText(t("share_daily_streak", { n: streak }), W / 2, 1230);
  }

  drawGlassCTA(ctx, W, t("share_daily_cta"), "pairfc.com");

  return canvas;
}
