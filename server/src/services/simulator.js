import { getStatic, deleteLive } from "./dataService.js";
import { processPing } from "./pingService.js";
import { predictCrowd } from "./crowdService.js";
import { tripsForDay } from "./scheduleService.js";
import { orient, offsetAtAlong } from "../utils/route.js";
import { pointAtDistance } from "../utils/geo.js";
import { dayStartTs } from "../utils/time.js";

/**
 * Demo bus simulator. Drives fake buses along the real route geometry with a believable speed
 * profile (cruise, brake into each stop, stand 25-55 s, pull away, random traffic slowdowns),
 * and sends their pings through the SAME pipeline a real driver phone uses. Everything it
 * produces is tagged source:"simulator" so the UI and the chatbot can say "demo".
 *
 * Buses are started so they match today's timetable: whichever scheduled trips are in progress
 * right now get a bus, running a few minutes early or late.
 */

const TICK_MS = 2000;
const rand = (a, b) => a + Math.random() * (b - a);
const randn = () => {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

function newBus({ route, direction, tripStartTs, delayMin, idx }) {
  const o = orient(route, direction);
  const letter = String.fromCharCode(65 + idx);
  // Where a bus that is `delayMin` late should be right now, from the timetable.
  const elapsedMin = (Date.now() - tripStartTs) / 60_000 - delayMin;
  let along = 0;
  for (const s of o.stops) {
    if (s.offsetMin <= elapsedMin) along = s.alongM;
  }
  // Interpolate between stops for a smoother start.
  const nextStop = o.stops.find((s) => s.offsetMin > elapsedMin);
  if (nextStop) {
    const prev = [...o.stops].reverse().find((s) => s.offsetMin <= elapsedMin) ?? o.stops[0];
    const span = nextStop.offsetMin - prev.offsetMin || 1;
    along = prev.alongM + ((elapsedMin - prev.offsetMin) / span) * (nextStop.alongM - prev.alongM);
  }
  return {
    busId: `MYS-${route.number}-${letter}${direction ? "R" : ""}`,
    route,
    o,
    direction,
    tripStartTs,
    d: Math.max(0, Math.min(along, o.stops[o.stops.length - 1].alongM - 20)),
    v: 0,
    nextIdx: Math.max(0, o.stops.findIndex((s) => s.alongM > along - 1)),
    dwellUntil: 0,
    slowUntil: 0,
    cruise: rand(5.5, 8.5), // m/s, about 20-30 km/h
    capacity: 60,
    occupancy: 25,
    endedAt: null,
  };
}

async function tick(bus, now) {
  const stops = bus.o.stops;
  const target = stops[bus.nextIdx];
  const gap = target.alongM - bus.d;

  if (bus.endedAt) return;

  if (now < bus.dwellUntil) {
    bus.v = 0;
  } else {
    if (now > bus.slowUntil && Math.random() < 0.02) bus.slowUntil = now + rand(8_000, 25_000); // traffic
    const cruise = now < bus.slowUntil ? bus.cruise * 0.35 : bus.cruise;
    const brake = Math.sqrt(2 * 0.9 * Math.max(gap, 0));
    const wanted = Math.min(cruise, brake);
    // accelerate gently, brake harder
    bus.v += Math.max(-1.6, Math.min(0.9, wanted - bus.v)) * (TICK_MS / 1000) * 0.6;
    bus.v = Math.max(0, bus.v);
    bus.d += bus.v * (TICK_MS / 1000);
  }

  if (gap <= 3 && now >= bus.dwellUntil) {
    // Reached the stop: stand there, passengers alight/board.
    bus.d = target.alongM;
    bus.v = 0;
    const last = bus.nextIdx === stops.length - 1;
    const [f] = await predictCrowd([{ mlId: bus.route.mlId, seq: bus.nextIdx, ts: now }]);
    const base = (f.pct / 100) * bus.capacity;
    bus.occupancy = Math.round(Math.max(0, Math.min(bus.capacity, 0.6 * bus.occupancy + 0.4 * base + randn() * 4)));
    bus.dwellUntil = now + rand(25_000, 55_000);
    if (last) bus.endedAt = now + 25_000; // keep sending "standing at the terminus" until then
    else bus.nextIdx++;
  }

  const pos = pointAtDistance(bus.o.polyline, bus.o.cum, bus.d);
  const noise = 0.00002; // ~2 m of GPS jitter
  await processPing({
    busId: bus.busId,
    routeId: bus.route.id,
    direction: bus.direction,
    tripStartTs: bus.tripStartTs,
    lat: pos.lat + randn() * noise,
    lng: pos.lng + randn() * noise,
    speedKmh: Math.max(0, bus.v * 3.6 + randn() * 0.4),
    accuracyM: 6,
    occupancy: bus.occupancy,
    capacity: bus.capacity,
    seatCapacity: 40,
    standingPassengers: Math.max(0, bus.occupancy - 40),
    occupancySource: "simulated",
    source: "simulator",
    ts: now,
  });
}

export async function startSimulator({ busesPerRoute = 2 } = {}) {
  const { routeList } = await getStatic();
  const demoRoutes = routeList.filter((route) => route.demo);
  const now = Date.now();
  const day = dayStartTs(now);
  const buses = [];

  for (const route of demoRoutes) {
    let idx = 0;
    const running = [];
    for (const t of tripsForDay(route, day)) {
      const o = orient(route, t.direction);
      if (t.departTs <= now && now <= t.departTs + o.runMin * 60_000) running.push(t);
    }
    // Outside timetable hours: still give the demo a couple of buses.
    if (!running.length) {
      for (let k = 0; k < busesPerRoute; k++) {
        const direction = k % 2;
        const o = orient(route, direction);
        running.push({ direction, departTs: now - Math.round(rand(0.15, 0.7) * o.runMin * 60_000) });
      }
    }
    for (const t of running.slice(0, busesPerRoute)) {
      buses.push(newBus({ route, direction: t.direction, tripStartTs: t.departTs, delayMin: rand(-1.5, 5), idx: idx++ }));
    }
  }

  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      const t = Date.now();
      for (let i = 0; i < buses.length; i++) {
        const b = buses[i];
        try {
          await tick(b, t);
        } catch (e) {
          console.error(`[sim ${b.busId}]`, e.message);
        }
        if (b.endedAt && t > b.endedAt) {
          // Trip finished: take it out of the live list, then start the return trip.
          await deleteLive(b.busId).catch(() => {});
          buses[i] = newBus({ route: b.route, direction: 1 - b.direction, tripStartTs: t, delayMin: 0, idx: Number(b.busId.match(/-([A-Z])R?$/)?.[1].charCodeAt(0) - 65) || 0 });
        }
      }
    } finally {
      busy = false;
    }
  };
  setInterval(loop, TICK_MS).unref?.();
  await loop();
  return buses.length;
}
