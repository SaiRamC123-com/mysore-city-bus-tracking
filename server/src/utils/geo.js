const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Cumulative distance (metres) at every vertex of a [[lat,lng],...] polyline. */
export function cumulativeM(polyline) {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    cum.push(cum[i - 1] + haversineM(polyline[i - 1][0], polyline[i - 1][1], polyline[i][0], polyline[i][1]));
  }
  return cum;
}

/**
 * Snap a GPS point onto the route polyline.
 * Returns how far along the route the bus is (alongM) and how far off the road line it is (offM).
 * Uses a local flat-earth approximation, which is accurate to well under a metre at city scale.
 */
export function projectOnPolyline(polyline, cum, lat, lng) {
  let best = { alongM: 0, offM: Infinity, seg: 0 };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const kx = Math.cos(rad(a[0])) * 111_320;
    const ky = 110_540;
    const bx = (b[1] - a[1]) * kx;
    const by = (b[0] - a[0]) * ky;
    const px = (lng - a[1]) * kx;
    const py = (lat - a[0]) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? clamp((px * bx + py * by) / len2, 0, 1) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.offM) {
      best = { alongM: cum[i] + t * (cum[i + 1] - cum[i]), offM: off, seg: i };
    }
  }
  return best;
}

/** Position and heading at a given distance along the polyline. */
export function pointAtDistance(polyline, cum, distM) {
  const total = cum[cum.length - 1];
  const d = clamp(distM, 0, total);
  let i = 0;
  while (i < polyline.length - 2 && cum[i + 1] < d) i++;
  const a = polyline[i];
  const b = polyline[i + 1];
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (d - cum[i]) / seg : 0;
  return {
    lat: a[0] + t * (b[0] - a[0]),
    lng: a[1] + t * (b[1] - a[1]),
    heading: bearingDeg(a[0], a[1], b[0], b[1]),
  };
}
