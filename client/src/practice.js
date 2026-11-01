// Practice mode for the driver page: a pretend bus that drives along a route, so the whole app can be
// tried from a laptop that has no GPS. Pure functions, no browser APIs, so they can be tested.
import { haversineM } from "./utils.js";

export const PRACTICE_SPEED_KMH = 40;
const PING_EVERY_S = 4; // must match the driver page
const STEP_M = (PRACTICE_SPEED_KMH / 3.6) * PING_EVERY_S; // about 44 m per ping
const ARRIVE_WITHIN_M = 30;
const DWELL_PINGS = 2; // stand at each stop for about 8 s

/**
 * A pretend bus on `route` (as returned by /api/routes: { polyline, stops }) in `direction`.
 * Each next() gives the position for one ping: { lat, lng, speedKmh, done }.
 * It slows to a stop at every stop and waits there, like a real bus, so stop detection works.
 */
export function makePractice(route, direction) {
  const stops = direction === 1 ? [...route.stops].reverse() : route.stops;
  const path = direction === 1 ? [...route.polyline].reverse() : route.polyline;
  let cur = { lat: path[0][0], lng: path[0][1] };
  let seg = 0; // moving from path[seg] towards path[seg + 1]
  let nextStop = 0;
  let dwell = 0;
  let first = true;
  let finished = false;

  const arriveIfClose = () => {
    const s = stops[nextStop];
    if (s && haversineM(cur.lat, cur.lng, s.lat, s.lng) <= ARRIVE_WITHIN_M) {
      cur = { lat: s.lat, lng: s.lng };
      nextStop++;
      dwell = DWELL_PINGS;
    }
  };

  return {
    next() {
      if (finished) return { ...cur, speedKmh: 0, done: true };
      if (dwell > 0) {
        dwell--;
        if (dwell === 0 && nextStop >= stops.length) finished = true; // waited at the last stop
        return { ...cur, speedKmh: 0, done: finished };
      }
      let left = first ? 0 : STEP_M;
      if (first) arriveIfClose(); // the first ping is at the first stop
      first = false;
      while (left > 0 && seg < path.length - 1) {
        const b = { lat: path[seg + 1][0], lng: path[seg + 1][1] };
        const d = haversineM(cur.lat, cur.lng, b.lat, b.lng);
        if (d <= left) {
          cur = b;
          left -= d;
          seg++;
        } else {
          const f = left / d;
          cur = { lat: cur.lat + (b.lat - cur.lat) * f, lng: cur.lng + (b.lng - cur.lng) * f };
          left = 0;
        }
      }
      if (dwell === 0) arriveIfClose();
      if (seg >= path.length - 1 && dwell === 0) finished = true; // ran out of road
      return { ...cur, speedKmh: dwell > 0 ? 0 : PRACTICE_SPEED_KMH, done: finished && dwell === 0 };
    },
  };
}

// The same limits the server enforces on a driver ping (server/src/routes/driver.routes.js).
const MYSURU = { latMin: 12.15, latMax: 12.5, lngMin: 76.45, lngMax: 76.85 };
const MAX_ACCURACY_M = 5000;

/** Why a real device position can't be used as a bus position: "" (fine), "rough" or "outside". */
export function gpsProblem(pos) {
  if (!pos) return "";
  if ((pos.accuracy ?? 0) > MAX_ACCURACY_M) return "rough";
  if (pos.lat < MYSURU.latMin || pos.lat > MYSURU.latMax || pos.lng < MYSURU.lngMin || pos.lng > MYSURU.lngMax) return "outside";
  return "";
}