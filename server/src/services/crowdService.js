import { env } from "../config/env.js";
import { mlPost } from "./mlClient.js";
import { istParts } from "../utils/time.js";

export const levelOf = (pct) => (pct < 50 ? "low" : pct < 80 ? "medium" : "high");

export const pctOf = (count, capacity) =>
  capacity > 0 ? Math.max(0, Math.min(100, Math.round((100 * count) / capacity))) : null;

/** Rule-of-thumb crowd estimate, used only when the ML service is down. */
export function heuristicCrowd({ hour, weekday, mlId, festival = env.festivalMode }) {
  let pct = 30;
  if ([8, 9, 10, 17, 18, 19].includes(hour)) pct += 30;
  if (weekday >= 5 && mlId === 1) pct += 15; // Chamundi Hills on weekends
  if (festival) pct += 20;
  return Math.max(0, Math.min(100, pct));
}

// ---- Learned crowd: what conductors really counted on THIS route at this hour (any route, no retraining).
// The ML model only knows a few routes. For every other route the numbers below are blended in as soon
// as there are enough real counts, so each route slowly gets its own pattern.
const MIN_SAMPLES = 5;
const learned = new Map(); // "routeId|weekend?|hour" -> { sum, n }
const learnKey = (routeId, weekday, hour) => `${routeId}|${weekday >= 5 ? "we" : "wd"}|${hour}`;
let warmed = null;

/** Remember one real count. Never call this with simulated or forecast numbers. */
export function learnCrowd({ routeId, weekday, hour, pct }) {
  if (!routeId || pct == null) return;
  const k = learnKey(routeId, weekday, hour);
  const e = learned.get(k) ?? { sum: 0, n: 0 };
  e.sum += pct;
  e.n += 1;
  learned.set(k, e);
}

/** Load past real counts once after a restart. Safe to call often; failures are ignored. */
export function warmLearned() {
  warmed ??= import("./dataService.js") // loaded only when needed, so the pure functions here stay easy to test
    .then((m) => m.getCrowdLogs())
    .then((rows) => {
      for (const r of rows) {
        if (r.source === "simulator" || r.occupancySource === "simulated" || r.occupancySource === "forecast") continue;
        learnCrowd({ routeId: r.routeId, weekday: r.weekday, hour: r.hour, pct: r.occupancyPct });
      }
    })
    .catch(() => {});
  return warmed;
}

/** Blend the generic prediction with the route's own real counts (more counts -> more weight, max 80%). */
export function blendLearned(base, routeId, weekday, hour) {
  const e = routeId ? learned.get(learnKey(routeId, weekday, hour)) : null;
  if (!e || e.n < MIN_SAMPLES) return base;
  const w = Math.min(0.8, e.n / (e.n + 10));
  const pct = Math.max(0, Math.min(100, Math.round(w * (e.sum / e.n) + (1 - w) * base.pct)));
  return { pct, level: levelOf(pct), source: "learned", modelData: `${e.n} real conductor counts on this route at this hour, blended with the general estimate (${base.modelData})` };
}

const cache = new Map(); // key -> { at, value }
const TTL = 10 * 60_000;

/**
 * Predicted occupancy % for [{ mlId, seq, ts }, ...].
 * Returns [{ pct, level, source: "ml" | "heuristic" | "learned", modelData }]. items may carry routeId for the learned layer.
 */
export async function predictCrowd(items) {
  await warmLearned();
  const out = new Array(items.length);
  const todo = [];
  const now = Date.now();

  items.forEach((it, i) => {
    const p = istParts(it.ts);
    const key = `${it.mlId}|${it.seq}|${p.hour}|${p.weekday}|${env.festivalMode}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL) out[i] = hit.value;
    else todo.push({ i, key, p, it });
  });

  if (todo.length) {
    let ml = null;
    try {
      const body = {
        items: todo.map(({ p, it }) => ({
          route_id: it.mlId,
          stop_seq: it.seq + 1,
          hour: p.hour,
          weekday: p.weekday,
          is_festival: env.festivalMode ? 1 : 0,
          is_raining: 0,
        })),
      };
      ml = (await mlPost("/predict/crowd/batch", body)).predictions;
    } catch {
      ml = null;
    }
    todo.forEach(({ i, key, p, it }, k) => {
      const value = ml?.[k]
        ? { pct: Math.round(ml[k].occupancy_pct), level: levelOf(ml[k].occupancy_pct), source: "ml", modelData: ml[k].model_data }
        : (() => {
            const pct = heuristicCrowd({ hour: p.hour, weekday: p.weekday, mlId: it.mlId });
            return { pct, level: levelOf(pct), source: "heuristic", modelData: "rule-of-thumb" };
          })();
      cache.set(key, { at: now, value });
      out[i] = value;
    });
  }
  // The cache holds only the general estimate; the route's own learned numbers are applied fresh each time.
  return out.map((v, i) => {
    const p = istParts(items[i].ts);
    return blendLearned(v, items[i].routeId, p.weekday, p.hour);
  });
}

/** Hourly crowd forecast (06:00-21:00) for one stop of an oriented route on the day of dayTs. */
export async function forecastDay(oriented, seq, dayTs) {
  const hours = Array.from({ length: 16 }, (_, k) => 6 + k);
  const preds = await predictCrowd(hours.map((h) => ({ mlId: oriented.mlId, routeId: oriented.id, seq, ts: dayTs + h * 3_600_000 + 1_800_000 })));
  return { hours, values: preds.map((p) => p.pct), source: preds[0]?.source, modelData: preds[0]?.modelData };
}