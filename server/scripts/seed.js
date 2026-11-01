// Loads data/*.seed.json into Firestore:  npm run seed
import { readFileSync } from "node:fs";
import "dotenv/config";
import { db, usingMemory } from "../src/config/firebase.js";

if (usingMemory) {
  console.log("USE_MEMORY_DB=true, nothing to seed (the server reads data/*.seed.json directly).");
  process.exit(0);
}

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

async function load(collection, docs, idOf) {
  // Firestore batches are limited to 500 writes.
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) {
      const { id, ...rest } = d;
      batch.set(db.collection(collection).doc(idOf(d)), rest);
    }
    await batch.commit();
  }
  console.log(`  ${collection}: ${docs.length} documents`);
}

// Remove documents that are no longer in the seed files (for example a demo line that was rebuilt
// with a different number), so old copies don't come back when the server reads Firestore.
async function prune(collection, keepIds) {
  const keep = new Set(keepIds);
  const snap = await db.collection(collection).get();
  const stale = snap.docs.filter((d) => !keep.has(d.id));
  for (let i = 0; i < stale.length; i += 400) {
    const batch = db.batch();
    for (const d of stale.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  if (stale.length) console.log(`  ${collection}: removed ${stale.length} old document(s): ${stale.map((d) => d.id).join(", ")}`);
}

console.log("Seeding Firestore...");
const stops = read("stops.seed.json");
const routes = read("routes.seed.json");
const timetables = read("schedule.seed.json");
await load("stops", stops, (d) => d.id);
await load("routes", routes, (d) => d.id);
await load("timetables", timetables, (d) => d.routeId);
await prune("routes", routes.map((d) => d.id));
await prune("timetables", timetables.map((d) => d.routeId));
console.log("Done. Start the API with: npm run dev");
process.exit(0);