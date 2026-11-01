// Small shared helpers (no dependencies, so they are easy to test).

const clockFmt = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** 1761370800000 -> "11:30 AM" (always IST, whatever the phone's time zone is). */
export const clock = (ts) => (ts == null ? "–" : clockFmt.format(new Date(ts)).toUpperCase());

const hourFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
/** Current hour (0-23) in IST. */
export const istHour = () => Number(hourFmt.format(new Date())) % 24;

/** Pick the Kannada text when the UI is in Kannada and it exists. */
export const pick = (lang, en, kn) => (lang === "kn" && kn ? kn : en);

/** "late" | "early" | "onTime" plus the whole-minute amount. */
export function delayInfo(min) {
  const n = Math.round(Math.abs(min ?? 0));
  if (n < 1) return { key: "onTime", n: 0, tone: "ok" };
  return min > 0 ? { key: "late", n, tone: n >= 6 ? "bad" : "warn" } : { key: "early", n, tone: "ok" };
}

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const levelOf = (pct) => (pct < 50 ? "low" : pct < 80 ? "medium" : "high");

  export const ROUTE_COLORS = ["#0b2a5b", "#0f8b8d", "#3d5afe", "#6a4c93", "#2f6fb5"];
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The stop whose name (English or Kannada) or alias exactly equals what the person typed, else null. */
export function matchStop(stops, text) {
  const q = norm(text);
  if (!q) return null;
  return stops.find((s) => norm(s.name) === q || norm(s.nameKn) === q || (s.aliases || []).some((a) => norm(a) === q)) ?? null;
}

/**
 * The person's trip on one live bus, from the bus's own data:
 *   board: null (no boarding stop given) | { kind: "gone" } | { kind: "at" | "next" | "ahead", stop, away }
 *   dest:  the destination stop entry if the bus has not reached it yet, else null
 */
export function tripOn(bus, fromId, toId) {
  const next = bus.nextStops || [];
  const f = fromId ? next.find((s) => s.stopId === fromId) : null;
  let board = null;
  if (fromId) {
    if (!f) board = { kind: "gone" };
    else if (f.atStop) board = { kind: "at", stop: f, away: 0 };
    else {
      const away = f.seq - (next[0]?.seq ?? f.seq);
      board = { kind: away <= 0 ? "next" : "ahead", stop: f, away };
    }
  }
  return { board, dest: (toId && next.find((s) => s.stopId === toId)) || null };
}