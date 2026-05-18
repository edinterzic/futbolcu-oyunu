// =================== ANALYTICS (PostHog) ===================
// Anonim event tracking. Kullanıcı adı veya kimlik bilgisi gönderilmez.
//
// Tracked events:
//   - mode_started           (mode: "challenge"|"daily"|"online")
//   - challenge_finished     (score, isNewBest, duration_seconds)
//   - daily_completed        (correct, total, streak, duration_seconds)
//   - daily_shared           (method: "native"|"clipboard"|"failed")
//   - room_created           (target_score)
//   - room_joined            (room_code)
//   - online_match_completed (won, own_score, opponent_score, rounds_played)
//   - correct_answer         (mode, team_a, team_b, time_left_seconds)
//   - wrong_answer           (mode, team_a, team_b, attempted_name)
//   - joker_used             (type: "firstLetter"|"swap"|"timeAdd")
//   - report_submitted       (mode, type: "wrong_explanation"|"accepted_player")

import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";

let initialized = false;

export function initAnalytics() {
  if (initialized) return;
  if (!POSTHOG_KEY) {
    console.warn("[analytics] VITE_POSTHOG_KEY not set, tracking disabled");
    return;
  }
  // Admin paneline tracking yapma
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    return;
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // Sadece kendi event'lerimiz
    persistence: "localStorage",
    disable_session_recording: true, // Bandwidth tasarrufu
    loaded: (ph) => {
      // Kullanıcıya rastgele anonim id verilir (kalıcı, cihaz bazında)
      // ph.identify() çağırmıyoruz — anonim kalıyor
    }
  });
  initialized = true;
}

export function track(eventName, properties = {}) {
  if (!initialized) return;
  try {
    posthog.capture(eventName, properties);
  } catch (e) {
    // Silent fail — analytics oyunu bloklamamalı
  }
}

// Daily/Challenge başlangıç zamanı (duration için)
const sessionStartTimes = {};

export function startTimer(key) {
  sessionStartTimes[key] = Date.now();
}

export function endTimer(key) {
  const start = sessionStartTimes[key];
  if (!start) return 0;
  delete sessionStartTimes[key];
  return Math.round((Date.now() - start) / 1000);
}
