import { mlPost } from "./mlClient.js";
import { istParts } from "../utils/time.js";

const DWELL_S = 30; // assumed stop time when we have no better number
const FALLBACK_KMH = 17; // typical Mysuru city-bus running speed
const RATE_TTL_MS = 30_000;

/**
 * Ask the ML service how long each remaining segment normally takes at this hour/weekday.
 * Runs in the background so a slow ML service never delays a GPS ping; until the answer
 * arrives (or if the service is down) we use the speed-based estimate.
 */
function refreshRates(route, st, now) {
  if (st.ratesPending || (st.rates && now - st.rates.at < RATE_TTL_MS)) return;
  const idxs = [];
  for (let j = Math.max(st.nextIdx, 1); j < route.stops.length; j++) idxs.push(j);
  if (!idxs.length) return;

  const p = istParts(now);
  const segM = idxs.map((j) => Math.max(50, Math.round(route.stops[j].alongM - route.stops[j - 1].alongM)));
  st.ratesPending = true;
  mlPost("/predict/eta", {
    items: idxs.map((j, k) => ({ route_id: route.mlId, hour: p.hour, weekday: p.weekday, segment_m: segM[k] })),
  })
    .then((r) => {
      const byIdx = {};
      idxs.forEach((j, k) => (byIdx[j] = r.predictions[k].travel_sec / segM[k])); // seconds per metre
      st.rates = { at: Date.now(), byIdx, source: "ml", modelData: r.model_data };
    })
    .catch(() => {
      st.rates = { at: Date.now(), byIdx: {}, source: "heuristic" };
    })
    .finally(() => {
      st.ratesPending = false;
    });
}

/**
 * Predicted arrival/departure time at every remaining stop of the trip.
 * `margin` is a simple ±min heuristic that grows with distance; replace it with the model's
 * validation error once you have real logged trips.
 */
export function predictStops(route, st, now, tripStartTs) {
  const n = route.stops.length;
  const out = [];
  if (st.status === "TRIP_ENDED" || st.nextIdx >= n) return out;

  refreshRates(route, st, now);

  const liveKmh = st.speedEma > 8 ? 0.5 * st.speedEma + 0.5 * FALLBACK_KMH : FALLBACK_KMH;
  const heurRate = 1 / (liveKmh / 3.6); // seconds per metre from current speed

  let t = now;
  let pos = st.alongM;

  for (let j = st.nextIdx; j < n; j++) {
    const stop = route.stops[j];
    let arrTs;
    let depTs;
    let atStop = false;

    if (j === st.nextIdx && st.status === "AT_STOP") {
      atStop = true;
      arrTs = st.arrivedAt;
      depTs = Math.max(now, st.arrivedAt + DWELL_S * 1000);
      pos = stop.alongM;
    } else {
      const lenM = Math.max(0, stop.alongM - pos);
      let rate = st.rates?.byIdx?.[j] ?? heurRate;
      // For the segment the bus is on right now, trust its live speed as much as the history.
      if (j === st.nextIdx && st.rates?.byIdx?.[j] != null) rate = 0.5 * rate + 0.5 * heurRate;
      arrTs = t + lenM * rate * 1000;
      depTs = arrTs + DWELL_S * 1000;
      pos = Math.max(pos, stop.alongM);
    }
    t = depTs;

    const etaMin = Math.max(0, (arrTs - now) / 60_000);
    out.push({
      stopId: stop.id,
      name: stop.name,
      nameKn: stop.nameKn,
      seq: j + 1,
      stopsAway: j - st.nextIdx,
      atStop,
      scheduledTs: Math.round(tripStartTs + stop.offsetMin * 60_000),
      scheduledDepTs: Math.round(tripStartTs + stop.departOffsetMin * 60_000),
      predictedTs: Math.round(arrTs),
      predictedDepTs: Math.round(depTs),
      marginMin: atStop ? 0 : Math.max(1, Math.round(0.1 * etaMin + 0.5)),
    });
  }
  return out;
}
