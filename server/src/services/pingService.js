import { StopDetector } from "./stopDetector.js";
import { getStatic, setLive, addStopEvent, addCrowdLog } from "./dataService.js";
import { predictStops } from "./etaService.js";
  import { pctOf, levelOf, predictCrowd, learnCrowd } from "./crowdService.js";
import { orient } from "../utils/route.js";
import { pointAtDistance } from "../utils/geo.js";
import { istParts } from "../utils/time.js";
import { HttpError } from "../utils/http.js";
import { env } from "../config/env.js";
import { calculateSeatOccupancy } from "./occupancy.js";

export const detector = new StopDetector();
const lastCrowdLog = new Map();

/**
 * The one pipeline every GPS ping goes through (driver app or simulator):
 *   ping -> stop detection (ARRIVED / DEPARTED) -> ETA per stop -> crowd level -> write bus_live
 */
export async function processPing(p) {
  const now = p.ts ?? Date.now();
  const { routes } = await getStatic();
  const base = routes[p.routeId];
  if (!base) throw new HttpError(400, `Unknown routeId "${p.routeId}"`);
  const route = orient(base, p.direction);

  const tripId = `${p.routeId}_${p.direction}_${p.tripStartTs}_${p.busId}`;
  const ping = { ...p, tripId, ts: now, accuracyM: p.accuracyM ?? 10 };
  const { events, state: st, ignored } = detector.update(route, ping);
  if (ignored) return { ignored };

  const source = p.source ?? "driver";
  for (const ev of events) {
    addStopEvent({ ...ev, mlId: base.mlId, source }).catch((e) => console.error("[stop_events]", e.message));
  }

  const nextStops = predictStops(route, st, now, p.tripStartTs);

  // Crowd: use the sensor / conductor count when we have one, otherwise the ML forecast.
  const capacity = p.capacity ?? 60;
  const seatCapacity = p.seatCapacity ?? null;
  const standingPassengers = p.standingPassengers ?? null;
  let occupancy = p.occupancy ?? null;
  let occupancySource = p.occupancySource ?? (source === "simulator" ? "simulated" : "sensor");
  let pct;
  if (occupancy == null) {
    const [f] = await predictCrowd([{ mlId: base.mlId, routeId: base.id, seq: Math.min(st.nextIdx, route.stops.length - 1), ts: now }]);
    pct = f.pct;
    occupancy = Math.round((pct * capacity) / 100);
    occupancySource = "forecast";
  } else {
    pct = pctOf(occupancy, capacity);
  }
  const seatOccupancy =
    occupancySource !== "forecast" && seatCapacity != null && standingPassengers != null && occupancy != null
      ? calculateSeatOccupancy({ occupiedPassengers: occupancy, seatCapacity, standingPassengers })
      : null;

  // Keep a crowd history for retraining (never from the simulator by default).
  if (occupancySource !== "forecast" && now - (lastCrowdLog.get(p.busId) ?? 0) > 60_000) {
    lastCrowdLog.set(p.busId, now);
    const t = istParts(now);
          if (source !== "simulator" && occupancySource !== "simulated") learnCrowd({ routeId: base.id, weekday: t.weekday, hour: t.hour, pct });
    addCrowdLog({
      routeId: base.id,
      mlId: base.mlId,
      stopSeq: Math.min(st.nextIdx, route.stops.length - 1) + 1,
      hour: t.hour,
      weekday: t.weekday,
      isFestival: env.festivalMode ? 1 : 0,
      isRaining: 0,
      occupancyPct: pct,
      occupancySource,
      source,
      ts: now,
    }).catch((e) => console.error("[crowd_logs]", e.message));
  }

  const nxt = nextStops[0];
  const delayMin = nxt ? Math.round((nxt.predictedTs - nxt.scheduledTs) / 60_000) : Math.round(st.lastEvent?.delayMin ?? 0);

  const doc = {
    busId: p.busId,
    routeId: base.id,
    routeNumber: base.number,
    routeName: base.name,
    routeNameKn: base.nameKn,
    direction: p.direction,
    towards: route.towards,
    towardsKn: route.towardsKn,
    tripId,
    tripStartTs: p.tripStartTs,
    lat: p.lat,
    lng: p.lng,
    speedKmh: Math.round(p.speedKmh * 10) / 10,
    heading: Math.round(pointAtDistance(route.polyline, route.cum, st.alongM).heading),
    occupancy,
    capacity,
    seatCapacity,
    standingPassengers,
    occupiedSeats: seatOccupancy?.occupiedSeats ?? null,
    availableSeats: seatOccupancy?.availableSeats ?? null,
    seatOccupancyPct: seatOccupancy?.occupancyPct ?? null,
    crowdStatus: seatOccupancy?.crowdStatus ?? null,
    occupancyPct: pct,
    crowdLevel: levelOf(pct),
    occupancySource,
    status: st.status,
    currentStopName: st.status === "AT_STOP" ? route.stops[st.nextIdx]?.name : null,
    nextStopId: nxt?.stopId ?? null,
    nextStopName: nxt?.name ?? null,
    delayMin,
    lastEvent: st.lastEvent,
    passed: st.passed,
    nextStops,
    source,
    updatedAt: now,
  };

  // Realtime DB rejects undefined values and NaN, so normalise through JSON.
  const clean = JSON.parse(JSON.stringify(doc));
  await setLive(p.busId, clean);
  return clean;
}
