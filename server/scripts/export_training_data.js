// Exports logged data to CSV for retraining the ML models:  npm run export:training
//   crowd_logs  -> ../ml-service/data/crowd_logs.csv
//   stop_events -> ../ml-service/data/eta_segments.csv   (travel time between consecutive stops)
// Simulator rows are skipped unless you pass --include-sim (real data is what makes the model honest).
import { mkdirSync, writeFileSync } from "node:fs";
import "dotenv/config";
import { db, usingMemory } from "../src/config/firebase.js";
import { istParts } from "../src/utils/time.js";

if (usingMemory) {
  console.error("This script reads Firestore. Set USE_MEMORY_DB=false.");
  process.exit(1);
}
const includeSim = process.argv.includes("--include-sim");
const outDir = new URL("../../ml-service/data/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const keep = (d) => includeSim || (d.source !== "simulator" && d.occupancySource !== "simulated");

// ---- crowd
const crowd = (await db.collection("crowd_logs").orderBy("ts", "desc").limit(50_000).get()).docs.map((d) => d.data()).filter(keep);
const crowdCols = ["route_id", "stop_seq", "hour", "weekday", "is_festival", "is_raining", "occupancy_pct"];
writeFileSync(
  new URL("crowd_logs.csv", outDir),
  [crowdCols.join(","), ...crowd.map((c) => [c.mlId, c.stopSeq, c.hour, c.weekday, c.isFestival ?? 0, c.isRaining ?? 0, c.occupancyPct].join(","))].join("\n")
);
console.log(`crowd_logs.csv: ${crowd.length} rows`);

// ---- ETA segments
const events = (await db.collection("stop_events").orderBy("ts", "asc").limit(100_000).get()).docs.map((d) => d.data()).filter(keep);
const byTrip = {};
for (const e of events) (byTrip[e.tripId] ??= []).push(e);
const rows = [];
for (const list of Object.values(byTrip)) {
  const dep = {};
  for (const e of list) {
    if (e.type === "DEPARTED") dep[e.seq] = e;
    if (e.type === "ARRIVED" && dep[e.seq - 1]) {
      const prev = dep[e.seq - 1];
      const sec = Math.round((e.ts - prev.ts) / 1000);
      const segM = Math.round(e.alongM - prev.alongM);
      if (sec > 5 && segM > 30) {
        const p = istParts(prev.ts);
        rows.push([e.mlId, p.hour, p.weekday, segM, sec].join(","));
      }
    }
  }
}
writeFileSync(new URL("eta_segments.csv", outDir), ["route_id,hour,weekday,segment_m,travel_sec", ...rows].join("\n"));
console.log(`eta_segments.csv: ${rows.length} rows`);
console.log("Now retrain: cd ../ml-service && python training/train_crowd.py && python training/train_eta.py");
process.exit(0);
