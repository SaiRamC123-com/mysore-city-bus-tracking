import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import BusLine from "../components/BusLine.jsx";
import MapView from "../components/MapView.jsx";
import { lineModel, scheduledBus, segmentBetween } from "../busline.js";
import { api } from "../api.js";
import { useLiveBuses } from "../hooks/useLiveBuses.js";
import { useI18n } from "../i18n/index.jsx";
import { pick } from "../utils.js";

/**
 * A scheduled trip that has no GPS yet. The bus is drawn where the timetable says it should be, moving
 * along the line as the clock runs. As soon as a driver starts sharing GPS for this trip, the page jumps
 * to the real live bus.
 */
export default function ScheduledTrip() {
  const { routeId, direction, start } = useParams();
  const dir = Number(direction) === 1 ? 1 : 0;
  const tripStartTs = Number(start);
  const [sp] = useSearchParams();
  const fromId = sp.get("from") || "";
  const toId = sp.get("to") || "";
  const location = useLocation();
  const { t, lang } = useI18n();
  const { buses } = useLiveBuses();
  const [plan, setPlan] = useState(null);
  const [route, setRoute] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.routePlan(routeId, dir, tripStartTs).then(setPlan).catch((e) => setError(e.message));
    api.routes().then((d) => setRoute(d.routes.find((r) => r.id === routeId) ?? null)).catch(() => {});
  }, [routeId, dir, tripStartTs]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sched = useMemo(() => (plan && Number.isFinite(tripStartTs) ? scheduledBus({ plan, tripStartTs, now }) : null), [plan, tripStartTs, now]);
  const model = useMemo(() => (sched ? lineModel({ stops: plan.stops, bus: sched.bus, fromId, toId }) : null), [sched, plan, fromId, toId]);
  const routeList = useMemo(() => (route ? [route] : []), [route]);
  const mapBuses = useMemo(() => (sched ? [sched.bus] : []), [sched]);
  const segment = useMemo(() => (route && model?.hasTrip ? segmentBetween(route, fromId, toId) : null), [route, model?.hasTrip, fromId, toId]);

  // A real bus for this very trip is now sharing GPS: switch to it.
  const half = ((plan?.headwayMin ?? 20) * 60_000) / 2;
  const live = buses.find((b) => b.routeId === routeId && b.direction === dir && Math.abs(b.tripStartTs - tripStartTs) <= half);
  if (live) return <Navigate to={`/bus/${live.busId}${location.search}`} replace />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <p className="rounded-xl bg-high/10 p-4 text-sm text-high" role="alert">
          {error}
        </p>
        <Link to="/plan" className="font-semibold text-maroon underline underline-offset-2">
          {t("nav.plan")}
        </Link>
      </div>
    );
  }
  if (!sched) return <div className="p-4" aria-busy="true" />;

  const { bus, phase, minutesToStart } = sched;
  const first = plan.stops[0];
  const status =
    phase === "before" ? t("sched.departsIn", { stop: pick(lang, first.name, first.nameKn), n: minutesToStart }) : phase === "done" ? t("sched.finished") : t("sched.running");
  const focus = { fromId, toId, fromText: t("track.from"), toText: t("track.to") };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link to="/plan" className="text-sm font-semibold text-maroon underline underline-offset-2">
        {t("nav.plan")}
      </Link>

      <div className="flex items-center gap-3 rounded-2xl bg-ink p-4 text-white shadow-sm">
        <span className="grid h-14 min-w-16 place-items-center rounded-xl bg-white px-3 font-display text-3xl font-extrabold text-ink">{bus.routeNumber}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-extrabold">{t("towards", { place: pick(lang, bus.towards, bus.towardsKn) })}</h1>
          <p className="truncate text-sm text-white/70">{t("sched.title")} · {pick(lang, bus.routeName, bus.routeNameKn)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold">{t("sched.chip")}</span>
      </div>

      <p className="rounded-xl bg-lamp/25 p-3 text-sm font-semibold ring-1 ring-lamp">{status}</p>

      <div className="relative isolate overflow-hidden rounded-xl ring-1 ring-ink/10">
        <MapView className="h-64 w-full sm:h-80" routes={routeList} buses={mapBuses} selectedBusId={bus.busId} follow focus={focus} segment={segment} />
      </div>

      {model && <BusLine model={model} bus={bus} />}

      <p className="text-xs text-ink/60">{t("sched.note")}</p>
    </div>
  );
}