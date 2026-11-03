import { readFileSync } from "node:fs";
import { usingMemory, rtdb, db } from "../config/firebase.js";
import { buildRoute } from "../utils/route.js";

const dataDir = new URL("../../data/", import.meta.url);
const readSeed = (f) => JSON.parse(readFileSync(new URL(f, dataDir), "utf8"));

/** A bus that has not reported for this long is treated as offline. */
export const STALE_MS = 120_000;

// In-memory backend (USE_MEMORY_DB=true): live positions, event log, crowd log.
const mem = { live: {}, events: [], crowd: [] };

// ---------------------------------------------------------------- static data
let cache = null;
let cacheAt = 0;
export function invalidateStaticCache() {
  cache = null;
  cacheAt = 0;
}

function makeStatic({ stops: stopRows, routes: routeRows, timetables = [], trips = [], services = {}, metadata = null }) {
  const stops = Object.fromEntries(stopRows.map((stop) => [stop.id, stop]));
  const timetableByRoute = Object.fromEntries(timetables.map((item) => [item.routeId ?? item.id, item]));
  const tripsByRoute = new Map();
  for (const trip of trips) {
    const routeTrips = tripsByRoute.get(trip.routeId) ?? [];
    routeTrips.push(trip);
    tripsByRoute.set(trip.routeId, routeTrips);
  }
  const routes = Object.fromEntries(routeRows.map((row) => {
    const route = buildRoute(row, stops, timetableByRoute[row.id]);
    route.gtfsTrips = (tripsByRoute.get(row.id) ?? []).map((trip) => ({
      ...trip,
      service: metadata?.services?.[trip.serviceId] ?? null,
    }));
    route.serviceCalendarAvailable = metadata?.serviceCalendarAvailable ?? false;
    route.timezone = metadata?.timezone ?? "Asia/Kolkata";
    return [row.id, route];
  }));
  return { stops, routes, routeList: Object.values(routes), metadata };
}

