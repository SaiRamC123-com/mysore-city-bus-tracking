import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "../firebase.js";
import { api } from "../api.js";

const STALE_MS = 120_000; // same rule as the server: no ping for 2 min = bus is off the list

const normalise = (b) => ({ ...b, nextStops: b.nextStops || [], passed: b.passed || [] });

/**
 * Live buses. Returns { buses, mode, error, ready }.
 *  - "firebase": subscribes to /bus_live, updates arrive as they happen.
 *  - "polling":  asks the server every 3 s. Used when Firebase is not set up, when the server itself runs
 *                in demo/memory mode (its buses are NOT in Firebase), or when Firebase can't be read.
 */
export function useLiveBuses() {
  const [raw, setRaw] = useState([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState(rtdb ? "firebase" : "polling");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    let stop = () => {};
    const giveUp = setTimeout(() => alive && setReady(true), 4000); // never leave the page blank if nothing answers

    const poll = () => {
      setMode("polling");
      const load = () =>
        api
          .buses()
          .then((d) => alive && (setRaw(d.buses.map(normalise)), setError(""), setReady(true)))
          .catch((e) => alive && (setError(e.message), setReady(true)));
      load();
      const id = setInterval(load, 3000);
      return () => clearInterval(id);
    };

    const subscribe = () => {
      setMode("firebase");
      let off = onValue(
        ref(rtdb, "bus_live"),
        (snap) => {
          if (!alive) return;
          setRaw(Object.values(snap.val() || {}).filter(Boolean).map(normalise));
          setError("");
          setReady(true);
        },
        () => {
          // Firebase refused (rules, wrong URL): fall back to the server instead of showing nothing.
          if (alive) stop = poll();
        }
      );
      return () => off();
    };

    // The server says where it keeps live buses: in its own memory (demo mode) or in Firebase.
    api
      .health()
      .then((h) => {
        if (!alive) return;
        stop = rtdb && !String(h.db).startsWith("memory") ? subscribe() : poll();
      })
      .catch(() => {
        if (alive) stop = rtdb ? subscribe() : poll();
      });

    return () => {
      alive = false;
      clearTimeout(giveUp);
      stop();
    };
  }, []);

  // Re-check staleness every 10 s even when no new data arrives (a bus that stopped reporting).
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  void tick;
  const buses = raw.filter((b) => now - b.updatedAt < STALE_MS);
  return { buses, mode, error, ready };
}