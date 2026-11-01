// Looks up coordinates for a list of place names using OpenStreetMap (Nominatim) and adds them to
// data/import/stops.csv.   Run:  npm run geocode
//
// 1. Put one place per line in  data/import/stop_names.txt , for example:
//        Devegowda Circle
//        Teresian Circle | teresian; teresian college
//    (text after | is a list of other names people use, separated by ;)
// 2. Run  npm run geocode . Places it finds are added to stops.csv with verified=false.
//    Places it cannot find are written to  data/import/not_found.txt  for you to do by hand.
// 3. OPEN stops.csv AND CHECK THE POSITIONS ON A MAP. OpenStreetMap guesses by name, and
//    Mysuru has many places with similar names. Only set verified=true after you checked.
//
// It makes 1 request per second, as OpenStreetMap's usage policy requires. 123 places take about 2 minutes.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseCsv } from "./import_csv.js";

const dir = new URL("../data/import/", import.meta.url);
const f = (n) => new URL(n, dir);

// Search window around Mysuru: left, top, right, bottom (lng, lat)
const VIEWBOX = "76.50,12.45,76.80,12.15";
const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const slug = (s) =>
  "s_" +
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function lookup(name, fetchFn = fetch) {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q: `${name}, Mysuru`, format: "jsonv2", limit: "3", viewbox: VIEWBOX, bounded: "1", countrycodes: "in" });
  const res = await fetchFn(url, { headers: { "User-Agent": "mysuru-bus-app-student-project/1.0 (data entry script)" } });
  if (!res.ok) throw new Error(`OpenStreetMap answered ${res.status}`);
  const hits = await res.json();
  return hits.length ? { lat: Number(hits[0].lat), lng: Number(hits[0].lon), found: hits[0].display_name, extra: hits.length - 1 } : null;
}

async function main() {
  if (!existsSync(f("stop_names.txt"))) {
    console.error("Create server/data/import/stop_names.txt first (one place name per line).");
    process.exit(1);
  }
  const lines = readFileSync(f("stop_names.txt"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const haveRows = existsSync(f("stops.csv")) ? parseCsv(readFileSync(f("stops.csv"), "utf8")) : [];
  if (!haveRows.length && !existsSync(f("stops.csv"))) writeFileSync(f("stops.csv"), "id,name,nameKn,aliases,lat,lng,radiusM,verified\n");
  const have = new Set(haveRows.flatMap((r) => [norm(r.name), ...(r.aliases ? r.aliases.split("|").map(norm) : [])]));
  const ids = new Set(haveRows.map((r) => r.id));

  const missing = [];
  let added = 0;
  for (const line of lines) {
    const [name, alias = ""] = line.split("|").map((x) => x.trim());
    if (have.has(norm(name))) {
      console.log(`skip   ${name} (already in stops.csv)`);
      continue;
    }
    let hit = null;
    try {
      hit = await lookup(name);
    } catch (e) {
      console.error(`ERROR  ${name}: ${e.message}. Check your internet connection, then run it again (finished places are skipped).`);
      break;
    }
    await sleep(1100);
    if (!hit) {
      console.log(`none   ${name}`);
      missing.push(name);
      continue;
    }
    let id = slug(name);
    for (let n = 2; ids.has(id); n++) id = `${slug(name)}_${n}`;
    ids.add(id);
    const aliases = [name.toLowerCase(), ...alias.split(";").map((a) => a.trim().toLowerCase())].filter(Boolean).join("|");
    appendFileSync(f("stops.csv"), [id, name, "", aliases, hit.lat.toFixed(6), hit.lng.toFixed(6), 60, "false"].map(q).join(",") + "\n");
    added++;
    console.log(`ok     ${name}  ->  ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}${hit.extra ? `  (${hit.extra} other match(es): check)` : ""}`);
  }
  if (missing.length) writeFileSync(f("not_found.txt"), missing.join("\n") + "\n");
  console.log(`\nAdded ${added}. Not found: ${missing.length}${missing.length ? " (listed in data/import/not_found.txt, add them by hand)" : ""}.`);
  console.log("Now open data/import/stops.csv and check the positions on a map before using them.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();