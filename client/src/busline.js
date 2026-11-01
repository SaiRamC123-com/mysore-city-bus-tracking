// The "bus line": the stops of one bus's route in driving order, with the bus placed between them.
// Pure functions (no React, no browser), so they can be tested.
import { haversineM } from "./utils.js";

/** The route's stops in the direction the bus is driving (direction 1 = back the other way). */
export const orientedStops = (route, direction) => (direction === 1 ? [...route.stops].reverse() : route.stops);

/** Where the bus is along `stops`, as a number: 0 = at the first stop, 2.5 = halfway between stops 2 and 3. null = unknown. */
export function busPosition(stops, bus) {
  const next = bus.nextStops?.[0];
  if (!next) return bus.passed?.length ? stops.length - 1 : null; // nothing ahead: at the end of the line
  const ni = stops.findIndex((s) => s.id === next.stopId);
  if (ni < 0) return null;
  if (next.atStop || ni === 0) return ni;
  const a = stops[ni - 1];
  const b = stops[ni];
  const da = haversineM(a.lat, a.lng, bus.lat, bus.lng);
  const db = haversineM(bus.lat, bus.lng, b.lat, b.lng);
  return ni - 1 + (da + db > 0 ? Math.min(1, Math.max(0, da / (da + db))) : 0);
}

/**
 * What to draw. With a trip (from and to, and "to" comes after "from" in this direction) only the part
 * from the bus (or the boarding stop, if the bus is still before it) to the destination is listed.
 * Returns { rows: [{ stop, state: "passed" | "here" | "ahead", role: "from" | "to" | null }],
 *           pos: bus position inside rows (null if unknown or already past the destination), hasTrip }.
 */
export function lineModel({ stops, bus, fromId, toId }) {
  const full = busPosition(stops, bus);
  const fi = fromId ? stops.findIndex((s) => s.id === fromId) : -1;
  const ti = toId ? stops.findIndex((s) => s.id === toId) : -1;
  const hasTrip = fi >= 0 && ti > fi;
  let start = 0;
  let end = stops.length - 1;
  if (hasTrip) {
    start = Math.min(fi, full == null ? fi : Math.floor(full));
    end = ti;
  }
  const eps = 0.001;
  const rows = stops.slice(start, end + 1).map((stop, k) => {
    const i = start + k;
    return {
      stop,
      state: full == null ? "ahead" : i < full - eps ? "passed" : Math.abs(i - full) <= eps ? "here" : "ahead",
      role: hasTrip && i === fi ? "from" : hasTrip && i === ti ? "to" : null,
    };
  });
  const pos = full == null || full - start > rows.length - 1 + eps || full < start ? null : full - start;
  return { rows, pos, hasTrip };
}

const nearestIdx = (poly, s) => {
  let best = 0;
  let bd = Infinity;
  poly.forEach((p, i) => {
    const d = (p[0] - s.lat) ** 2 + (p[1] - s.lng) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
};

/** The piece of the route's drawn line between two stops (for highlighting "your ride" on the map). */
export function segmentBetween(route, fromId, toId) {
  const f = route.stops.find((s) => s.id === fromId);
  const t = route.stops.find((s) => s.id === toId);
  if (!f || !t || !route.polyline?.length) return null;
  let a = nearestIdx(route.polyline, f);
  let b = nearestIdx(route.polyline, t);
  if (a > b) [a, b] = [b, a];
  return a === b ? null : route.polyline.slice(a, b + 1);
}

/**
 * A pretend "live" bus built from the timetable alone (no GPS): where the bus SHOULD be at time `now`.
 * `plan` is GET /api/routes/:id/plan (stops in driving order with offsetMin / departOffsetMin).
 * Returns { bus, phase: "before" | "stopped" | "moving" | "done", minutesToStart }.
 * The bus object has the same shape as a real live bus, so the map and the bus line can draw it.
 */
export function scheduledBus({ plan, tripStartTs, now }) {
  const st = plan.stops;
  const last = st.length - 1;
  const arr = st.map((s) => tripStartTs + s.offsetMin * 60_000);
  const dep = st.map((s) => tripStartTs + s.departOffsetMin * 60_000);

  let phase = "moving";
  let idx = -1; // index of the stop the bus is at, or the next stop it is heading to
  let atStop = false;
  let lat = st[0].lat;
  let lng = st[0].lng;

  if (now < arr[0]) {
    phase = "before";
    idx = 0;
    atStop = true;
  } else if (now >= arr[last]) {
    phase = "done";
    idx = last + 1;
    lat = st[last].lat;
    lng = st[last].lng;
  } else {
    for (let i = 0; i <= last; i++) {
      if (now >= arr[i] && now < dep[i]) {
        phase = "stopped";
        idx = i;
        atStop = true;
        lat = st[i].lat;
        lng = st[i].lng;
        break;
      }
    }
    if (idx < 0) {
      for (let i = 0; i < last; i++) {
        if (now >= dep[i] && now < arr[i + 1]) {
          idx = i + 1;
          const f = (now - dep[i]) / (arr[i + 1] - dep[i]);
          lat = st[i].lat + (st[i + 1].lat - st[i].lat) * f;
          lng = st[i].lng + (st[i + 1].lng - st[i].lng) * f;
          break;
        }
      }
    }
  }

  const nextStops = [];
  for (let j = idx; j <= last && idx >= 0; j++) {
    nextStops.push({
      stopId: st[j].id, name: st[j].name, nameKn: st[j].nameKn, seq: j, atStop: atStop && j === idx,
      scheduledTs: arr[j], predictedTs: arr[j], scheduledDepTs: dep[j], predictedDepTs: dep[j], marginMin: 0,
    });
  }
  const passed = [];
  for (let j = 0; j < Math.min(idx, last + 1); j++) passed.push({ stopId: st[j].id, name: st[j].name, seq: j, arrivedTs: arr[j], departedTs: dep[j] });

  const bus = {
    busId: `sched-${plan.routeId}-${plan.direction}-${tripStartTs}`,
    routeId: plan.routeId,
    routeNumber: plan.number,
    routeName: plan.name,
    routeNameKn: plan.nameKn,
    direction: plan.direction,
    towards: plan.towards,
    towardsKn: plan.towardsKn,
    tripStartTs,
    lat,
    lng,
    speedKmh: 0,
    crowdLevel: "low",
    status: phase === "moving" ? "EN_ROUTE" : "AT_STOP",
    nextStops,
    passed,
    source: "scheduled",
  };
  return { bus, phase, minutesToStart: Math.max(0, Math.ceil((arr[0] - now) / 60_000)) };
}