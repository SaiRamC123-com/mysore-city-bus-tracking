import { readFileSync, existsSync } from "node:fs";
import { env } from "./env.js";

// usingMemory=true  -> everything lives in process memory (demo / tests)
// usingMemory=false -> Firebase Realtime Database (live buses) + Firestore (everything else)
const hasCredential = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) || existsSync(env.credPath);
export const firebaseConfigured = hasCredential && Boolean(env.firebaseDbUrl);
export const memoryFallback = !env.useMemoryDb && !firebaseConfigured;
export const usingMemory = env.useMemoryDb || memoryFallback;
export let rtdb = null;
export let db = null;

if (memoryFallback) {
  console.warn("[firebase] Firebase credentials are missing; persistent live-bus storage and GTFS imports are unavailable.");
}

if (!usingMemory) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      credential = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
    }
  } else if (existsSync(env.credPath)) {
    credential = JSON.parse(readFileSync(env.credPath, "utf8"));
  } else {
    throw new Error(
      `Firebase service-account key not found at "${env.credPath}". ` +
        `Set FIREBASE_SERVICE_ACCOUNT_JSON or download a key from Firebase console > Project settings > Service accounts, ` +
        `or set USE_MEMORY_DB=true to run without Firebase.`
    );
  }
  if (!env.firebaseDbUrl) throw new Error("FIREBASE_DATABASE_URL is not set in server/.env");

  // Modular imports: the old `import admin from "firebase-admin"` default export has no
  // `credential` in current firebase-admin versions.
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getDatabase } = await import("firebase-admin/database");
  const { getFirestore } = await import("firebase-admin/firestore");

  initializeApp({
    credential: cert(credential),
    databaseURL: env.firebaseDbUrl,
  });
  rtdb = getDatabase();
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
}
