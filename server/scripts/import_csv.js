// Builds data/stops.seed.json, routes.seed.json and schedule.seed.json from two spreadsheets:
//   data/import/stops.csv   and   data/import/routes.csv
// Run:  npm run import        (then  npm run seed  if you use Firebase)
//
// It checks everything first and writes NOTHING if there is a mistake, so a typo can't break the app.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const dir = new URL("../data/", import.meta.url);
const file = (p) => new URL(p, dir);

// ---- tiny CSV reader (handles "quoted, values" and "" escapes; no dependency) ----
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, ""); // Excel adds an invisible mark at the start
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r, i) => {
    const o = { _line: i + 2 };
    head.forEach((h, k) => (o[h] = (r[k] ?? "").trim()));
    return o;
  });
}

const slug = (s) =>
  "s_" +
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Mysuru city and its edge. Anything outside is almost certainly a wrong coordinate.
const BOUNDS = { latMin: 12.15, latMax: 12.45, lngMin: 76.5, lngMax: 76.8 };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const STOP_COLS = ["id", "name", "nameKn", "aliases", "lat", "lng", "radiusM", "verified"];
const ROUTE_COLS = ["id", "number", "name", "nameKn", "mlId", "stops", "firstDeparture", "lastDeparture", "headwayMin", "avgSpeedKmh", "dwellSec", "demo"];

// A column you deleted counts as empty (defaults apply). Only the essential columns must exist.
const fill = (rows, cols) => rows.map((r) => Object.fromEntries([["_line", r._line], ...cols.map((c) => [c, r[c] ?? ""])]));

