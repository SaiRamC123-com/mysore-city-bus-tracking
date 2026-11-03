import { cumulativeM, projectOnPolyline } from "./geo.js";

const DEFAULT_AVG_KMH = 17;
const DEFAULT_DWELL_S = 30;

/**
 * Turn a route definition + stop records + timetable parameters into a routable object
 * (polyline, distances along the road, stop positions along the road).
 */
export function buildRoute(def, stopsById, timetable) {
  const stops = def.stopIds.map((id) => {
    const s = stopsById[id];
    if (!s) throw new Error(`Route ${def.id}: unknown stop "${id}"`);
    return s;
  });
  // Straight lines between stops until you supply a road-following polyline.
  const polyline = def.polyline?.length ? def.polyline : stops.map((s) => [s.lat, s.lng]);
  const cum = cumulativeM(polyline);
  return {
    id: def.id,
    number: String(def.number),
    name: def.name,
    nameKn: def.nameKn,
    mlId: def.mlId ?? 0,
    demo: !!def.demo,
    source: def.source ?? (def.demo ? "practice-data" : "route-data"),
    verified: def.verified ?? !def.demo,
    shapeApprox: !!def.shapeApprox,
    allowReverse: def.allowReverse !== false,
    availableDirections: def.availableDirections ?? [0, 1],
    gtfsRouteId: def.gtfsRouteId ?? null,
    gtfsDirectionId: def.gtfsDirectionId ?? null,
    routeType: def.routeType ?? null,
    polyline,
    cum,
    lengthM: cum[cum.length - 1],
    timetable: timetable ?? null,
    stops: stops.map((s) => ({
      ...s,
      radiusM: s.radiusM ?? 40,
      alongM: projectOnPolyline(polyline, cum, s.lat, s.lng).alongM,
    })),
  };
}

/** Scheduled arrival/departure offsets (minutes after trip start) for each stop. */
function withOffsets(stops, tt, mirrorRunMin) {
  const v = (tt?.avgSpeedKmh ?? DEFAULT_AVG_KMH) / 3.6;
  const dwellMin = (tt?.dwellSec ?? DEFAULT_DWELL_S) / 60;
  let t = 0;
  return stops.map((s, i) => {
    let arr;
    if (tt?.offsets && tt.offsets[s.id] != null) {
      // Real timetable override (minutes from the first stop in the forward direction)
      arr = mirrorRunMin != null ? mirrorRunMin - tt.offsets[s.id] : tt.offsets[s.id];
    } else {
      if (i > 0) t += (s.alongM - stops[i - 1].alongM) / v / 60 + dwellMin;
      arr = t;
    }
    arr = Math.round(arr * 10) / 10;
    return { ...s, offsetMin: arr, departOffsetMin: i === 0 ? arr : Math.round((arr + dwellMin) * 10) / 10 };
  });
}

const orientCache = new WeakMap();

/**
 * Direction 0 = the order in routes.seed.json, direction 1 = reverse.
 * Every stop in the returned route has alongM, offsetMin and departOffsetMin for that direction.
 */
export function orient(route, dir) {
  if (!route.availableDirections.includes(dir) || (dir === 1 && !route.allowReverse)) {
    throw new Error(`Direction ${dir} is not available for route ${route.number}.`);
  }
  let pair = orientCache.get(route);
  if (!pair) {
    pair = {};
    orientCache.set(route, pair);
  }
  if (pair[dir]) return pair[dir];

  let result;
  if (dir === 0) {
    const stops = withOffsets(route.stops, route.timetable, null);
    result = { ...route, direction: 0, stops, runMin: stops[stops.length - 1].offsetMin };
  } else {
    const polyline = [...route.polyline].reverse();
    const cum = cumulativeM(polyline);
    const L = route.lengthM;
    const rev = [...route.stops].reverse().map((s) => ({ ...s, alongM: L - s.alongM }));
    const fwdRun = withOffsets(route.stops, route.timetable, null);
    const runMin = fwdRun[fwdRun.length - 1].offsetMin;
    const stops = withOffsets(rev, route.timetable, route.timetable?.offsets ? runMin : null);
    result = { ...route, direction: 1, polyline, cum, stops, runMin: stops[stops.length - 1].offsetMin };
  }
  result.towards = result.stops[result.stops.length - 1].name;
  result.towardsKn = result.stops[result.stops.length - 1].nameKn;
  pair[dir] = result;
  return result;
}

/** Scheduled minutes-since-trip-start at an arbitrary position along an oriented route. */
export function offsetAtAlong(o, alongM) {
  const s = o.stops;
  if (alongM <= s[0].alongM) return s[0].offsetMin;
  for (let i = 1; i < s.length; i++) {
    if (alongM <= s[i].alongM) {
      const span = s[i].alongM - s[i - 1].alongM || 1;
      const f = (alongM - s[i - 1].alongM) / span;
      return s[i - 1].departOffsetMin + f * (s[i].offsetMin - s[i - 1].departOffsetMin);
    }
  }
  return s[s.length - 1].offsetMin;
}
