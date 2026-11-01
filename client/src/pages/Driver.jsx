import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useGeolocation } from "../hooks/useGeolocation.js";
import { useI18n } from "../i18n/index.jsx";
import { gpsProblem, makePractice } from "../practice.js";
import { clock, haversineM, pick } from "../utils.js";

const BUS_ID = /^[A-Za-z0-9_-]{2,32}$/;
const PING_EVERY_MS = 4000;
const input = "w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-base";

const store = {
  get: (k) => {
    try {
      return sessionStorage.getItem(k) || "";
    } catch {
      return "";
    }
  },
  set: (k, v) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Driver / conductor page. Shares the phone's GPS with the server every 4 s and lets the conductor
 * count passengers. The passenger count is only sent after the first tap on + or -, so a bus nobody
 * has counted is never reported as "empty".
 */
export default function Driver() {
  const { t, lang } = useI18n();
  const geo = useGeolocation({ highAccuracy: true });

  const [secret, setSecret] = useState(() => store.get("driverSecret"));
  const [busId, setBusId] = useState(() => store.get("driverBusId"));
  const [routes, setRoutes] = useState([]);
  const [routeId, setRouteId] = useState("");
  const [direction, setDirection] = useState(0);
  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripStartTs, setTripStartTs] = useState(0);
  const [capacity, setCapacity] = useState(60);
  const [seatCapacity, setSeatCapacity] = useState(40);
  const [count, setCount] = useState(0);
  const [standingPassengers, setStandingPassengers] = useState(0);
  const [counted, setCounted] = useState(false);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState(null);
  const [error, setError] = useState("");
  const [practice, setPractice] = useState(false);
  const [practiceNote, setPracticeNote] = useState("");

  // always-current values for the interval callback
  const latest = useRef({});
  const prevPos = useRef(null);
  const mover = useRef(null); // the pretend bus, in practice mode
  latest.current = { secret, busId, routeId, direction, tripStartTs, capacity, seatCapacity, count, standingPassengers, counted, pos: geo.pos, practice };

  useEffect(() => {
    api
      .routes()
      .then((d) => {
        setRoutes(d.routes);
        setRouteId((r) => r || d.routes[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!routeId) return undefined;
    let alive = true;
    setTrips([]);
    setTripStartTs(0);
    setTripsLoading(true);
    setError("");
    api
      .trips(routeId, direction)
      .then((d) => {
        if (!alive) return;
        setTrips(d.trips);
        const nearest = [...d.trips].sort((a, b) => Math.abs(a.departTs - Date.now()) - Math.abs(b.departTs - Date.now()))[0];
        setTripStartTs(nearest?.departTs ?? 0);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setTripsLoading(false));
    return () => {
      alive = false;
    };
  }, [routeId, direction]);

  const sendPing = async () => {
    const c = latest.current;
    let pos = c.pos;
    let speedKmh = 0;
    let finished = false;

    if (c.practice) {
      const step = mover.current?.next();
      if (!step) return;
      pos = { lat: step.lat, lng: step.lng, accuracy: 10, ts: Date.now() };
      speedKmh = step.speedKmh;
      finished = step.done;
    } else {
      if (!pos) return; // still waiting for the first GPS fix
      const problem = gpsProblem(pos);
      if (problem) {
        setError(problem === "rough" ? t("driver.gpsTooRough", { km: Math.round(pos.accuracy / 1000) }) : t("driver.gpsOutside"));
        stop();
        return;
      }
      // Speed: use the device's own value when it has one, otherwise derive it from the last two fixes.
      speedKmh = pos.speed != null ? pos.speed * 3.6 : 0;
      if (pos.speed == null && prevPos.current && pos.ts > prevPos.current.ts) {
        const m = haversineM(prevPos.current.lat, prevPos.current.lng, pos.lat, pos.lng);
        speedKmh = (m / ((pos.ts - prevPos.current.ts) / 1000)) * 3.6;
      }
      prevPos.current = pos;
    }

    try {
      const out = await api.ping(c.secret, {
        busId: c.busId,
        routeId: c.routeId,
        direction: c.direction,
        tripStartTs: c.tripStartTs,
        lat: pos.lat,
        lng: pos.lng,
        speedKmh: Math.max(0, Math.min(120, Math.round(speedKmh * 10) / 10)),
        accuracyM: Math.round(pos.accuracy ?? 10),
        occupancy: c.counted ? c.count : null,
        capacity: c.capacity,
        seatCapacity: c.seatCapacity,
        standingPassengers: c.counted ? c.standingPassengers : null,
        ...(c.practice ? { practice: true } : {}),
      });
      setLast({ ...out, at: Date.now() });
      setError("");
      if (finished) {
        setPracticeNote(t("driver.practiceDone"));
        stop();
      }
    } catch (e) {
      setError(e.message);
      if (e.status === 401 || e.status === 503) stop();
    }
  };

  useEffect(() => {
    if (!running) return undefined;
    sendPing();
    const id = setInterval(sendPing, PING_EVERY_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    if (running && !practice && geo.error) setRunning(false);
  }, [geo.error, practice, running]);

  const wakeLock = useRef(null);
  const start = async () => {
    store.set("driverSecret", secret);
    store.set("driverBusId", busId);
    setError("");
    setLast(null);
    setPracticeNote("");
    prevPos.current = null;
    if (practice) {
      const route = routes.find((r) => r.id === routeId);
      if (!route) return;
      mover.current = makePractice(route, direction);
      setTripStartTs(Date.now()); // a practice trip starts now
      latest.current.tripStartTs = Date.now();
    } else if (!geo.request()) {
      return;
    }
    setRunning(true);
    try {
      wakeLock.current = await navigator.wakeLock?.request("screen"); // keep the screen on while driving
    } catch {
      /* not supported or refused: fine */
    }
  };
  function stop() {
    setRunning(false);
    geo.stop();
    wakeLock.current?.release?.().catch(() => {});
  }

  const ready = secret && BUS_ID.test(busId) && routeId && (practice || tripStartTs);
  const bump = (n) => {
    setCounted(true);
    const next = Math.max(0, Math.min(capacity, count + n));
    setCount(next);
    setStandingPassengers((standing) => Math.min(next, Math.max(standing, next - seatCapacity)));
  };
  const setStanding = (value) => {
    setCounted(true);
    setStandingPassengers(Math.max(Math.max(0, count - seatCapacity), Math.min(count, Number(value) || 0)));
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="font-display text-3xl font-extrabold">{t("driver.title")}</h1>
      <p className="text-sm text-ink/70">{t("driver.https")}</p>

      <fieldset disabled={running} className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink/10">
        <label className="block text-sm font-semibold">
          {t("driver.secret")}
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className={`${input} mt-1 font-normal`} autoComplete="off" />
        </label>
        <label className="block text-sm font-semibold">
          {t("driver.busId")}
          <input
            value={busId}
            onChange={(e) => {
              setBusId(e.target.value.trim());
              setCount(0);
              setStandingPassengers(0);
              setCounted(false);
              setCapacity(60);
              setSeatCapacity(40);
            }}
            className={`${input} mt-1 font-normal`}
            placeholder="KA09-F-1234"
            maxLength={32}
          />
          {busId && !BUS_ID.test(busId) && <span className="text-xs font-normal text-high">{t("driver.busIdHint")}</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            {t("driver.route")}
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className={`${input} mt-1 font-normal`}>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} {pick(lang, r.name, r.nameKn)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            {t("driver.direction")}
            <select value={direction} onChange={(e) => setDirection(Number(e.target.value))} className={`${input} mt-1 font-normal`}>
              <option value={0}>{t("driver.outbound")}</option>
              <option value={1}>{t("driver.inbound")}</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">
          {t("driver.trip")}
          <select value={tripStartTs} onChange={(e) => setTripStartTs(Number(e.target.value))} disabled={tripsLoading || !routeId} className={`${input} mt-1 font-normal`}>
            {tripsLoading ? <option value={0}>{t("driver.loadingTrips")}</option> : trips.length === 0 ? <option value={0}>{t("driver.noTrips")}</option> : null}
            {trips.map((x) => (
              <option key={x.departTs} value={x.departTs}>
                {clock(x.departTs)} {x.from} → {x.towards}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          {t("driver.capacity")}
          <input
            type="number"
            min={10}
            max={200}
            value={capacity}
            onChange={(e) => {
              const next = Math.max(10, Math.min(200, Number(e.target.value) || 10));
              setCapacity(next);
              setSeatCapacity((seats) => Math.min(seats, next));
              setCount((passengers) => Math.min(passengers, next));
              setStandingPassengers((standing) => Math.min(standing, next));
            }}
            className={`${input} mt-1 font-normal`}
          />
        </label>
        <label className="block text-sm font-semibold">
          {t("driver.seatCapacity")}
          <input
            type="number"
            min={10}
            max={capacity}
            value={seatCapacity}
            onChange={(e) => {
              const next = Math.max(10, Math.min(capacity, Number(e.target.value) || 10));
              setSeatCapacity(next);
              setStandingPassengers((standing) => Math.max(standing, Math.max(0, count - next)));
            }}
            className={`${input} mt-1 font-normal`}
          />
        </label>
        <label className="flex items-start gap-3 rounded-lg bg-lamp/30 p-3 text-sm">
          <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} className="mt-1 h-4 w-4" />
          <span>
            <strong>{t("driver.practice")}</strong>
            <br />
            {t("driver.practiceHint")}
          </span>
        </label>
      </fieldset>

      <div className="rounded-xl bg-white p-4 text-center shadow-sm ring-1 ring-ink/10">
        <p className="text-sm font-semibold">{t("driver.passengers")}</p>
        <p className="font-display text-6xl font-extrabold">{counted ? count : "–"}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold">{t("driver.boarding")}</p>
            <div className="grid grid-cols-2 gap-2">
              {[1, 5].map((n) => (
                <button key={n} type="button" onClick={() => bump(n)} className="rounded-xl bg-low py-3 text-lg font-bold text-white">
                  +{n}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold">{t("driver.leaving")}</p>
            <div className="grid grid-cols-2 gap-2">
              {[-1, -5].map((n) => (
                <button key={n} type="button" onClick={() => bump(n)} className="rounded-xl bg-ink py-3 text-lg font-bold text-white">
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="mt-4 block text-left text-sm font-semibold">
          {t("driver.standing")}
          <input
            type="number"
            max={count}
            value={counted ? standingPassengers : 0}
            min={Math.max(0, count - seatCapacity)}
            onChange={(e) => setStanding(e.target.value)}
            className={`${input} mt-1 font-normal`}
          />
        </label>
        {!counted && <p className="mt-2 text-xs text-ink/60">{t("driver.notCounted")}</p>}
      </div>

      {running ? (
        <button type="button" onClick={stop} className="w-full rounded-xl bg-high px-4 py-4 text-lg font-bold text-white">
          {t("driver.stop")}
        </button>
      ) : (
        <button type="button" onClick={start} disabled={!ready} className="w-full rounded-xl bg-low px-4 py-4 text-lg font-bold text-white disabled:opacity-50">
          {t("driver.start")}
        </button>
      )}

      {running && (
        <p className="rounded-xl bg-white p-3 text-sm ring-1 ring-ink/10" aria-live="polite">
          {practice
            ? t("driver.practiceOn")
            : !geo.pos
              ? t("driver.waitingGps")
              : last
                ? t("driver.sharing", { acc: Math.round(geo.pos.accuracy ?? 0) })
                : t("driver.connecting", { acc: Math.round(geo.pos.accuracy ?? 0) })}
          {last && (
            <>
              <br />
              {t("driver.sent", { time: clock(last.at) })}
              {last.nextStop ? `. ${t("nextStop", { stop: last.nextStop })}` : ""}
              {last.ignored ? `. ${t("driver.ignored", { why: last.ignored })}` : ""}
            </>
          )}
        </p>
      )}
      {practiceNote && !running && <p className="rounded-xl bg-white p-3 text-sm ring-1 ring-ink/10">{practiceNote}</p>}
      {(error || geo.error) && (
        <p className="rounded-xl bg-high/10 p-3 text-sm text-high" role="alert">
          {error || geo.error}
        </p>
      )}
    </div>
  );
}