export function build(stopRowsIn, routeRowsIn) {
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  for (const [rows, file, must] of [[stopRowsIn, "stops.csv", ["name", "lat", "lng"]], [routeRowsIn, "routes.csv", ["number", "stops"]]]) {
    const lost = rows.length ? must.filter((c) => !(c in rows[0])) : [];
    if (lost.length) err(file, `the header row has no "${lost.join('", "')}" column`);
  }
  if (errors.length) return { stops: [], routes: [], schedule: [], errors, warnings };
  const stopRows = fill(stopRowsIn, STOP_COLS);
  const routeRows = fill(routeRowsIn, ROUTE_COLS);

  // ---------- stops ----------
  const stops = [];
  const ids = new Set();
  for (const r of stopRows) {
    const where = `stops.csv line ${r._line}`;
    if (!r.name) {
      err(where, "name is empty");
      continue;
    }
    const id = r.id || slug(r.name);
    if (ids.has(id)) {
      err(where, `id "${id}" is used twice (stop "${r.name}"). Give one of them a different id.`);
      continue;
    }
    ids.add(id);
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (r.lat === "" || r.lng === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      err(where, `"${r.name}" has no valid lat/lng. In Google Maps, right-click the spot and click the numbers to copy them.`);
      continue;
    }
    if (lat < BOUNDS.latMin || lat > BOUNDS.latMax || lng < BOUNDS.lngMin || lng > BOUNDS.lngMax) {
      err(where, `"${r.name}" (${lat}, ${lng}) is outside Mysuru. lat and lng may be swapped, or the place was matched in another city.`);
      continue;
    }
    const radiusM = r.radiusM === "" ? 50 : Number(r.radiusM);
    if (!Number.isFinite(radiusM) || radiusM < 15 || radiusM > 200) {
      err(where, `radiusM must be a number from 15 to 200 (got "${r.radiusM}")`);
      continue;
    }
    stops.push({
      id,
      name: r.name,
      ...(r.nameKn ? { nameKn: r.nameKn } : {}),
      aliases: r.aliases ? r.aliases.split("|").map((a) => a.trim().toLowerCase()).filter(Boolean) : [],
      lat,
      lng,
      radiusM,
      verified: r.verified.toLowerCase() === "true",
    });
  }

  // Two stops at nearly the same place usually means the same circle was entered twice.
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i];
      const b = stops[j];
      const dy = (a.lat - b.lat) * 111_000;
      const dx = (a.lng - b.lng) * 108_700;
      if (Math.hypot(dx, dy) < 25) warnings.push(`"${a.name}" and "${b.name}" are less than 25 m apart. Same place entered twice?`);
    }
  }

  // ---------- routes + timetables ----------
  const routes = [];
  const schedule = [];
  const routeIds = new Set();
  const stopIds = new Set(stops.map((s) => s.id));
  for (const r of routeRows) {
    const where = `routes.csv line ${r._line}`;
    if (!r.number) {
      err(where, "number is empty");
      continue;
    }
    const id = r.id || `r${r.number.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (routeIds.has(id)) {
      err(where, `route id "${id}" is used twice`);
      continue;
    }
    routeIds.add(id);
    const list = r.stops.split("|").map((x) => x.trim()).filter(Boolean);
    if (list.length < 2) {
      err(where, `route ${r.number} needs at least 2 stops, separated by |`);
      continue;
    }
    if (list.length > 60) {
      err(where, `route ${r.number} has ${list.length} stops. The ML service accepts at most 60.`);
      continue;
    }
    const unknown = list.filter((x) => !stopIds.has(x));
    if (unknown.length) {
      err(where, `route ${r.number} uses stop ids that are not in stops.csv: ${unknown.join(", ")}`);
      continue;
    }
    const mlId = r.mlId === "" ? 3 : Number(r.mlId);
    if (!Number.isInteger(mlId) || mlId < 0 || mlId > 99) {
      err(where, `mlId must be a whole number from 0 to 99 (got "${r.mlId}")`);
      continue;
    }
    const first = r.firstDeparture || "06:00";
    const last = r.lastDeparture || "21:00";
    if (!TIME.test(first) || !TIME.test(last)) {
      err(where, `firstDeparture and lastDeparture must look like 06:30 (got "${first}", "${last}")`);
      continue;
    }
    const num = (v, d, lo, hi, name) => {
      const n = v === "" ? d : Number(v);
      if (!Number.isFinite(n) || n < lo || n > hi) {
        err(where, `${name} must be a number from ${lo} to ${hi} (got "${v}")`);
        return null;
      }
      return n;
    };
    const headwayMin = num(r.headwayMin, 20, 3, 120, "headwayMin");
    const avgSpeedKmh = num(r.avgSpeedKmh, 17, 5, 60, "avgSpeedKmh");
    const dwellSec = num(r.dwellSec, 30, 5, 300, "dwellSec");
    if ([headwayMin, avgSpeedKmh, dwellSec].includes(null)) continue;
    if (new Set(list).size !== list.length) warnings.push(`Route ${r.number}: a stop appears twice in its list. That is only right for a loop route.`);
    routes.push({
      id,
      number: r.number,
      name: r.name || `Route ${r.number}`,
      ...(r.nameKn ? { nameKn: r.nameKn } : {}),
      mlId,
      demo: r.demo.toLowerCase() === "true",
      stopIds: list,
    });
    schedule.push({ routeId: id, firstDeparture: first, lastDeparture: last, headwayMin, avgSpeedKmh, dwellSec });
  }

  const unused = stops.filter((s) => !routes.some((r) => r.stopIds.includes(s.id)));
  if (unused.length) warnings.push(`${unused.length} stop(s) are not on any route yet (they show on the map but no bus serves them): ${unused.slice(0, 8).map((s) => s.name).join(", ")}${unused.length > 8 ? ", ..." : ""}`);

  return { stops, routes, schedule, errors, warnings };
}

// ---------- run ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const need = ["import/stops.csv", "import/routes.csv"];
  for (const f of need) {
    if (!existsSync(file(f))) {
      console.error(`Missing file: server/data/${f}`);
      process.exit(1);
    }
  }
  const out = build(parseCsv(readFileSync(file("import/stops.csv"), "utf8")), parseCsv(readFileSync(file("import/routes.csv"), "utf8")));
  out.warnings.forEach((w) => console.log("warning:", w));
  if (out.errors.length) {
    console.error(`\n${out.errors.length} problem(s). Nothing was changed:\n`);
    out.errors.forEach((e) => console.error(" -", e));
    process.exit(1);
  }
  for (const f of ["stops", "routes", "schedule"]) {
    if (existsSync(file(`${f}.seed.json`))) copyFileSync(file(`${f}.seed.json`), file(`${f}.seed.json.bak`));
  }
  writeFileSync(file("stops.seed.json"), JSON.stringify(out.stops, null, 2) + "\n");
  writeFileSync(file("routes.seed.json"), JSON.stringify(out.routes, null, 2) + "\n");
  writeFileSync(file("schedule.seed.json"), JSON.stringify(out.schedule, null, 2) + "\n");
  console.log(`Done: ${out.stops.length} stops, ${out.routes.length} routes. (Old files saved as *.seed.json.bak)`);
  console.log("Next: restart the server. If you use Firebase, run  npm run seed  first.");
}