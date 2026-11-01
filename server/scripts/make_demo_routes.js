// Gives every stop that has no bus yet a DEMO bus line, so the planner and live tracking work
// everywhere while you collect the real KSRTC routes.   Run:  npm run demo-routes
//
// How: City Bus Stand is the hub. The city is cut into 8 pie slices around it. Each pair of opposite
// slices becomes one line that runs outer stops -> hub -> outer stops. Every line passes the hub, so
// any two stops are joined directly or by one change at the hub.
//
// These lines are NOT real routes. Their numbers are D1, D2, ... (never real KSRTC numbers), they are
// marked demo, and the stop order is simply "nearest to farthest from the hub". Replace them with real
// routes in data/import/routes.csv when you have them; running this again rebuilds only the D lines.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseCsv } from "./import_csv.js";

const ROUTE_COLS = ["id", "number", "name", "nameKn", "mlId", "stops", "firstDeparture", "lastDeparture", "headwayMin", "avgSpeedKmh", "dwellSec", "demo"];
const PER_SIDE = 28; // 28 + hub + 28 = 57, under the ML service's limit of 60 stops per route
const AUTO = "rd_"; // ids of the generated lines start with this, so a re-run can replace them

const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function bearingDeg(hub, s) {
  const dy = s.lat - hub.lat;
  const dx = (s.lng - hub.lng) * Math.cos((hub.lat * Math.PI) / 180);
  return (Math.atan2(dx, dy) * 180) / Math.PI + (dx < 0 ? 360 : 0); // 0 = north, 90 = east
}
const distM = (a, b) => Math.hypot((a.lng - b.lng) * 108_700, (a.lat - b.lat) * 111_000);

/** Pure function: returns the generated route rows (objects with the routes.csv columns). */
export function makeDemoRoutes(stopRows, routeRows, hubId = "s_cbs") {
  const stops = stopRows
    .map((r) => ({ id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng) }))
    .filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const hub = stops.find((s) => s.id === hubId) ?? stops[0];
  if (!hub) return { rows: [], hub: null, covered: 0 };

  const served = new Set(routeRows.filter((r) => !r.id.startsWith(AUTO)).flatMap((r) => r.stops.split("|").map((x) => x.trim())));
  const todo = stops.filter((s) => s.id !== hub.id && !served.has(s.id));

  const slices = Array.from({ length: 8 }, () => []);
  for (const s of todo) slices[Math.floor(((bearingDeg(hub, s) + 22.5) % 360) / 45)].push({ ...s, d: distM(hub, s) });
  for (const sl of slices) sl.sort((a, b) => a.d - b.d); // nearest first

  const rows = [];
  let n = 0;
  for (let axis = 0; axis < 4; axis++) {
    const a = slices[axis];
    const b = slices[axis + 4];
    for (let k = 0; k * PER_SIDE < Math.max(a.length, b.length); k++) {
      const sideA = a.slice(k * PER_SIDE, (k + 1) * PER_SIDE).reverse(); // outer -> inner
      const sideB = b.slice(k * PER_SIDE, (k + 1) * PER_SIDE); // inner -> outer
      const ids = [...sideA, hub, ...sideB].map((s) => s.id);
      if (ids.length < 2) continue;
      n++;
      const first = [...sideA, hub][0];
      const last = [hub, ...sideB].at(-1);
      rows.push({
        id: `${AUTO}d${n}`,
        number: `D${n}`,
        name: `Demo D${n}: ${first.name} ⇄ ${last.name}`,
        nameKn: "",
        mlId: "3",
        stops: ids.join("|"),
        firstDeparture: "06:00",
        lastDeparture: "21:00",
        headwayMin: "20",
        avgSpeedKmh: "18",
        dwellSec: "30",
        demo: "true",
      });
    }
  }
  return { rows, hub, covered: todo.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = new URL("../data/import/", import.meta.url);
  const stopRows = parseCsv(readFileSync(new URL("stops.csv", dir), "utf8"));
  const routeRows = parseCsv(readFileSync(new URL("routes.csv", dir), "utf8")).map((r) => ({ ...Object.fromEntries(ROUTE_COLS.map((c) => [c, ""])), ...r }));
  const hubArg = process.argv.find((a) => a.startsWith("--hub="))?.slice(6);
  const { rows, hub, covered } = makeDemoRoutes(stopRows, routeRows, hubArg);
  if (!hub) {
    console.error("stops.csv has no usable stops.");
    process.exit(1);
  }
  const keep = routeRows.filter((r) => !r.id.startsWith(AUTO));
  const all = [...keep, ...rows];
  writeFileSync(new URL("routes.csv", dir), [ROUTE_COLS.join(","), ...all.map((r) => ROUTE_COLS.map((c) => q(r[c] ?? "")).join(","))].join("\n") + "\n");
  console.log(`Hub: ${hub.name}. Made ${rows.length} demo line(s) covering ${covered} stop(s). Kept ${keep.length} existing route(s).`);
  rows.forEach((r) => console.log(`  ${r.number}: ${r.stops.split("|").length} stops  (${r.name})`));
  console.log("These are DEMO lines, not real KSRTC routes. Next: npm run import");
}