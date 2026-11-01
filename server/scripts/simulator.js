// Standalone simulator: `npm run simulate`
// Use this when you run the API with a real Firebase (RUN_SIMULATOR=false) and want fake buses
// in a separate process. It writes to the same Firebase project using the service account.
import "dotenv/config";
import { startSimulator } from "../src/services/simulator.js";
import { env } from "../src/config/env.js";

if (env.useMemoryDb) {
  console.error("USE_MEMORY_DB=true: a separate simulator process can't share the API's memory.\nSet RUN_SIMULATOR=true in .env and just run `npm run dev` instead.");
  process.exit(1);
}
const n = await startSimulator({ busesPerRoute: env.simBusesPerRoute });
console.log(`Simulating ${n} demo buses. Press Ctrl+C to stop.`);
