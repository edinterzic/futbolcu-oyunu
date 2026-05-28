// PairFC — Günlük hatırlatma push'u gönderir.
// GitHub Actions (cron) veya elle çalıştırılır.
// Gerekli env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//              VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:iletisim@pairfc.com",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("❌ Eksik env değişkeni var. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY gerekli.");
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MESSAGES = {
  tr: { title: "PairFC", body: "Bugünün bulmacası seni bekliyor — 5 yeni eşleşme! 🔥" },
  en: { title: "PairFC", body: "Today's puzzle is waiting — 5 new pairs! 🔥" },
};

async function main() {
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("*");

  if (error) {
    console.error("❌ Abonelikler okunamadı:", error.message);
    process.exit(1);
  }
  if (!subs || subs.length === 0) {
    console.log("Abone yok, çıkılıyor.");
    return;
  }

  console.log(`📨 ${subs.length} aboneye gönderiliyor...`);
  let sent = 0, removed = 0, failed = 0;

  for (const sub of subs) {
    const msg = MESSAGES[sub.lang === "en" ? "en" : "tr"];
    const payload = JSON.stringify({
      title: msg.title,
      body: msg.body,
      url: "/",
      tag: "pairfc-daily",
      lang: sub.lang || "tr",
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err) {
      // 404/410 = abonelik artık geçersiz → sil
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        removed++;
      } else {
        failed++;
        console.warn("Gönderim hatası:", err.statusCode, err.body || err.message);
      }
    }
  }

  console.log(`✅ Bitti. Gönderildi: ${sent}, Silinen (geçersiz): ${removed}, Hatalı: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