async function loadImportedRaw() {
  if (!db || usingMemory) return { stops: [], routes: [], trips: [], services: {}, metadata: null };
  const active = await db.collection("gtfs").doc("active").get();
  if (!active.exists || !active.data()?.feedId) return { stops: [], routes: [], trips: [], services: {}, metadata: null };
  const { feedId, ...metadata } = active.data();
  const feed = db.collection("gtfs_feeds").doc(feedId);
  const read = async (name) => (await feed.collection(name).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const [stops, routes, trips, serviceRows] = await Promise.all([
    read("stops"),
    read("routes"),
    read("trips"),
    read("services"),
  ]);
  return {
    stops,
    routes,
    trips,
    services: Object.fromEntries(serviceRows.map(({ serviceId, ...service }) => [serviceId, service])),
    metadata: {
      ...metadata,
      feedId,
      services: Object.fromEntries(serviceRows.map(({ serviceId, ...service }) => [serviceId, service])),
    },
  };
}

/** Stops, routes (with polylines and timetable) — cached for 5 minutes. */
export async function getStatic(force = false) {
  if (cache && !force && Date.now() - cacheAt < 5 * 60_000) return cache;
  const raw = await loadImportedRaw();
  cache = makeStatic({ ...raw, timetables: [], metadata: raw.metadata });
  cacheAt = Date.now();
  return cache;
}

let practiceCache = null;
export async function getPracticeStatic(force = false) {
  if (practiceCache && !force) return practiceCache;
  practiceCache = makeStatic({
    stops: readSeed("stops.seed.json"),
    routes: readSeed("routes.seed.json"),
    timetables: readSeed("schedule.seed.json"),
  });
  return practiceCache;
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Fuzzy stop lookup by id, English name, Kannada name or alias. */
export async function findStop(query) {
  const { stops } = await getStatic();
  if (stops[query]) return { stop: stops[query], alternatives: [] };
  const q = norm(query);
  if (!q) return { stop: null, alternatives: Object.values(stops).slice(0, 5) };
  const qTokens = q.split(" ");

  const scored = Object.values(stops).map((s) => {
    const names = [s.name, s.nameKn, ...(s.aliases ?? [])].map(norm).filter(Boolean);
    let score = 0;
    for (const n of names) {
      if (n === q) score = Math.max(score, 100);
      else if (n.startsWith(q) || q.startsWith(n)) score = Math.max(score, 75);
      else if (n.includes(q) || q.includes(n)) score = Math.max(score, 60);
      else {
        const nt = n.split(" ");
        const hit = qTokens.filter((t) => t.length > 2 && nt.some((x) => x.startsWith(t) || t.startsWith(x))).length;
        score = Math.max(score, (hit / Math.max(qTokens.length, 1)) * 45);
      }
    }
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return {
    stop: best.score >= 40 ? best.s : null,
    alternatives: scored.slice(best.score >= 40 ? 1 : 0, 4).map((x) => x.s),
  };
}

/** Route lookup by number ("201") or id ("r201"). */
export async function findRoute(q) {
  const { routeList } = await getStatic();
  const s = String(q ?? "").trim().toLowerCase();
  return routeList.find((r) => r.number.toLowerCase() === s || r.id.toLowerCase() === s) ?? null;
}

// ---------------------------------------------------------------- live buses
export async function readLive() {
  if (usingMemory) return mem.live;
  const snap = await rtdb.ref("bus_live").get();
  return snap.val() || {};
}

export async function setLive(busId, doc) {
  if (usingMemory) {
    mem.live[busId] = doc;
    return;
  }
  await rtdb.ref(`bus_live/${busId}`).set(doc);
}

export async function deleteLive(busId) {
  if (usingMemory) {
    delete mem.live[busId];
    return;
  }
  await rtdb.ref(`bus_live/${busId}`).remove();
}

/** Live buses that reported recently. Optional filters: routeNumber, routeId. */
export async function getLiveBuses({ routeNumber, routeId } = {}) {
  const now = Date.now();
  const { routes } = await getStatic();
  const activeRouteIds = new Set(Object.keys(routes));
  let list = Object.values(await readLive())
    .filter((b) => b && b.source !== "simulator" && activeRouteIds.has(b.routeId) && now - b.updatedAt < STALE_MS)
    .map((b) => ({ ...b, nextStops: b.nextStops || [], passed: b.passed || [] }));
  if (routeNumber) list = list.filter((b) => String(b.routeNumber).toLowerCase() === String(routeNumber).toLowerCase());
  if (routeId) list = list.filter((b) => b.routeId === routeId);
  return list;
}

// ---------------------------------------------------------------- logs
export async function addStopEvent(ev) {
  if (usingMemory) {
    mem.events.push(ev);
    if (mem.events.length > 2000) mem.events.shift();
    return;
  }
  await db.collection("stop_events").add(ev);
}

export async function addCrowdLog(entry) {
  if (usingMemory) {
    mem.crowd.push(entry);
    if (mem.crowd.length > 2000) mem.crowd.shift();
    return;
  }
  await db.collection("crowd_logs").add(entry);
}

/** Recent crowd log rows (newest first), used to warm the per-route crowd memory after a restart. */
export async function getCrowdLogs(limit = 5000) {
  if (usingMemory) return [...mem.crowd].reverse().slice(0, limit);
  const snap = await db.collection("crowd_logs").orderBy("ts", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data());
}

export async function getRecentEvents({ limit = 50, busId } = {}) {
  let list;
  if (usingMemory) {
    list = [...mem.events].reverse();
  } else {
    const snap = await db.collection("stop_events").orderBy("ts", "desc").limit(300).get();
    list = snap.docs.map((d) => d.data());
  }
  if (busId) list = list.filter((e) => e.busId === busId);
  return list.slice(0, limit);
}