// Firebase web SDK, used only to READ live bus positions (/bus_live) in real time.
// All writes go through the server. If VITE_FIREBASE_DATABASE_URL is empty, rtdb is null and
// useLiveBuses falls back to polling the server.
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const e = import.meta.env;

export const rtdb = e.VITE_FIREBASE_DATABASE_URL
  ? getDatabase(
      initializeApp({
        apiKey: e.VITE_FIREBASE_API_KEY,
        authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
        databaseURL: e.VITE_FIREBASE_DATABASE_URL,
        projectId: e.VITE_FIREBASE_PROJECT_ID,
        appId: e.VITE_FIREBASE_APP_ID,
      })
    )
  : null;